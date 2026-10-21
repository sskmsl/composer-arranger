import type { ArrangementPlan, GeneratedArrangementNote, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote } from "@/core/melody"
import { resolveMusicContext } from "@/core/musicContext"
import type { ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"

function nearest(pc: number, around: number): number {
  return pc + 12 * Math.round((around - pc) / 12)
}

/** Occupancy is a union: simultaneous imported voices must not count a rest twice. */
function occupied(lead: MelodyNote[], start: number, end: number): number {
  const ranges = lead.map((n) => [Math.max(start, n.startBeat), Math.min(end, n.startBeat + n.durationBeats)])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  let total = 0, cursor = start
  for (const [a, b] of ranges) {
    total += Math.max(0, b - Math.max(cursor, a))
    cursor = Math.max(cursor, b)
  }
  return total / Math.max(.01, end - start)
}

/**
 * Existing roles receive performances, rather than more copies of their source notes.
 * This runs before the existing performance, boundary, collision and quality checks.
 * A saved arrangement is never rewritten merely by opening it.
 */
export function arrangeContextualEnsemble(
  project: ComposerProject,
  plan: ArrangementPlan,
  input: GeneratedArrangementTrack[],
): GeneratedArrangementTrack[] {
  const { genre, styleActive } = resolveMusicContext(project)
  // As with the existing context generators, absent style context retains the legacy path.
  if (!styleActive) return input
  const bpb = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const lead = buildSongPlaybackMaterial(project, plan.directive?.timelineConstraints).lead
  // Rhythm demand is a musical choice, not a target proportion of drum events.
  const rhythmic = genre.rhythmDensity >= .62 || plan.directive?.character === "rhythmic"
  const sustained = genre.sustain >= .72 && genre.space >= .65
  const harmonic = genre.harmonicDensity >= .6
  const chordLengths = project.chords.map((c) => c.durationBeats)
  const slowHarmony = chordLengths.length > 0 && chordLengths.reduce((a, b) => a + b, 0) / chordLengths.length >= bpb
  const accompanimentProgram = rhythmic ? genre.repetition >= .75 ? 81 : 4 : harmonic ? 0 : slowHarmony && project.song.tempo < 105 ? 24 : 27
  const instruction = plan.directive?.soundInstruction?.enabled
  const preserve = new Set(plan.directive?.preserve ?? [])
  const explicit = new Set(plan.directive?.add ?? [])
  return input.map((track) => {
    if (preserve.has(track.id) || explicit.has(track.id) || instruction) return track
    let instrument = track.instrument
    if (track.id === "syn-pulse") instrument = { program: accompanimentProgram, reason: "和声の変化と曲の推進に合わせた分散伴奏" }
    if (track.id === "syn-arp-high" && !rhythmic) instrument = { program: 4, reason: "主旋律の休符にだけ応答する単声句" }
    const notes = plan.sections.flatMap((section) => {
      const existing = track.notes.filter((n) => n.sectionId === section.sectionId)
      if (!existing.length) return []
      const source = project.sections.find((s) => s.id === section.sectionId)
      if (!source) return existing
      const start = (source.startBar - 1) * bpb, end = start + source.lengthBars * bpb
      const occupancy = occupied(lead, start, end)
      if (track.family === "drums") {
        // Keep the groove's primary instruments. Support layers need a distinct job.
        const allow = track.id === "dr-kick-sub" ? rhythmic && section.energy >= 70
          || section.energy >= 74 && genre.dynamicContrast >= .6 && ["chorus", "final"].includes(section.semanticRole ?? "")
          : track.id === "dr-kick-click" ? rhythmic && project.song.tempo >= 120
          : track.id === "dr-snare-body" ? rhythmic && section.energy >= 58
            || section.energy >= 70 && genre.dynamicContrast >= .6 && ["chorus", "final"].includes(section.semanticRole ?? "")
          : track.id === "dr-clap" ? rhythmic && section.semanticRole === "final"
          : track.id === "dr-shaker" ? rhythmic && occupancy < .65
          : track.id === "dr-ride" ? rhythmic && section.semanticRole === "final"
          : track.id === "dr-percussion-high" ? rhythmic && occupancy < .5
          : track.id === "dr-cymbal-swell" ? sustained && section.semanticRole === "final"
          : track.id === "dr-impact" ? section.semanticRole === "final" && section.energy >= 85
          : true
        return allow ? existing : []
      }
      // Avoid simultaneous octave copies when bass or harmony already fills the role.
      if (track.id === "syn-bass-mid" && !rhythmic
        || track.id === "syn-chord-wide" && occupancy >= .5
        || track.id === "syn-arp-low" && !rhythmic) return []
      const response = track.id === "syn-arp-high" && !rhythmic
      const arpeggio = track.id === "syn-pulse" && !rhythmic
      const chords = project.chords.filter((c) => c.sectionId === section.sectionId).sort((a, b) => a.startBeat - b.startBeat)
      if (!arpeggio && !response) return existing
      const result: GeneratedArrangementNote[] = []
      let previous = response ? 72 : 55
      const template = existing[0]
      const entry = start + (section.roleEntryBeats?.[track.id] ?? 0)
      const exit = Math.min(end, start + (section.roleExitBeats?.[track.id] ?? end - start))
      for (let beat = start; beat < exit - .1; beat += response || section.energy < 50 || occupancy >= .65 ? bpb / 2 : bpb / 4) {
        if (beat < entry) continue
        const local = beat - start
        const chord = chords.find((c) => c.startBeat <= local && local < c.startBeat + c.durationBeats)
        const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
        if (!parsed) continue
        const duration = Math.min(response ? .65 : .42, exit - beat, start + chord!.startBeat + chord!.durationBeats - beat)
        // A response belongs in an actual rest, including its complete duration.
        const overlap = lead.some((n) => n.startBeat < beat + duration + .12 && n.startBeat + n.durationBeats > beat - .12)
        if (response && (overlap || !lead.some((n) => n.startBeat < beat && n.startBeat >= start))) continue
        // Leave the end of each two-bar phrase open; never fill every available gap.
        if (Math.floor(local / bpb) % 2 === 1 && local % bpb >= bpb * .75) continue
        const tones = parsed.tones.map((t) => t.pitchClass)
        const step = Math.floor(local / (bpb / 4)) + (section.developmentStage ?? 0)
        const pc = tones[response ? (step + 1) % tones.length : [0, 2, 1, 2][step % 4] % tones.length]
        const around = response ? Math.max(67, Math.min(79, previous)) : (accompanimentProgram === 24 ? 55 : section.energy >= 68 ? 64 : 60) + (step % 4 === 2 ? 7 : 0)
        let pitch = nearest(pc, around)
        while (pitch < (response ? 67 : 48)) pitch += 12
        while (pitch > (response ? 81 : accompanimentProgram === 24 ? 76 : 79)) pitch -= 12
        // Active lead owns its register, even when the harmony permits the same note.
        if (!response && lead.some((n) => n.startBeat < beat + duration && n.startBeat + n.durationBeats > beat && Math.abs(n.pitch - pitch) < 7)) continue
        previous = pitch
        result.push({ ...template, id: `${track.id}:ensemble:${section.sectionId}:${track.generationRevision}:${result.length}`,
          startBeat: beat, durationBeats: duration, pitch, velocity: Math.round((response ? 40 : 26) + section.energy * (response ? .25 : .25 + genre.dynamicContrast * .15)),
          voiceId: `${track.id}:ensemble`, character: "safe",
          reason: response ? "主旋律の休符へ和音構成音で答え、句末を空ける" : "和音の根音・第5音・内声を別の拍へ配り、主旋律の音域を空ける" })
      }
      return result
    })
    return { ...track, instrument, notes: notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch) }
  })
}
