import type { MelodyGeneratorProfile, MelodyNote } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import type { MotifCore } from "./motifCore"
import { emotionalTargetFraction } from "./emotionalArc"
import { chordAtBeat, type HarmonicMapEntry } from "./harmonicMap"
import { isChordTone } from "@/core/chord"
import { pitchClass } from "@/core/note"

/**
 * フレーズごとの核の扱い。役割は公開楽譜の分析(reference/composerPrinciples.json)に沿って分けている:
 *   answer   : 頭を保ち語尾だけ変える小変形(Schumann の再登場の約3割がこの形)
 *   develop  : リズムと輪郭を保ち、1か所の音程だけを広げる発展(Brahms の再登場で最も多い「リズムを保った変形」)
 *   rise     : 核そのものを一段高い位置で再提示する(Sibelius 的に、音数を増やさず景色を広げる)
 *   climax   : さらにもう一段高い位置での再提示。同じ素材の意味が、時間を経て大きくなる
 * 1セクションで使う変形は2種類まで(分析した Schumann / Brahms とも、8小節で使う変形の種類の中央値が2)。
 */
export type HookPhraseRole =
  | "statement" | "answer" | "develop" | "rise" | "climax" | "contrast" | "return"
  | "contrast-answer" | "contrast-return"

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
  /** セクションの長さ(拍)。16小節相当以上のときだけ、前半に音程を広げる発展を置かない */
  sectionBeats?: number,
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
  // 8小節(4フレーズ)まで: 提示 → 語尾の小変形 → リズムを保った発展 → 回帰(変形は2種類)
  if (phraseCount <= 5) return (["statement", "answer", "develop", "return", "climax"] as const)[phraseIndex]
  // 16小節以上: 前半は8小節と同じ流れ。後半は同じ核を一段ずつ高い位置で再提示し(音数を増やさずに景色を広げる)、
  // セクションの感情の目標位置(Verse は6割弱、Pre は7割弱)で二段上の頂点にする。頂点の後は応答と回帰で余韻を残す。
  // 頭の断片化も試したが、音数が増えて余白と頂点の時機が悪化したので使わない
  const climaxIndex = Math.min(phraseCount - 2, Math.max(3, Math.round(emotionalTargetFraction(sectionRole ?? "verse") * phraseCount)))
  if (phraseIndex === climaxIndex) return "climax"
  if (phraseIndex > climaxIndex) return "answer"
  if (phraseIndex >= 4) return "rise"
  // (長いセクションでは音程を広げる発展を前半に置かない。早すぎる頂点を作るため。Brahms は8小節、Sibelius は16小節以上と役割を分ける)
  return ((sectionBeats ?? 64) >= LONG_SECTION_BEATS
    ? ["statement", "answer", "return", "answer"] as const
    : ["statement", "answer", "develop", "return"] as const)[phraseIndex]
}

/** 調の音階に沿って steps 段だけ動かす(音階外の音は半音2つ分を1段とみなす) */
export function shiftInScale(pitch: number, steps: number, scale?: readonly number[]): number {
  if (!scale || scale.length < 5 || steps === 0) return pitch + steps * 2
  const sorted = [...scale].sort((a, b) => a - b)
  const pc = ((pitch % 12) + 12) % 12
  const index = sorted.indexOf(pc)
  if (index < 0) return pitch + steps * 2
  const target = index + steps
  const octave = Math.floor(target / sorted.length)
  const wrapped = ((target % sorted.length) + sorted.length) % sorted.length
  return pitch - pc + octave * 12 + sorted[wrapped]
}

/**
 * リズムと輪郭をそのままに、頂点へ向かう1か所の音程だけを広げる(Brahms 的な発展)。
 * 頂点とその後の音を同じだけ持ち上げるので、語尾の形は保たれ、音域が少しだけ育つ。
 */
export function developHook(source: MotifCore, scale?: readonly number[]): MotifCore {
  // 以前の対照フレーズと同じ小さな息継ぎ(長い音を少しだけ短くする)を残し、余白を減らさない
  const breathed = subtleHookVariation(source, "contrast")
  const pitches = [...source.pitches]
  if (pitches.length < 3) return { ...breathed, pitches }
  const peak = pitches.reduce((best, pitch, index) => (pitch > pitches[best] ? index : best), 0)
  const pivot = peak === 0 ? 1 : peak
  const approach = pitches[pivot] - pitches[pivot - 1]
  // 順次の上行なら3度分、跳躍なら1段だけ広げる(広げすぎて別の旋律に聞こえないように)
  const steps = Math.abs(approach) <= 2 ? 2 : 1
  const direction = approach < 0 ? -1 : 1
  for (let index = pivot; index < pitches.length; index++) {
    pitches[index] = shiftInScale(pitches[index], steps * direction, scale)
  }
  return { events: breathed.events, pitches, lengthBeats: source.lengthBeats }
}

