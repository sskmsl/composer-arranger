import type { ArrangementPlan, BackgroundVoiceRepairReport, GeneratedArrangementNote, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { parseTimeSignature } from "@/core/section"
import { minimizeBackgroundVoiceMovement } from "./backgroundVoiceLeading"
import { budgetedBackgroundVoiceLeading } from "./budgetedBackgroundVoiceLeading"

function movement(notes: GeneratedArrangementNote[]) {
  let avoidable = 0, leaps = 0, distance = 0
  for (const voice of new Set(notes.map((n) => n.voiceId).filter(Boolean))) {
    const sorted = notes.filter((n) => n.voiceId === voice).sort((a, b) => a.startBeat - b.startBeat)
    sorted.slice(1).forEach((n, i) => {
      const delta = Math.abs(n.pitch - sorted[i].pitch)
      distance += delta
      if (delta >= 10) {
        leaps++
        if (Array.from({ length: 30 }, (_, j) => 55 + j).some((p) => p % 12 === n.pitch % 12 && Math.abs(p - sorted[i].pitch) <= 6)) avoidable++
      }
    })
  }
  return { avoidable, leaps, score: avoidable * 1000 + leaps * 100 + distance }
}

export function remainingBackgroundJumps(tracks: GeneratedArrangementTrack[]) {
  return movement(tracks.find((t) => t.id === "syn-dark-pad")?.notes ?? [])
}

/** 利用者が許可した最終手段。近い同音名の配置が主旋律と衝突する場合だけ、前詰めせず切る。 */
function repairBackgroundConflictPass(
  project: ComposerProject, plan: ArrangementPlan, input: GeneratedArrangementTrack[],
  previous?: BackgroundVoiceRepairReport, editableTrackIds?: ReadonlySet<string>, editableSectionIds?: ReadonlySet<string>,
  withContext = false,
): { tracks: GeneratedArrangementTrack[]; report: BackgroundVoiceRepairReport } {
  const pad = input.find((t) => t.id === "syn-dark-pad")
  const retained = (previous?.records ?? []).filter((r) => !(editableTrackIds?.has(r.trackId)
    && (!editableSectionIds || editableSectionIds.has(r.sectionId))))
  const sourcePadNoteCount = (pad?.notes.length ?? 0) + retained.filter((r) => r.action === "rest").length
  const maximumEditedNotes = Math.floor(sourcePadNoteCount * .05)
  const records = new Map(retained.map((r) => [r.noteId, r]))
  const report = () => ({ sourcePadNoteCount, maximumEditedNotes, records: [...records.values()] })
  if (!pad || pad.muted || editableTrackIds && !editableTrackIds.has(pad.id)) return { tracks: input, report: report() }
  const material = buildSongPlaybackMaterial(project, plan.directive?.timelineConstraints)
  const foreground = [...material.lead, ...material.counterLayers, ...material.decorationLayers,
    ...material.phraseLayers, ...material.signaturePhraseLayers]
  const bpb = parseTimeSignature(project.song.timeSignature).beatsPerBar
  let tracks = input
  // 1回の変更で改善するものだけを採用し、不要な短縮を重ねない。
  for (let pass = 0; pass < maximumEditedNotes * 2 + 1; pass++) {
    const current = tracks.find((t) => t.id === "syn-dark-pad")!
    const before = movement(current.notes)
    if (!before.avoidable) break
    type Event = BackgroundVoiceRepairReport["records"][number]
    let best: { tracks: GeneratedArrangementTrack[]; events: Event[]; score: number; loss: number } | undefined
    const pending = new Map<string, { note: GeneratedArrangementNote; replacement?: GeneratedArrangementNote; event: Event }>()
    for (const voice of new Set(current.notes.map((n) => n.voiceId).filter(Boolean))) {
      const notes = current.notes.filter((n) => n.voiceId === voice).sort((a, b) => a.startBeat - b.startBeat)
      for (let i = 1; i < notes.length; i++) {
        if (Math.abs(notes[i].pitch - notes[i - 1].pitch) < 10) continue
        const targets = [[notes[i], notes[i - 1]], [notes[i - 1], notes[i]],
          ...(withContext ? [...notes.slice(i + 1, i + 3).map((next) => [next, notes[i - 1]]),
            ...notes.slice(Math.max(0, i - 3), i - 1).map((before) => [before, notes[i]])] : [])]
        for (const [note, previousNote] of targets) {
        if (editableSectionIds && !editableSectionIds.has(note.sectionId)) continue
        const options = Array.from({ length: 30 }, (_, j) => 55 + j)
          .filter((p) => p % 12 === note.pitch % 12 && Math.abs(p - previousNote.pitch) <= 6)
          .sort((a, b) => Math.abs(a - previousNote.pitch) - Math.abs(b - previousNote.pitch))
        const overlapsAt = (pitch: number) => foreground.filter((n) => n.startBeat < note.startBeat + note.durationBeats
          && n.startBeat + n.durationBeats > note.startBeat && Math.abs(n.pitch - pitch) <= 2)
        const hasSafeOctave = options.some((p) => overlapsAt(p).length === 0)
        for (const pitch of options) {
          const collisions = overlapsAt(pitch)
          // 純粋なオクターブ選択は直前の全曲DPで検証済み。ここでは時間編集だけを試す。
          if (!collisions.length) continue
          let event: BackgroundVoiceRepairReport["records"][number] | undefined
          let replacement: GeneratedArrangementNote | undefined = { ...note, pitch }
          if (collisions.length) {
            // 別の近いオクターブで回避できる場合は、時間・音数には触れない。
            if (hasSafeOctave || records.has(note.id) || records.size >= maximumEditedNotes) continue
            const melodyCollisions = material.lead.filter((n) => n.startBeat < note.startBeat + note.durationBeats
              && n.startBeat + n.durationBeats > note.startBeat && Math.abs(n.pitch - pitch) <= 2)
            if (!melodyCollisions.length) continue
            const collisionStartBeat = Math.min(...melodyCollisions.map((n) => n.startBeat))
            const duration = Math.max(0, collisionStartBeat - note.startBeat)
            const action = duration >= .0625 ? "shorten" as const : "rest" as const
            const sourceSection = project.sections.find((s) => s.id === note.sectionId)
            if (sourceSection?.role === "outro" && note.startBeat >= (sourceSection.startBar + sourceSection.lengthBars - 2) * bpb) continue
            // Criticが既に他声部を除去した孤立音は、短縮でも持続感を損なうため触らない。
            if (!current.notes.some((n) => n.id !== note.id && n.sectionId === note.sectionId && n.voiceId !== note.voiceId
              && n.startBeat < note.startBeat + note.durationBeats && n.startBeat + n.durationBeats > note.startBeat)) continue
            if (action === "rest") {
              // 同じ和音の他のパッド声部を必ず残す。アウトロの最後の支えも消さない。
              const section = project.sections.find((s) => s.id === note.sectionId)
              const offset = ((section?.startBar ?? 1) - 1) * bpb
              const chord = project.chords.filter((c) => c.sectionId === note.sectionId && offset + c.startBeat <= note.startBeat + .001)
                .sort((a, b) => b.startBeat - a.startBeat)[0]
              const from = chord ? offset + chord.startBeat : note.startBeat
              const to = chord ? from + chord.durationBeats : note.startBeat + note.durationBeats
              const otherVoice = current.notes.some((n) => n.id !== note.id && n.sectionId === note.sectionId && n.voiceId !== note.voiceId
                && n.startBeat < to && n.startBeat + n.durationBeats > from)
              if (!otherVoice || section?.role === "outro") continue
              replacement = undefined
            } else replacement = { ...replacement, durationBeats: duration }
            if (replacement && foreground.some((n) => n.startBeat < replacement!.startBeat + replacement!.durationBeats
              && n.startBeat + n.durationBeats > replacement!.startBeat && Math.abs(n.pitch - pitch) <= 2)) continue
            event = { noteId: note.id, trackId: current.id, sectionId: note.sectionId,
              bar: Math.floor(note.startBeat / bpb) + 1, startBeat: note.startBeat, action,
              originalPitch: note.pitch, attemptedPitch: pitch, originalDurationBeats: note.durationBeats,
              durationBeats: replacement?.durationBeats ?? 0, collisionStartBeat,
              reason: "近いオクターブは主旋律と接触するため、同じ和音の他声部を残し、この音だけ主旋律の直前で止める" }
            pending.set(`${note.id}:${pitch}`, { note, replacement, event })
          }
          const proposed = tracks.map((t) => t.id === current.id ? { ...t, notes: t.notes.flatMap((n) => n.id === note.id ? replacement ? [replacement] : [] : [n]) } : t)
          const optimized = minimizeBackgroundVoiceMovement(project, plan, proposed, new Set([current.id]), editableSectionIds)
          const score = movement(optimized.find((t) => t.id === current.id)!.notes).score
          const loss = event ? event.originalDurationBeats - event.durationBeats : 0
          if (score < before.score && (!best || score < best.score || score === best.score && loss < best.loss)) best = { tracks: optimized, events: event ? [event] : [], score, loss }
        }
        }
      }
    }
    // 連続する2音が双方とも主旋律に接触する場合、片方だけでは移動を減らせない。
    // 単音修理がないときに限り、隣接する衝突音の2件をまとめて検証する。
    if (!best && records.size + 2 <= maximumEditedNotes) {
      const edits = [...pending.values()]
      for (let i = 0; i < edits.length; i++) for (const right of edits.slice(i + 1)) {
        const left = edits[i]
        if (left.note.id === right.note.id || left.note.voiceId !== right.note.voiceId) continue
        const voiceNotes = current.notes.filter((n) => n.voiceId === left.note.voiceId).sort((a, b) => a.startBeat - b.startBeat)
        if (Math.abs(voiceNotes.indexOf(left.note) - voiceNotes.indexOf(right.note)) > 2) continue
        const proposed = tracks.map((t) => t.id !== current.id ? t : ({ ...t, notes: t.notes.flatMap((n) => {
          const edit = n.id === left.note.id ? left : n.id === right.note.id ? right : undefined
          return edit ? edit.replacement ? [edit.replacement] : [] : [n]
        }) }))
        // 2音を同時に消す場合も、同じ和音に別の声部が残ることを再確認する。
        const proposedPad = proposed.find((t) => t.id === current.id)!
        if ([left, right].some((edit) => edit.event.action === "rest" && !proposedPad.notes.some((n) =>
          n.sectionId === edit.note.sectionId && n.voiceId !== edit.note.voiceId
          && n.startBeat < edit.note.startBeat + edit.note.durationBeats
          && n.startBeat + n.durationBeats > edit.note.startBeat))) continue
        const optimized = minimizeBackgroundVoiceMovement(project, plan, proposed, new Set([current.id]), editableSectionIds)
        const score = movement(optimized.find((t) => t.id === current.id)!.notes).score
        const loss = left.event.originalDurationBeats - left.event.durationBeats + right.event.originalDurationBeats - right.event.durationBeats
        if (score < before.score && (!best || score < best.score || score === best.score && loss < best.loss)) best = { tracks: optimized, events: [left.event, right.event], score, loss }
      }
    }
    if (!best) break
    tracks = best.tracks
    for (const event of best.events) records.set(event.noteId, event)
  }
  return { tracks, report: report() }
}

export function repairBackgroundOctaveConflicts(
  project: ComposerProject, plan: ArrangementPlan, input: GeneratedArrangementTrack[],
  previous?: BackgroundVoiceRepairReport, editableTrackIds?: ReadonlySet<string>, editableSectionIds?: ReadonlySet<string>,
) {
  const local = repairBackgroundConflictPass(project, plan, input, previous, editableTrackIds, editableSectionIds, false)
  if (!remainingBackgroundJumps(local.tracks).avoidable) return local
  const candidates = [local, repairBackgroundConflictPass(project, plan, input, previous, editableTrackIds, editableSectionIds, true),
    budgetedBackgroundVoiceLeading(project, plan, input, previous, editableTrackIds, editableSectionIds)]
  return candidates.sort((a, b) => {
    const left = remainingBackgroundJumps(a.tracks), right = remainingBackgroundJumps(b.tracks)
    return left.avoidable - right.avoidable || a.report.records.length - b.report.records.length || left.leaps - right.leaps || left.score - right.score
  })[0]
}
