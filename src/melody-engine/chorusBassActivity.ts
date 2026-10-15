import type { ComposerProject } from "@/core/project"
import type { ArrangementPlan, GeneratedArrangementNote, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { parseChordSymbol } from "@/core/chord"
import { resolveMusicContext } from "@/core/musicContext"
import { parseTimeSignature } from "@/core/section"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"

const clamp = (n: number) => Math.max(0, Math.min(1, n))
export function chorusBassActivity(project: ComposerProject, sectionId: string, occupancy: number) {
  const { genre } = resolveMusicContext(project, sectionId)
  const tempo = clamp((project.song.tempo - 90) / 20)
  const character = .2 * (genre.bassMovement - .5) + .15 * (genre.rhythmDensity - .5) - .15 * (genre.space - .5)
  const vocal = -.15 * Math.max(0, occupancy - .5)
  return { tempo, character, vocal, value: clamp(tempo + character + vocal),
    signals: { bpm: project.song.tempo, bassMovement: genre.bassMovement, rhythmDensity: genre.rhythmDensity, space: genre.space, leadOccupancy: occupancy } }
}

/** サビだけを整理する。役割外の音・編集範囲外・保護された主旋律には触れない。 */
export function shapeChorusBass(
  project: ComposerProject, plan: ArrangementPlan, input: GeneratedArrangementTrack[],
  editableTrackIds?: ReadonlySet<string>, editableSectionIds?: ReadonlySet<string>,
): GeneratedArrangementTrack[] {
  const bpb = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const lead = buildSongPlaybackMaterial(project, plan.directive?.timelineConstraints).lead
  const tracks = input.map((t) => ({ ...t, notes: [...t.notes] }))
  const bass = tracks.find((t) => t.id === "syn-bass")
  if (!bass || bass.muted) return input
  for (const section of project.sections.filter((s) => ["chorus", "grand-chorus"].includes(s.role))) {
    if (editableSectionIds && !editableSectionIds.has(section.id)) continue
    const source = bass.notes.filter((n) => n.sectionId === section.id)
    if (!source.length) continue
    const start = (section.startBar - 1) * bpb, end = start + section.lengthBars * bpb
    const occupancy = lead.reduce((sum, n) => sum + Math.max(0, Math.min(end, n.startBeat + n.durationBeats) - Math.max(start, n.startBeat)), 0) / (end - start)
    const activity = chorusBassActivity(project, section.id, occupancy).value
    const calm = activity < .5, grand = section.role === "grand-chorus"
    const budget = Math.floor(section.lengthBars * (3.5 + 2.5 * activity))
    const chords = project.chords.filter((c) => c.sectionId === section.id).sort((a, b) => a.startBeat - b.startBeat)
    const changes = chords.filter((c, i) => i > 0 && c.symbol !== chords[i - 1].symbol)
    const approachCount = Math.round(changes.length * (.3 + .45 * activity))
    const stage = plan.sections.find((s) => s.sectionId === section.id)?.developmentStage ?? 0
    // フレーズの終わりへ分散し、毎コードをフィルにしない。
    const approachTargets = new Set(changes.filter((_, i) => {
      const position = (i + stage) % changes.length
      return Math.floor((position + 1) * approachCount / changes.length) > Math.floor(position * approachCount / changes.length)
    }))
    const rootPitch = (pc: number) => 36 + pc
    const chordAt = (beat: number) => chords.filter((c) => start + c.startBeat <= beat + .02).at(-1) ?? chords[0]
    const selected: GeneratedArrangementNote[] = []
    const add = (beat: number, approach = false, explicitPc?: number) => {
      if (beat < start || beat >= end || selected.some((n) => Math.abs(n.startBeat - beat) < .09)) return
      const chord = chordAt(beat), parsed = chord && parseChordSymbol(chord.symbol, chord.bass ?? undefined)
      if (!parsed) return
      const next = chords.find((c) => start + c.startBeat > beat + .05)
      const target = next && parseChordSymbol(next.symbol, next.bass ?? undefined)
      let pitch = rootPitch(explicitPc ?? parsed.bassPc)
      // 非選択コードへの偶発的な接近を避ける。和声外音へ逃がさない。
      if (!approach && next && target && !approachTargets.has(next) && beat >= start + next.startBeat - 1
        && [1, 2, 10, 11].includes((pitch % 12 - target.bassPc + 12) % 12)) {
        const safe = parsed.tones.find((t) => ![1, 2, 10, 11].includes((t.pitchClass - target.bassPc + 12) % 12))
        if (!safe) return
        pitch = 60 + safe.pitchClass
      }
      const nearest = source.reduce((a, n) => Math.abs(n.startBeat - beat) < Math.abs(a.startBeat - beat) ? n : a, source[0])
      selected.push({ ...nearest, id: `bass-activity:${section.id}:${selected.length}`, startBeat: beat, pitch,
        durationBeats: approach ? .25 : .6, velocity: nearest.velocity, character: approach ? "edge" : "safe",
        reason: approach ? "フレーズ末尾で次の低音へ短く近づく" : "曲の余白とキックを支える低音" })
    }
    chords.forEach((chord) => {
      const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
      if (parsed) add(start + chord.startBeat, false, parsed.bassPc)
    })
    for (const target of approachTargets) {
      const parsed = parseChordSymbol(target.symbol, target.bass ?? undefined)
      if (parsed) add(start + target.startBeat - .5, true, (parsed.bassPc + 11) % 12)
    }
    const kicks = input.find((t) => t.id === "dr-kick")?.notes.filter((n) => n.sectionId === section.id) ?? []
    const priority = (beat: number) => Math.abs((beat - start) % bpb) < .1 ? 0 : Math.abs((beat - start) % bpb - 2) < .1 ? 1 : 2
    for (const kick of [...kicks].sort((a, b) => priority(a.startBeat) - priority(b.startBeat) || a.startBeat - b.startBeat)) {
      const matches = kicks.filter((k) => selected.some((n) => Math.abs(n.startBeat - k.startBeat) < .1)).length
      if (matches >= Math.ceil(kicks.length * .75) || selected.length >= budget) break
      add(kick.startBeat)
    }
    const patterns = calm ? (grand ? [[0, 1.5], [0, 2], [0, .75]] : [[0, 2], [0, 1.5]])
      : grand ? [[0, 1, 2], [0, .75, 2], [0, 1.5, 2.5], [0, .5, 2.25]] : [[0, 1, 2], [0, 1.5, 2.5], [0, .75, 2]]
    for (let bar = 0; bar < section.lengthBars; bar++) for (const offset of patterns[(bar + stage) % patterns.length]) {
      if (selected.length < budget) add(start + bar * bpb + offset)
    }
    selected.sort((a, b) => a.startBeat - b.startBeat)
    selected.forEach((n, i) => { n.durationBeats = Math.max(.0625, Math.min(n.durationBeats, (selected[i + 1]?.startBeat ?? end) - n.startBeat)) })
    if (!editableTrackIds || editableTrackIds.has(bass.id)) bass.notes = bass.notes.filter((n) => n.sectionId !== section.id).concat(selected).sort((a, b) => a.startBeat - b.startBeat)
    const soundingBass = bass.notes.filter((n) => n.sectionId === section.id)
    for (const id of ["syn-sub-bass", "syn-bass-mid"] as const) {
      const layer = tracks.find((t) => t.id === id)
      if (!layer || layer.muted || editableTrackIds && !editableTrackIds.has(id)) continue
      const old = layer.notes.filter((n) => n.sectionId === section.id)
      if (!old.length) continue
      const newNotes = chords.flatMap((chord, i) => {
        const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
        if (!parsed) return []
        const beat = start + chord.startBeat, stop = Math.min(end, start + (chords[i + 1]?.startBeat ?? section.lengthBars * bpb))
        const firstApproach = soundingBass.find((n) => n.character === "edge" && n.startBeat >= beat && n.startBeat < stop)
        const sourceNote = old.find((n) => Math.abs(n.startBeat - beat) < .1) ?? old[0]
        return [{ ...sourceNote, id: `${id}:foundation:${section.id}:${i}`, startBeat: beat,
          pitch: (id === "syn-sub-bass" ? 24 : 36) + parsed.bassPc, character: "safe" as const,
          durationBeats: id === "syn-sub-bass" ? Math.max(.0625, (firstApproach?.startBeat ?? stop) - beat) : .3,
          reason: id === "syn-sub-bass" ? "動きは主ベースへ任せ、和音の低音を持続する" : "コード頭の低音の輪郭だけを補う" }]
      })
      layer.notes = layer.notes.filter((n) => n.sectionId !== section.id).concat(newNotes).sort((a, b) => a.startBeat - b.startBeat)
    }
  }
  return tracks
}
