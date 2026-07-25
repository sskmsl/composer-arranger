import type { ChordEvent } from "@/core/project"
import type { MelodyNote } from "@/core/melody"
import type { SectionContentSettings } from "@/core/sectionContent"

const EPS = 1e-6

/** melody経路で弱起に割り当てる長さ(拍)。content経路は候補ごとに1〜2拍で変える */
export const DEFAULT_PICKUP_BEATS = 1

export interface LeadWindow {
  startBeat: number
  endBeat: number
  pickupBeats: number
}

/**
 * Issue #41: リードを鳴らして良い区間。
 *
 * entryOffset は「リードが鳴り始めるまでの拍数」なので、生成もこの区間内で行う。
 * 生成後に前を切り落とすだけでは、セクション全長向けに設計された旋律の頭が
 * 欠けるだけになってしまうため、区間そのものを生成対象にする。
 */
export function leadWindowOf(content: SectionContentSettings, totalBeats: number): LeadWindow {
  const startBeat = Math.max(0, Math.min(totalBeats, content.entryOffsetBeats))
  const pickupBeats = content.pickup ? Math.min(DEFAULT_PICKUP_BEATS, Math.max(0, totalBeats - startBeat)) : 0
  return { startBeat, endBeat: Math.max(startBeat, totalBeats - pickupBeats), pickupBeats }
}

/** 窓の外へ出る区間を切り、窓の先頭を0とする相対コードへ変換する */
export function chordsForWindow(chords: ChordEvent[], window: LeadWindow): ChordEvent[] {
  const result: ChordEvent[] = []
  for (const chord of chords) {
    const start = Math.max(chord.startBeat, window.startBeat)
    const end = Math.min(chord.startBeat + chord.durationBeats, window.endBeat)
    if (end - start <= EPS) continue
    result.push({ ...chord, startBeat: start - window.startBeat, durationBeats: end - start })
  }
  return result.sort((a, b) => a.startBeat - b.startBeat)
}

/** 窓相対で生成したノートを、セクション相対の絶対拍へ戻す */
export function shiftNotesToSection(notes: MelodyNote[], window: LeadWindow): MelodyNote[] {
  if (window.startBeat <= EPS) return notes
  return notes.map((note) => ({ ...note, startBeat: note.startBeat + window.startBeat }))
}

/** 窓の長さ。0以下なら生成しない(完全無音) */
export function windowLengthBeats(window: LeadWindow): number {
  return Math.max(0, window.endBeat - window.startBeat)
}

/** entryOffset/pickupのいずれも指定が無い(=従来と同じ全長生成)か */
export function isFullSectionWindow(window: LeadWindow, totalBeats: number): boolean {
  return window.startBeat <= EPS && Math.abs(window.endBeat - totalBeats) <= EPS
}
