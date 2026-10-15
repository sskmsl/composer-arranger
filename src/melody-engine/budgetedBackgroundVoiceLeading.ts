import type { ArrangementPlan, BackgroundVoiceRepairReport, GeneratedArrangementNote, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { parseTimeSignature } from "@/core/section"

type Event = BackgroundVoiceRepairReport["records"][number]
type Choice = { pitch: number; note?: GeneratedArrangementNote; event?: Event }
type State = { last: number[]; used: number; avoidable: number; leaps: number; distance: number;
  parent?: State; group?: GeneratedArrangementNote[]; choices?: Choice[] }
const compare = (a: State, b: State) => a.avoidable - b.avoidable || a.leaps - b.leaps || a.used - b.used || a.distance - b.distance

/** 局所的な修理順に予算を消費せず、全曲の配置と5%の編集予算を同時に解く。 */
export function budgetedBackgroundVoiceLeading(
  project: ComposerProject, plan: ArrangementPlan, tracks: GeneratedArrangementTrack[],
  previous?: BackgroundVoiceRepairReport, editableTrackIds?: ReadonlySet<string>, editableSectionIds?: ReadonlySet<string>,
): { tracks: GeneratedArrangementTrack[]; report: BackgroundVoiceRepairReport } {
  const pad = tracks.find((t) => t.id === "syn-dark-pad")
  const retained = (previous?.records ?? []).filter((r) => !(editableTrackIds?.has(r.trackId)
    && (!editableSectionIds || editableSectionIds.has(r.sectionId))))
  const sourcePadNoteCount = (pad?.notes.length ?? 0) + retained.filter((r) => r.action === "rest").length
  const maximumEditedNotes = Math.floor(sourcePadNoteCount * .05)
  const report = { sourcePadNoteCount, maximumEditedNotes, records: retained }
  if (!pad || pad.muted || editableTrackIds && !editableTrackIds.has(pad.id)) return { tracks, report }
  const available = maximumEditedNotes - retained.length
  if (available <= 0) return { tracks, report }
  const material = buildSongPlaybackMaterial(project, plan.directive?.timelineConstraints)
  const foreground = [...material.lead, ...material.counterLayers, ...material.decorationLayers,
    ...material.phraseLayers, ...material.signaturePhraseLayers]
  const low = tracks.filter((t) => !t.muted && (t.family === "bass" || t.family === "strings"))
    .flatMap((t) => t.notes.filter((n) => n.pitch < 55))
  const bpb = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const voices = [...new Set(pad.notes.flatMap((n) => n.voiceId ? [n.voiceId] : []))].sort()
  const frames = new Map<number, GeneratedArrangementNote[]>()
  for (const note of pad.notes) if (note.voiceId) frames.set(note.startBeat, [...(frames.get(note.startBeat) ?? []), note])
  const overlaps = (n: GeneratedArrangementNote, other: { startBeat: number; durationBeats: number }) =>
    other.startBeat < n.startBeat + n.durationBeats && other.startBeat + other.durationBeats > n.startBeat
  const existing = new Set(retained.map((e) => e.noteId))
  let states: State[] = [{ last: voices.map(() => NaN), used: 0, avoidable: 0, leaps: 0, distance: 0 }]
  for (const group of [...frames.entries()].sort((a, b) => a[0] - b[0]).map(([, ns]) => ns.sort((a, b) => a.voiceId!.localeCompare(b.voiceId!)))) {
    const options = group.map((note): Choice[] => {
      if (editableSectionIds && !editableSectionIds.has(note.sectionId)) return [{ pitch: note.pitch, note }]
      const pitches = Array.from({ length: 37 }, (_, i) => i + 48).filter((p) => p % 12 === note.pitch % 12)
      const safe = pitches.filter((p) => foreground.every((n) => !overlaps(note, n) || Math.abs(p - n.pitch) > 2)
        && (p >= 55 || low.every((n) => !overlaps(note, n) || Math.abs(n.pitch - p) === 0 || Math.abs(n.pitch - p) >= 5)))
      const result: Choice[] = (safe.length ? safe : [note.pitch]).map((pitch) => ({ pitch, note: { ...note, pitch } }))
      const section = project.sections.find((s) => s.id === note.sectionId)
      if (existing.has(note.id) || section?.role === "outro" && note.startBeat >= (section.startBar + section.lengthBars - 2) * bpb
        || !pad.notes.some((n) => n.id !== note.id && n.sectionId === note.sectionId && n.voiceId !== note.voiceId && overlaps(note, n))) return result
      for (const pitch of pitches.filter((p) => p >= 55 && !safe.includes(p))) {
        const collisions = material.lead.filter((n) => overlaps(note, n) && Math.abs(n.pitch - pitch) <= 2)
        if (!collisions.length) continue
        const collisionStartBeat = Math.min(...collisions.map((n) => n.startBeat))
        const durationBeats = Math.max(0, collisionStartBeat - note.startBeat)
        const action = durationBeats >= .0625 ? "shorten" : "rest"
        if (action === "rest" && section?.role === "outro") continue
        const replacement = action === "shorten" ? { ...note, pitch, durationBeats } : undefined
        if (replacement && foreground.some((n) => overlaps(replacement, n) && Math.abs(n.pitch - pitch) <= 2)) continue
        result.push({ pitch, note: replacement, event: { noteId: note.id, trackId: pad.id, sectionId: note.sectionId,
          bar: Math.floor(note.startBeat / bpb) + 1, startBeat: note.startBeat, action, originalPitch: note.pitch,
          attemptedPitch: pitch, originalDurationBeats: note.durationBeats, durationBeats: replacement?.durationBeats ?? 0,
          collisionStartBeat, reason: "全曲の声部配置を比較し、近いオクターブが主旋律に接触するこの音だけを直前で停止。他声部と5%予算を保持" } })
      }
      return result
    })
    const combinations: Choice[][] = []
    const enumerate = (choices: Choice[]) => {
      if (choices.length === group.length) {
        if (choices.filter((c) => c.note && c.pitch < 55).length > 1) return
        if (choices.some((c) => c.event) && !choices.some((c) => !c.event && c.note)) return
        combinations.push(choices); return
      }
      for (const choice of options[choices.length]) {
        const sounding = choices.filter((c) => c.note)
        if (choice.note && sounding.length && choice.pitch < Math.max(...sounding.map((c) => c.pitch)) - 4) continue
        enumerate([...choices, choice])
      }
    }
    enumerate([])
    if (!combinations.length) combinations.push(group.map((note) => ({ pitch: note.pitch, note })))
    const next = new Map<string, State>()
    for (const state of states) for (const choices of combinations) {
      const used = state.used + choices.filter((c) => c.event).length
      if (used > available) continue
      const last = [...state.last]
      let avoidable = state.avoidable, leaps = state.leaps, distance = state.distance, valid = true
      group.forEach((note, i) => {
        const voice = voices.indexOf(note.voiceId!), before = last[voice], choice = choices[i]
        if (choice.event && (!Number.isFinite(before) || Math.abs(choice.pitch - before) > 6
          || options[i].some((c) => !c.event && Math.abs(c.pitch - before) <= 6))) valid = false
        if (!choice.note) return
        if (Number.isFinite(before)) {
          const delta = Math.abs(choice.pitch - before)
          distance += delta
          if (delta >= 10) {
            leaps++
            if (Array.from({ length: 30 }, (_, j) => 55 + j).some((p) => p % 12 === choice.pitch % 12 && Math.abs(p - before) <= 6)) avoidable++
          }
        }
        last[voice] = choice.pitch
      })
      if (!valid) continue
      const candidate = { last, used, avoidable, leaps, distance, parent: state, group, choices }
      const key = `${last.join(":")}:${used}`
      if (!next.has(key) || compare(candidate, next.get(key)!) < 0) next.set(key, candidate)
    }
    if (!next.size) return { tracks, report }
    states = [...next.values()]
  }
  let best: State | undefined = states.sort(compare)[0]
  const changes = new Map<string, Choice>(), events: Event[] = []
  while (best?.parent) {
    best.group!.forEach((n, i) => { const choice = best!.choices![i]; changes.set(n.id, choice); if (choice.event) events.push(choice.event) })
    best = best.parent
  }
  const notes = pad.notes.flatMap((n) => { const c = changes.get(n.id); return c ? c.note ? [c.note] : [] : [n] })
  // 異なるフレームの休符化も含め、他声部を失う時間編集は最終結果で拒否する。
  if (events.some((e) => !notes.some((n) => n.id !== e.noteId && n.sectionId === e.sectionId
    && n.voiceId !== pad.notes.find((p) => p.id === e.noteId)!.voiceId
    && n.startBeat < e.startBeat + e.originalDurationBeats && n.startBeat + n.durationBeats > e.startBeat))) return { tracks, report }
  return { tracks: tracks.map((t) => t === pad ? { ...t, notes } : t),
    report: { ...report, records: [...retained, ...events.reverse()] } }
}
