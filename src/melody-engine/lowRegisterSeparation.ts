import type { GeneratedArrangementTrack } from "@/core/arrangementGeneration"

/** 低音の主担当はベース。近い別音程の支えは同じ音名の上のオクターブへ分ける。 */
export function separateLowRegister(
  tracks: GeneratedArrangementTrack[], editableTrackIds?: ReadonlySet<string>, editableSectionIds?: ReadonlySet<string>,
): GeneratedArrangementTrack[] {
  const occupied = tracks.filter((t) => !t.muted && t.family !== "drums").flatMap((t) => t.notes.map((note) => ({ track: t, note })))
  return tracks.map((track) => {
    if (track.family === "drums" || track.family === "bass" || track.muted
      || editableTrackIds && !editableTrackIds.has(track.id)) return track
    return { ...track, notes: track.notes.map((note) => {
      if (note.pitch >= 55 || editableSectionIds && !editableSectionIds.has(note.sectionId)) return note
      const overlaps = occupied.filter((other) => other.note.id !== note.id && other.note.pitch < 55
        && other.note.startBeat < note.startBeat + note.durationBeats && other.note.startBeat + other.note.durationBeats > note.startBeat)
      const close = overlaps.some((other) => (track.id !== "syn-dark-pad" || other.track.family === "bass")
        && Math.abs(other.note.pitch - note.pitch) >= 1 && Math.abs(other.note.pitch - note.pitch) <= 4)
      const multipleLowPad = track.id === "syn-dark-pad" && overlaps.some((o) => o.track.id === track.id
        && (o.note.pitch < note.pitch || o.note.pitch === note.pitch && o.note.id < note.id))
      if (!close && !multipleLowPad) return note
      let pitch = note.pitch
      while (pitch < 55) pitch += 12
      return { ...note, pitch, reason: `${note.reason}。低音と近い響きを上のオクターブへ分ける` }
    }) }
  })
}
