import type { ArrangementPlan, GeneratedArrangementNote, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"

/** ピッチクラス・時刻・音数は固定し、セクション全体の声部移動を最小化する。 */
export function minimizeBackgroundVoiceMovement(
  project: ComposerProject, plan: ArrangementPlan, tracks: GeneratedArrangementTrack[],
  editableTrackIds?: ReadonlySet<string>, editableSectionIds?: ReadonlySet<string>,
): GeneratedArrangementTrack[] {
  const material = buildSongPlaybackMaterial(project, plan.directive?.timelineConstraints)
  const foreground = [...material.lead, ...material.counterLayers, ...material.decorationLayers,
    ...material.phraseLayers, ...material.signaturePhraseLayers]
  const lowSupport = tracks.filter((t) => !t.muted && (t.family === "bass" || t.family === "strings"))
    .flatMap((t) => t.notes.filter((n) => n.pitch < 55))
  return tracks.map((track) => {
    if (!["syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide"].includes(track.id)
      || track.muted || editableTrackIds && !editableTrackIds.has(track.id)) return track
    const changes = new Map<GeneratedArrangementNote, number>()
    {
      const notes = track.notes.filter((n) => n.voiceId)
      const voices = [...new Set(notes.map((n) => n.voiceId!))].sort()
      const frames = new Map<number, GeneratedArrangementNote[]>()
      for (const note of notes) frames.set(note.startBeat, [...(frames.get(note.startBeat) ?? []), note])
      type State = { last: number[]; cost: number; parent?: State; notes?: GeneratedArrangementNote[]; pitches?: number[] }
      let states: State[] = [{ last: voices.map(() => NaN), cost: 0 }]
      for (const group of [...frames.entries()].sort((a, b) => a[0] - b[0]).map(([, ns]) => ns.sort((a, b) => a.voiceId!.localeCompare(b.voiceId!)))) {
        const choices = group.map((note) => {
          if (editableSectionIds && !editableSectionIds.has(note.sectionId)) return [note.pitch]
          const low = track.id === "syn-dark-pad" ? 48 : track.id === "syn-pad-air" ? 60 : 55
          const high = track.id === "syn-pad-air" ? 96 : 84
          const overlaps = foreground.filter((n) => n.startBeat < note.startBeat + note.durationBeats && n.startBeat + n.durationBeats > note.startBeat)
          const options = Array.from({ length: high - low + 1 }, (_, i) => low + i)
            .filter((p) => p % 12 === note.pitch % 12 && overlaps.every((n) => Math.abs(n.pitch - p) > 2)
              && (p >= 55 || lowSupport.every((n) => n.startBeat >= note.startBeat + note.durationBeats
                || n.startBeat + n.durationBeats <= note.startBeat || Math.abs(n.pitch - p) === 0 || Math.abs(n.pitch - p) >= 5)))
          // 無理な移動で衝突を作らない。解のない既存音はそのまま残す。
          return options.length ? options : [note.pitch]
        })
        const combinations: number[][] = []
        const enumerate = (pitches: number[]) => {
          if (pitches.length === choices.length) {
            if (pitches.filter((p) => p < 55).length <= 1) combinations.push(pitches)
            return
          }
          for (const p of choices[pitches.length]) {
            // 近接声部の短い交差は許す。厳密な上下固定で1オクターブ跳ばさない。
            if (pitches.length && p < Math.max(...pitches) - 4) continue
            enumerate([...pitches, p])
          }
        }
        enumerate([])
        if (!combinations.length) combinations.push(group.map((n) => n.pitch))
        const next = new Map<string, State>()
        for (const previous of states) for (const pitches of combinations) {
          const last = [...previous.last]
          let cost = previous.cost
          group.forEach((note, i) => {
            const voice = voices.indexOf(note.voiceId!)
            const move = Math.abs(pitches[i] - last[voice])
            cost += Number.isFinite(last[voice]) ? move + Math.max(0, move - 6) * 2
              + (move >= 10 ? 100 : 0) : Math.abs(pitches[i] - note.pitch) * .001
            last[voice] = pitches[i]
          })
          const key = last.join(":")
          if (!next.has(key) || cost < next.get(key)!.cost) next.set(key, { last, cost, parent: previous, notes: group, pitches })
        }
        states = [...next.values()]
      }
      let best: State | undefined = states.sort((a, b) => a.cost - b.cost)[0]
      while (best?.parent) {
        best.notes!.forEach((note, i) => changes.set(note, best!.pitches![i]))
        best = best.parent
      }
    }
    return { ...track, notes: track.notes.map((note) => changes.has(note) ? { ...note, pitch: changes.get(note)! } : note) }
  })
}