/** 核そのものを steps 段高い位置で再提示する。形は同じまま、時間を経て意味が大きくなる(rise=1段、climax=2段) */
export function climaxHook(source: MotifCore, scale?: readonly number[], steps = 2): MotifCore {
  // 頂点へ向かう再提示では、冒頭の間(入りの休み)も残す。息をためてから高い所へ入る
  return {
    events: source.events.map((event) => ({ ...event })),
    pitches: source.pitches.map((pitch) => shiftInScale(pitch, steps, scale)),
    lengthBeats: source.lengthBeats,
  }
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

export interface HookHeadPlan {
  /** 核の長さ(拍) */
  coreLengthBeats: number
  /** 各フレーズの開始拍と役割 */
  phrases: { startBeat: number; lengthBeats: number; role: HookPhraseRole | undefined }[]
  /** セクションの感情の目標位置(拍)。これより後ろの高まりは、頭を戻すときにも削らない */
  climaxBeat?: number
}

/** 頭を保つべき役割(対照側の素材や、音程を広げる発展は含めない) */
/** 長いセクション(16小節相当)とみなす拍数 */
const LONG_SECTION_BEATS = 56

const HEAD_KEEPING_ROLES: readonly (HookPhraseRole | undefined)[] = ["answer", "return", "rise", "climax"]
const CONTRAST_KEEPING_ROLES: readonly (HookPhraseRole | undefined)[] = ["contrast-answer", "contrast-return"]

/**
 * 仕上げ(物語付け・到達・古典らしさへの推敲・和声整合)で動いた、核の頭の音程を戻す。
 * 基準は最初のフレーズで実際に聞こえた頭。頭のリズムが同じフレーズだけを対象に、
 * 音程の形を保ったまま、和声に合う高さ(音階に沿った移高)へまとめて置き直す。
 * 合う高さが無いときは何もしない(無理に戻さない)。
 */
export function restoreHookHeads(
  source: readonly MelodyNote[],
  plan: HookHeadPlan | undefined,
  harmonicMap: HarmonicMapEntry[],
  range: { low: number; high: number },
  scale?: readonly number[],
): MelodyNote[] {
  if (!plan || plan.phrases.length < 2) return [...source]
  const notes = [...source].sort((a, b) => a.startBeat - b.startBeat).map((note) => ({ ...note }))
  const inPhrase = (phrase: { startBeat: number; lengthBeats: number }) => notes.filter((note) =>
    note.startBeat >= phrase.startBeat - 1e-6 && note.startBeat < phrase.startBeat + Math.min(plan.coreLengthBeats, phrase.lengthBeats) - 1e-6)
  const inScale = (pitch: number) => !scale || scale.length < 5 || scale.includes(((pitch % 12) + 12) % 12)
  // A の頭は最初のフレーズ、サビ後半の B の頭は最初の対照フレーズを基準にする
  const references = new Map<"a" | "b", MelodyNote[]>()
  const aSource = inPhrase(plan.phrases[0])
  if (aSource.length >= 3) references.set("a", aSource)
  const contrast = plan.phrases.find((phrase) => phrase.role === "contrast")
  const bSource = contrast ? inPhrase(contrast) : []
  if (bSource.length >= 3) references.set("b", bSource)
  // セクションの頂点を含むフレーズと、その直前のフレーズ(頂点への助走と息継ぎ)には触らない
  const summit = notes.reduce((best, note) => (note.pitch > best.pitch ? note : best), notes[0])
  const summitIndex = plan.phrases.findIndex((phrase) =>
    summit.startBeat >= phrase.startBeat - 1e-6 && summit.startBeat < phrase.startBeat + phrase.lengthBeats - 1e-6)
  for (const [phraseIndex, phrase] of plan.phrases.entries()) {
    if (phraseIndex === 0 || phraseIndex === summitIndex || phraseIndex === summitIndex - 1) continue
    const family = CONTRAST_KEEPING_ROLES.includes(phrase.role) ? "b" : HEAD_KEEPING_ROLES.includes(phrase.role) ? "a" : undefined
    const reference = family ? references.get(family) : undefined
    if (!reference) continue
    const headSize = Math.min(4, Math.max(2, Math.ceil(reference.length / 2)))
    const head = reference.slice(0, headSize)
    const headOffsets = head.map((note) => note.startBeat - head[0].startBeat)
    const window = inPhrase(phrase).slice(0, headSize)
    if (window.length < headSize) continue
    const sameRhythm = window.every((note, index) => Math.abs(note.startBeat - window[0].startBeat - headOffsets[index]) < .02)
    if (!sameRhythm) continue
    const indexOfFirst = notes.indexOf(window[0])
    const before = notes[indexOfFirst - 1]
    const after = notes[indexOfFirst + headSize]
    const options: { pitches: number[]; cost: number }[] = []
    const shift = window[0].pitch - head[0].pitch
    for (let steps = -5; steps <= 5; steps++) {
      // 調の音階に沿った移高(音程は±1半音まで同じ形として聞こえる)
      const base = head.map((note) => shiftInScale(note.pitch, steps, scale))
      for (const octave of [-12, 0, 12]) options.push({ pitches: base.map((pitch) => pitch + octave), cost: 0 })
    }
    for (let semis = shift - 3; semis <= shift + 3; semis++) options.push({ pitches: head.map((note) => note.pitch + semis), cost: .5 })
    // 頭を戻しても、そのフレーズで元々いちばん高かった音は超えず、セクションの頂点と同じ高さにもしない
    // (頂点の位置と、その前後の息継ぎを動かさない)
    const phraseTop = Math.max(...notes.filter((note) =>
      note.startBeat >= phrase.startBeat - 1e-6 && note.startBeat < phrase.startBeat + phrase.lengthBeats - 1e-6).map((note) => note.pitch))
    const windowTop = Math.max(...window.map((note) => note.pitch))
    // (長いセクションだけ。短いセクションでは頂点の位置が変わらず、Hook の戻りだけが減ったため)
    const sectionBeats = plan.phrases.at(-1)!.startBeat + plan.phrases.at(-1)!.lengthBeats
    const nearClimax = sectionBeats >= LONG_SECTION_BEATS && plan.climaxBeat !== undefined && phrase.startBeat + phrase.lengthBeats * 2 > plan.climaxBeat
    let best: { pitches: number[]; cost: number } | null = null
    for (const option of options) {
      if (option.pitches.some((pitch) => pitch < range.low || pitch > range.high || pitch > phraseTop || pitch >= summit.pitch)) continue
      // 頂点の目標位置に近いフレーズでは、頭の中の高い音も下げない(後半の高まりを削ると、頂点が前へずれてしまう)
      if (nearClimax && Math.max(...option.pitches) < windowTop) continue
      let valid = true
      option.pitches.forEach((pitch, index) => {
        const note = window[index]
        const entry = chordAtBeat(harmonicMap, note.startBeat)
        const chordTone = entry ? isChordTone(entry.parsed, pitchClass(pitch)) : true
        const onBeat = Math.abs(note.startBeat - Math.round(note.startBeat)) < 1e-6
        const next = index + 1 < option.pitches.length ? option.pitches[index + 1] : after?.pitch
        const passing = !onBeat && inScale(pitch) && next !== undefined && Math.abs(next - pitch) <= 2
        if (!chordTone && !passing) valid = false
      })
      if (!valid) continue
      if (after && Math.abs(after.pitch - option.pitches[option.pitches.length - 1]) > 5) continue
      if (before && Math.abs(option.pitches[0] - before.pitch) > 7) continue
      const cost = option.cost + option.pitches.reduce((sum, pitch, index) => sum + Math.abs(pitch - window[index].pitch), 0)
      if (!best || cost < best.cost) best = { pitches: option.pitches, cost }
    }
    if (!best || best.cost === 0) continue
    best.pitches.forEach((pitch, index) => {
      const note = window[index]
      const entry = chordAtBeat(harmonicMap, note.startBeat)
      note.pitch = pitch
      note.plannedToneRole = entry && isChordTone(entry.parsed, pitchClass(pitch)) ? "chord-tone" : "passing-tone"
      note.plannedResolution = undefined
    })
  }
  return notes
}
