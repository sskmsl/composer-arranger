import type { MelodyNote } from "@/core/melody"
import type { ComposerProject } from "@/core/project"
import type { FullSongArrangement, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import { parseChordSymbol } from "@/core/chord"

export function measureBreathing(notes: readonly MelodyNote[], totalBeats: number) {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const gaps = sorted.slice(1).flatMap((n, i) => n.startBeat - (sorted[i].startBeat + sorted[i].durationBeats) >= 1 - 1e-6
    ? [{ start: sorted[i].startBeat + sorted[i].durationBeats, end: n.startBeat }] : [])
  const blocks = Array.from({ length: Math.ceil(totalBeats / 16) }, (_, i) => ({
    start: i * 16, hasBreath: gaps.some((g) => Math.min(g.end, (i + 1) * 16) - Math.max(g.start, i * 16) >= 1 - 1e-6),
  }))
  return { noteCount: notes.length, gaps, blocks, hasBreath: gaps.length > 0, notesPerBar: notes.length / (totalBeats / 4) }
}

export function measureLowEnd(tracks: GeneratedArrangementTrack[], totalBeats: number) {
  let muddy = 0
  const pairs: Record<string, number> = {}
  for (let beat = 0; beat < totalBeats; beat += 0.5) {
    const notes = tracks.filter((t) => !t.muted && t.family !== "drums").flatMap((t) => t.notes
      .filter((n) => n.pitch < 55 && n.startBeat <= beat && n.startBeat + n.durationBeats > beat)
      .map((n) => ({ track: t.id, pitch: n.pitch })))
    let found = false
    for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
      const distance = Math.abs(notes[i].pitch - notes[j].pitch)
      if (distance < 1 || distance > 4) continue
      found = true
      const key = [notes[i].track, notes[j].track].sort().join(" / ")
      pairs[key] = (pairs[key] ?? 0) + 1
    }
    if (found) muddy++
  }
  return { muddy, samples: Math.ceil(totalBeats * 2), ratio: muddy / Math.ceil(totalBeats * 2), pairs,
    padNotes: tracks.filter((t) => t.id === "syn-dark-pad").reduce((sum, t) => sum + t.notes.length, 0) }
}

export function measureBass(project: ComposerProject, arrangement: FullSongArrangement) {
  const bass = arrangement.tracks.find((t) => t.id === "syn-bass")?.notes ?? []
  const kick = arrangement.tracks.find((t) => t.id === "dr-kick")?.notes ?? []
  return project.sections.map((section) => {
    const start = (section.startBar - 1) * 4, end = start + section.lengthBars * 4
    const notes = bass.filter((n) => n.sectionId === section.id)
    const chords = project.chords.filter((c) => c.sectionId === section.id).sort((a, b) => a.startBeat - b.startBeat)
    const changes = chords.filter((c, i) => i > 0 && c.symbol !== chords[i - 1].symbol)
    const roots = chords.map((c) => ({ chord: c, pc: parseChordSymbol(c.symbol, c.bass ?? undefined)!.bassPc }))
    const matched = roots.filter(({ chord, pc }) => notes.some((n) => Math.abs(n.startBeat - start - chord.startBeat) < 0.1 && n.pitch % 12 === pc))
    const slashes = roots.filter(({ chord }) => chord.symbol.includes("/") || chord.bass)
    const approaches = changes.filter((c) => {
      const target = parseChordSymbol(c.symbol, c.bass ?? undefined)!.bassPc
      return notes.some((n) => n.startBeat >= start + c.startBeat - 1 && n.startBeat < start + c.startBeat
        && [1, 2, 10, 11].includes((n.pitch % 12 - target + 12) % 12))
    })
    const kicks = kick.filter((n) => n.startBeat >= start && n.startBeat < end)
    const rhythms = Array.from({ length: section.lengthBars }, (_, i) => [...new Set(notes.filter((n) => n.startBeat >= start + i * 4 && n.startBeat < start + (i + 1) * 4)
      .map((n) => Math.round((n.startBeat - start - i * 4) * 4) / 4))].sort((a, b) => a - b).join(","))
    return { role: section.role, name: section.name, changes: changes.length, approaches: approaches.length,
      bars: section.lengthBars, noteCount: notes.length,
      layers: ["syn-bass", "syn-bass-mid", "syn-sub-bass"].map((id) => {
        const layer = arrangement.tracks.find((t) => t.id === id)?.notes.filter((n) => n.sectionId === section.id) ?? []
        return { id, notes: layer.length, notesPerBar: layer.length / section.lengthBars,
          approaches: changes.filter((c) => {
            const target = parseChordSymbol(c.symbol, c.bass ?? undefined)!.bassPc
            return layer.some((n) => n.startBeat >= start + c.startBeat - 1 && n.startBeat < start + c.startBeat
              && [1, 2, 10, 11].includes((n.pitch % 12 - target + 12) % 12))
          }).length }
      }),
      rhythmTypes: new Set(rhythms).size, roots: roots.length, matchedRoots: matched.length,
      slashes: slashes.length, matchedSlashes: slashes.filter((s) => matched.includes(s)).length,
      kicks: kicks.length, matchedKicks: kicks.filter((k) => notes.some((n) => Math.abs(n.startBeat - k.startBeat) < 0.1)).length }
  })
}

export function measurePadMotion(tracks: GeneratedArrangementTrack[]) {
  const pad = tracks.find((t) => t.id === "syn-dark-pad")?.notes ?? []
  const groups = new Map<string, typeof pad>()
  for (const note of pad) if (note.voiceId) {
    const key = `${note.sectionId}:${note.voiceId}`
    groups.set(key, [...(groups.get(key) ?? []), note])
  }
  const moves = [...groups.values()].flatMap((notes) => {
    const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
    return sorted.slice(1).map((note, i) => {
      const previous = sorted[i], distance = Math.abs(note.pitch - previous.pitch)
      const alternatives = Array.from({ length: 30 }, (_, j) => 55 + j).filter((p) => p % 12 === note.pitch % 12)
      return { sectionId: note.sectionId, voiceId: note.voiceId, beat: note.startBeat, from: previous.pitch,
        to: note.pitch, distance, avoidable: distance >= 10 && alternatives.some((p) => Math.abs(p - previous.pitch) <= 6) }
    })
  })
  return { notes: pad.length, transitions: moves.length, leaps: moves.filter((m) => m.distance >= 10).length,
    avoidable: moves.filter((m) => m.avoidable).length, octaves: moves.filter((m) => m.distance === 12).length,
    mean: moves.reduce((s, m) => s + m.distance, 0) / Math.max(1, moves.length), moves }
}
