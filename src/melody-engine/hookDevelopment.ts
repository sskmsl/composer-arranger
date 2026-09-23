import type { MelodyGeneratorProfile, MelodyNote } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import type { MotifCore } from "./motifCore"

export type HookPhraseRole = "statement" | "answer" | "contrast" | "return" | "contrast-answer" | "contrast-return"

/**
 * フレーズ長・音域・内部の展開方法は既存DNAへ任せ、素材の回帰だけを計画する。
 * 短いセクションはA→A′、A→A′→A。通常はA→A′→B→A、
 * 4フレーズ以上のサビはAとBをそれぞれ反復する。
 * 専用の生成文法を持つProfileやMinimalには適用しない。
 */
export function hookPhraseRole(
  phraseIndex: number,
  phraseCount: number,
  profile: MelodyGeneratorProfile = "standard",
  sectionRole?: SectionRole,
): HookPhraseRole | undefined {
  if (profile !== "standard" && profile !== "cinematic") return undefined
  if (phraseCount < 2 || phraseIndex < 0 || phraseIndex >= phraseCount) return undefined
  // サビでは同じ核を二度聴かせ、後半の対照的な核も二度聴かせる。
  // 8フレーズなら A A′ A A′ / B B′ B B′。短い区間は従来の回帰を保つ。
  if ((sectionRole === "chorus" || sectionRole === "grand-chorus") && phraseCount >= 4) {
    const contrastStart = Math.floor(phraseCount / 2)
    if (phraseIndex === 0) return "statement"
    if (phraseIndex < contrastStart) return phraseIndex % 2 === 1 ? "answer" : "return"
    if (phraseIndex === contrastStart) return "contrast"
    return (phraseIndex - contrastStart) % 2 === 1 ? "contrast-answer" : "contrast-return"
  }
  if (phraseIndex === 0) return "statement"
  if (phraseIndex === phraseCount - 1 && phraseCount >= 3) return "return"
  return (["statement", "answer", "contrast", "return"] as const)[phraseIndex % 4]
}

/** 冒頭の入場待ちを毎回繰り返さず、核の内部のリズムと休符だけを回収する。 */
export function returningHook(source: MotifCore): MotifCore {
  const firstSound = source.events.findIndex(event => !event.isRest)
  if (firstSound < 0) return { ...source, events: source.events.map(event => ({ ...event })), pitches: [...source.pitches] }
  const offset = source.events[firstSound].offsetBeats
  return {
    events: source.events.slice(firstSound).map(event => ({ ...event, offsetBeats: event.offsetBeats - offset })),
    pitches: [...source.pitches],
    lengthBeats: Math.max(0, source.lengthBeats - offset),
  }
}

/**
 * モチーフの入口とリズムを保ち、最後の1音だけを隣接音へ動かす応答。
 * 和声適合・音域・終止は配置先の既存処理で決める。元の核は変更しない。
 * 2音以下の核は語尾変更だけで同一性を失うため、そのまま返す。
 */
export function answerHook(source: MotifCore): MotifCore {
  const core = returningHook(source)
  const pitches = [...core.pitches]
  if (pitches.length >= 3) {
    const last = pitches.length - 1
    const direction = Math.sign(pitches[last] - pitches[last - 1]) || 1
    pitches[last] = Math.max(0, Math.min(127, pitches[last] - direction * 2))
  }
  return { ...core, pitches }
}

/** Coreの頭と周期を保ち、A′/Bを末尾1音・小さな休符・一箇所のリズム差だけで作る。 */
export function subtleHookVariation(source: MotifCore, kind: "tail" | "breath" | "contrast"): MotifCore {
  const events = source.events.map((event) => ({ ...event }))
  const pitches = [...source.pitches]
  if (pitches.length >= 3) {
    const last = pitches.length - 1
    const direction = Math.sign(pitches[last] - pitches[last - 1]) || 1
    pitches[last] -= direction * 2
  }
  if (kind === "breath" && pitches.length >= 4) {
    const sounding = events.map((event, index) => ({ event, index })).filter(({ event }) => !event.isRest)
    events[sounding.at(-2)!.index].isRest = true
    pitches.splice(-2, 1)
  }
  if (kind === "contrast") {
    const firstSound = events.find((event) => !event.isRest && event.durationBeats >= .75)
    if (firstSound) firstSound.durationBeats -= .25
  }
  return { events, pitches, lengthBeats: source.lengthBeats }
}

/** 配置前の抽象音型ではなく、実際に提示した音程と音価を次回の核として記憶する。 */
export function capturePlacedHook(source: MotifCore, notes: MelodyNote[], startBeat: number): MotifCore {
  const firstSegment = notes.filter(note => note.startBeat >= startBeat && note.startBeat < startBeat + source.lengthBeats)
    .sort((a, b) => a.startBeat - b.startBeat)
  if (firstSegment.length === 0) return returningHook(source)
  return {
    events: firstSegment.map(note => ({ offsetBeats: note.startBeat - startBeat, durationBeats: note.durationBeats, isRest: false })),
    pitches: firstSegment.map(note => note.pitch),
    lengthBeats: Math.max(...firstSegment.map(note => note.startBeat - startBeat + note.durationBeats)),
  }
}
