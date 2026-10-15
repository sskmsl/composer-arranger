import type { GeneratedArrangementNote } from "@/core/arrangementGeneration"

/** 声部IDがない音は旧来の配列順を厳密に維持する。閾値は従来どおり10半音。 */
export function supportVoiceLeaps(notes: readonly GeneratedArrangementNote[], legacyStride: number, forceLegacy = false) {
  const previousByVoice = new Map<string, GeneratedArrangementNote>()
  const predecessor = new Map<GeneratedArrangementNote, GeneratedArrangementNote>()
  if (!forceLegacy) for (const note of [...notes].filter((n) => n.voiceId).sort((a, b) => a.startBeat - b.startBeat)) {
    const previous = previousByVoice.get(note.voiceId!)
    if (previous) predecessor.set(note, previous)
    previousByVoice.set(note.voiceId!, note)
  }
  return notes.flatMap((note, index) => {
    const previous = !forceLegacy && note.voiceId ? predecessor.get(note) : notes[index - legacyStride]
    return previous && Math.abs(note.pitch - previous.pitch) > 9 ? [{ note, previous }] : []
  })
}
