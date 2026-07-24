/**
 * Melody Opening Intent / Opening Plan(冒頭設計)
 *
 * 同一Generator Profile内の3候補を、冒頭数秒の時点で別案として認識できるようにするための仕組み。
 * 目的は「開始音を単純にランダム化する」ことではなく、同じ美学を保ったまま各候補へ
 * 異なる「入り方(entryType)」「感情的役割(emotionalFunction)」「開始音域(register)」
 * 「最初の進行方向(initialDirection)」を与えること。
 *
 * 生成順序:
 *   Generator Profile → Opening Intent(3案まとめて計画) → Opening Plan → 各パイプラインの本体生成
 */
import type { SeededRandom } from "@/core/rng"
import type {
  MelodyNote,
  MelodyOpeningIntent,
  MelodyOpeningPlan,
  OpeningContour,
  OpeningEmotionalFunction,
  OpeningEntryType,
  OpeningInitialDirection,
  OpeningRegister,
} from "@/core/melody"
import type { MelodyGeneratorProfile } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { chordTonePitchClasses } from "@/core/chord"
import { nearestAllowedPitch } from "./pitchUtils"
import type { RangeSetting } from "./generationParams"

export const OPENING_ENTRY_LABELS: Record<OpeningEntryType, string> = {
  direct: "直接",
  pickup: "弱起",
  delayed: "間をおいて",
  suspension: "倚音から",
  "repeated-note": "同音反復",
  "leap-entry": "跳躍で",
}

export const OPENING_EMOTION_LABELS: Record<OpeningEmotionalFunction, string> = {
  statement: "宣言",
  question: "問いかけ",
  hesitation: "ためらい",
  invocation: "呼びかけ",
  warning: "警告",
  release: "解放",
}

export const OPENING_REGISTER_LABELS: Record<OpeningRegister, string> = {
  low: "低音域",
  middle: "中音域",
  high: "高音域",
}

export const OPENING_DIRECTION_LABELS: Record<OpeningInitialDirection, string> = {
  ascending: "上行",
  descending: "下行",
  static: "保続",
}

export interface OpeningCandidate {
  entryType: OpeningEntryType
  emotionalFunction: OpeningEmotionalFunction
  register: OpeningRegister
  initialDirection: OpeningInitialDirection
  /** Profile美学の中でどれだけ「らしい」入口か(選出時の重み) */
  weight: number
}

/**
 * Profileごとの、その美学に合った冒頭候補プール。
 * 3案はこの中から聴感的に重複しない組を選ぶ(Pattern番号への固定割り当てはしない)。
 */
export const PROFILE_OPENING_CANDIDATES: Record<MelodyGeneratorProfile, OpeningCandidate[]> = {
  // Standard: 自然なコードトーン。直接開始または弱起、順次進行主体。ルート開始は最大1案。
  standard: [
    { entryType: "direct", emotionalFunction: "statement", register: "middle", initialDirection: "ascending", weight: 1.2 },
    { entryType: "pickup", emotionalFunction: "question", register: "middle", initialDirection: "ascending", weight: 1 },
    { entryType: "direct", emotionalFunction: "statement", register: "high", initialDirection: "descending", weight: 0.9 },
    { entryType: "repeated-note", emotionalFunction: "statement", register: "middle", initialDirection: "static", weight: 0.7 },
    { entryType: "pickup", emotionalFunction: "release", register: "low", initialDirection: "ascending", weight: 0.7 },
  ],
  // Minimal: 5th/9th/共通音、休符後の開始、長い音価、狭い音域。沈黙の配置で差を作る。
  minimal: [
    { entryType: "delayed", emotionalFunction: "hesitation", register: "middle", initialDirection: "static", weight: 1.2 },
    { entryType: "direct", emotionalFunction: "statement", register: "high", initialDirection: "descending", weight: 0.9 },
    { entryType: "repeated-note", emotionalFunction: "invocation", register: "low", initialDirection: "static", weight: 1 },
    { entryType: "delayed", emotionalFunction: "release", register: "middle", initialDirection: "ascending", weight: 0.8 },
    { entryType: "suspension", emotionalFunction: "question", register: "high", initialDirection: "descending", weight: 0.7 },
  ],
  // Leaping: 中音域開始、跳躍は開始直後でなく構造点。跳躍後は順次で回収。3案すべてを大跳躍開始にしない。
  leaping: [
    { entryType: "direct", emotionalFunction: "statement", register: "middle", initialDirection: "ascending", weight: 1.1 },
    { entryType: "leap-entry", emotionalFunction: "warning", register: "middle", initialDirection: "descending", weight: 0.9 },
    { entryType: "pickup", emotionalFunction: "question", register: "low", initialDirection: "ascending", weight: 1 },
    { entryType: "direct", emotionalFunction: "release", register: "high", initialDirection: "descending", weight: 0.8 },
  ],
  // Rhythmic: 弱起、裏拍開始、シンコペーション、同音反復。冒頭Rhythm Skeletonを3案で明確に分ける。
  rhythmic: [
    { entryType: "pickup", emotionalFunction: "statement", register: "middle", initialDirection: "ascending", weight: 1.1 },
    { entryType: "repeated-note", emotionalFunction: "invocation", register: "middle", initialDirection: "static", weight: 1.1 },
    { entryType: "delayed", emotionalFunction: "question", register: "low", initialDirection: "ascending", weight: 0.9 },
    { entryType: "direct", emotionalFunction: "warning", register: "high", initialDirection: "descending", weight: 0.8 },
  ],
  // Chromatic: 倚音、半音アプローチ、suspension entry。非和声音には明確な目標音。アウトスケール乱発禁止。
  chromatic: [
    { entryType: "suspension", emotionalFunction: "hesitation", register: "middle", initialDirection: "descending", weight: 1.2 },
    { entryType: "direct", emotionalFunction: "warning", register: "high", initialDirection: "descending", weight: 0.9 },
    { entryType: "pickup", emotionalFunction: "question", register: "middle", initialDirection: "ascending", weight: 0.9 },
    { entryType: "delayed", emotionalFunction: "invocation", register: "low", initialDirection: "static", weight: 0.7 },
  ],
  // Cinematic: 低〜中音域開始、冒頭は抑制、最高音は後半へ温存。3案でクライマックスへの向かい方を変える。
  cinematic: [
    { entryType: "delayed", emotionalFunction: "invocation", register: "low", initialDirection: "ascending", weight: 1.2 },
    { entryType: "direct", emotionalFunction: "statement", register: "middle", initialDirection: "ascending", weight: 1 },
    { entryType: "repeated-note", emotionalFunction: "hesitation", register: "low", initialDirection: "static", weight: 0.9 },
    { entryType: "pickup", emotionalFunction: "release", register: "middle", initialDirection: "descending", weight: 0.7 },
  ],
  // Elegiac Cantabile: 3rd/5th/9th/倚音開始、弱起・ためらい・長い導入音、順次進行主体、跳躍は後続へ。
  // 内側へ沈む案・静かに開く案・遠くから近づく案などの入口差を作る。
  // 最高音は後半一度きりのクライマックスへ温存するため、開始は low/middle に限る(high は使わない)
  "elegiac-cantabile": [
    { entryType: "suspension", emotionalFunction: "hesitation", register: "middle", initialDirection: "descending", weight: 1.2 },
    { entryType: "delayed", emotionalFunction: "invocation", register: "low", initialDirection: "ascending", weight: 1.1 },
    { entryType: "direct", emotionalFunction: "statement", register: "middle", initialDirection: "descending", weight: 0.9 },
    { entryType: "pickup", emotionalFunction: "question", register: "middle", initialDirection: "ascending", weight: 1 },
    { entryType: "repeated-note", emotionalFunction: "release", register: "low", initialDirection: "static", weight: 0.7 },
  ],
  // Speech-Rhythmic: 音高よりAccent Map優先、同音反復、裏拍/小節線をまたぐ開始、不均等フレーズ長。
  "speech-rhythmic": [
    { entryType: "pickup", emotionalFunction: "statement", register: "middle", initialDirection: "static", weight: 1.2 },
    { entryType: "repeated-note", emotionalFunction: "invocation", register: "middle", initialDirection: "static", weight: 1.1 },
    { entryType: "delayed", emotionalFunction: "question", register: "low", initialDirection: "ascending", weight: 0.9 },
    { entryType: "direct", emotionalFunction: "warning", register: "middle", initialDirection: "descending", weight: 0.8 },
  ],
  // Incantatory: 2〜5音の核モチーフを冒頭から識別可能に。同音反復/半音型/短3度型。核・アクセント・変異周期を3案で分ける。
  incantatory: [
    { entryType: "repeated-note", emotionalFunction: "invocation", register: "middle", initialDirection: "static", weight: 1.2 },
    { entryType: "direct", emotionalFunction: "statement", register: "low", initialDirection: "ascending", weight: 1 },
    { entryType: "leap-entry", emotionalFunction: "warning", register: "middle", initialDirection: "descending", weight: 0.8 },
    { entryType: "delayed", emotionalFunction: "hesitation", register: "middle", initialDirection: "static", weight: 0.8 },
  ],
}

type IntentLike = Pick<OpeningCandidate, "entryType" | "initialDirection" | "register" | "emotionalFunction">

/** 2つのIntentが聴感的にどれだけ異なるか(大きいほど別物)。3案の重複回避に使う */
function intentDistinctScore(a: IntentLike, b: IntentLike): number {
  let diff = 0
  if (a.entryType !== b.entryType) diff += 2
  if (a.initialDirection !== b.initialDirection) diff += 2
  if (a.register !== b.register) diff += 1
  if (a.emotionalFunction !== b.emotionalFunction) diff += 1
  return diff
}

/**
 * Profileに適した候補プールから、聴感的に重複しない3つのOpening Intentを選ぶ。
 * Pattern番号への固定割り当て(1=direct/2=pickup/3=delayed)はせず、毎回rngで選出する。
 */
export function planOpeningIntents(rng: SeededRandom, profile: MelodyGeneratorProfile, count = 3): MelodyOpeningIntent[] {
  const pool = [...PROFILE_OPENING_CANDIDATES[profile]]
  const chosen: OpeningCandidate[] = []

  // 1つ目は重み付きで選ぶ
  const first = weightedPick(rng, pool)
  chosen.push(first)

  // 2つ目以降は「既選択との最小差分 × 元の重み」で選び、多様性を確保する
  while (chosen.length < count && pool.length > chosen.length) {
    const remaining = pool.filter((c) => !chosen.includes(c))
    if (remaining.length === 0) break
    const scored = remaining.map((c) => {
      const minDistinct = Math.min(...chosen.map((x) => intentDistinctScore(c, x)))
      return { c, score: (minDistinct + 0.5) * c.weight }
    })
    // スコア最大群からrngで1つ選ぶ(決定論を保ちつつ固定順を避ける)
    const maxScore = Math.max(...scored.map((s) => s.score))
    const top = scored.filter((s) => s.score >= maxScore - 0.6).map((s) => s.c)
    chosen.push(rng.pick(top))
  }

  // プールが3未満だった場合の保険(基本的に各Profileは4件以上持たせている)
  while (chosen.length < count) chosen.push(chosen[chosen.length - 1])

  return chosen.map(({ entryType, emotionalFunction, register, initialDirection }) => ({
    entryType,
    emotionalFunction,
    register,
    initialDirection,
  }))
}

function weightedPick(rng: SeededRandom, pool: OpeningCandidate[]): OpeningCandidate {
  return rng.weightedPick(pool, pool.map((c) => c.weight))
}

/** 再生成時に、既存(他2案)のIntentと最も異なる候補を選ぶ */
export function pickDistinctIntent(
  rng: SeededRandom,
  profile: MelodyGeneratorProfile,
  avoid: MelodyOpeningIntent[],
): MelodyOpeningIntent {
  const pool = PROFILE_OPENING_CANDIDATES[profile]
  const scored = pool.map((c) => {
    const minDistinct = avoid.length === 0 ? 4 : Math.min(...avoid.map((x) => intentDistinctScore(c, x as unknown as OpeningCandidate)))
    return { c, score: (minDistinct + 0.5) * c.weight }
  })
  const maxScore = Math.max(...scored.map((s) => s.score))
  const top = scored.filter((s) => s.score >= maxScore - 0.6).map((s) => s.c)
  const chosen = rng.pick(top)
  return { entryType: chosen.entryType, emotionalFunction: chosen.emotionalFunction, register: chosen.register, initialDirection: chosen.initialDirection }
}

/** register(low/middle/high)を実レンジ内の帯へ写像する */
export function registerBand(register: OpeningRegister, range: RangeSetting): { lowestMidiNote: number; highestMidiNote: number } {
  const span = range.high - range.low
  if (register === "low") return { lowestMidiNote: range.low, highestMidiNote: Math.round(range.low + span * 0.45) }
  if (register === "high") return { lowestMidiNote: Math.round(range.high - span * 0.45), highestMidiNote: range.high }
  return { lowestMidiNote: Math.round(range.low + span * 0.28), highestMidiNote: Math.round(range.high - span * 0.28) }
}

/** 計画した音域帯を実レンジへ収めた探索範囲を返す(bespoke パイプライン共通) */
export function openingBand(opening: MelodyOpeningPlan, range: RangeSetting): RangeSetting {
  const low = Math.max(range.low, Math.min(opening.openingRegister.lowestMidiNote, range.high - 2))
  const high = Math.min(range.high, Math.max(opening.openingRegister.highestMidiNote, low + 2))
  return { low, high }
}

/** 計画した開始ピッチクラスを、計画した音域帯の中で最も近い具体MIDIへ落とす(bespoke パイプライン共通) */
export function openingStartMidi(opening: MelodyOpeningPlan, range: RangeSetting): number {
  const band = openingBand(opening, range)
  const mid = Math.round((band.low + band.high) / 2)
  return nearestAllowedPitch(mid, [opening.startPitchClass], band)
}

/** initialDirection の符号(+1/0/-1)。bespoke パイプライン共通 */
export function openingDirectionSign(opening: MelodyOpeningPlan): number {
  return opening.initialDirection === "ascending" ? 1 : opening.initialDirection === "descending" ? -1 : 0
}

function entryTypeToContour(entryType: OpeningEntryType): OpeningContour {
  switch (entryType) {
    case "suspension":
      return "suspension-entry"
    case "pickup":
      return "pickup-resolution"
    case "repeated-note":
      return "repeated-note"
    case "leap-entry":
      return "leap-then-recover"
    default:
      return "stepwise"
  }
}

/** entryTypeに応じた開始拍オフセット(弱起/休符後開始/直接) */
function entryOffset(rng: SeededRandom, entryType: OpeningEntryType): number {
  switch (entryType) {
    case "pickup":
      return rng.pick([0.5, 1])
    case "delayed":
      return rng.pick([1, 1.5, 2])
    default:
      return 0
  }
}

/** entryTypeに応じた最初の音価(長い導入音/短い食い込み) */
function firstDurationFor(rng: SeededRandom, entryType: OpeningEntryType, emotional: OpeningEmotionalFunction): number {
  if (entryType === "pickup") return rng.pick([0.5, 0.5, 1])
  if (entryType === "repeated-note") return rng.pick([0.5, 1])
  if (entryType === "delayed" || emotional === "invocation" || emotional === "hesitation") return rng.pick([1.5, 2, 2])
  if (entryType === "suspension") return rng.pick([1, 1.5])
  return rng.pick([1, 1.5, 2])
}

/**
 * Opening IntentをOpening Planへ変換する。開始音だけでなく、開始拍・最初の音価・音域・進行方向・
 * 冒頭輪郭・冒頭フレーズ長・弱起や休符の有無・感情的機能を計画段階で分ける。
 */
export function openingIntentToPlan(
  rng: SeededRandom,
  intent: MelodyOpeningIntent,
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
): MelodyOpeningPlan {
  const band = registerBand(intent.register, range)
  const offset = entryOffset(rng, intent.entryType)
  const firstEntry = chordAtBeat(harmonicMap, offset)
  const chordTones = firstEntry ? chordTonePitchClasses(firstEntry.parsed) : [0, 4, 7]
  const rootPc = firstEntry?.parsed.rootPc ?? 0

  // 開始ピッチクラス: entryTypeとregisterに応じて選ぶ。
  // suspension/chromatic系はコードトーンの半音上/下(倚音)を目標音つきで選ぶ。
  let startPitchClass: number
  if (intent.entryType === "suspension") {
    const target = rng.pick(chordTones)
    startPitchClass = ((target + (rng.chance(0.5) ? 1 : -1)) % 12 + 12) % 12
  } else {
    // ルート開始は避け気味にし、3rd/5th/9thや共通音を優先する
    const nonRoot = chordTones.filter((pc) => pc !== rootPc)
    const pool = intent.emotionalFunction === "statement" ? chordTones : nonRoot.length > 0 ? nonRoot : chordTones
    startPitchClass = rng.pick(pool)
  }
  const startScaleDegree = ((startPitchClass - rootPc + 12) % 12)

  const phraseLen = rng.pick([4, 6, 8])

  return {
    intent,
    startPitchClass,
    startScaleDegree,
    startBeatOffset: offset,
    firstNoteDuration: firstDurationFor(rng, intent.entryType, intent.emotionalFunction),
    initialDirection: intent.initialDirection,
    openingContour: entryTypeToContour(intent.entryType),
    openingRegister: band,
    openingPhraseLengthBeats: phraseLen,
  }
}

// ---- 冒頭類似度の計算 --------------------------------------------------------

export interface OpeningFeatures {
  startPitch: number
  startBeat: number
  firstDuration: number
  intervals: number[] // 冒頭3〜5音の音程列
  onsets: number[] // 冒頭のオンセット間隔
  contourSigns: number[] // 音程の符号(-1/0/1)
  register: number // 冒頭音の平均MIDI
}

const OPENING_NOTE_COUNT = 5

/** ノート列の冒頭部分(最大5音)から、類似度計算用の特徴を抽出する */
export function extractOpeningFeatures(notes: MelodyNote[]): OpeningFeatures | null {
  if (notes.length === 0) return null
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat).slice(0, OPENING_NOTE_COUNT)
  const pitches = sorted.map((n) => n.pitch)
  const intervals = pitches.slice(1).map((p, i) => p - pitches[i])
  const onsets = sorted.slice(1).map((n, i) => n.startBeat - sorted[i].startBeat)
  return {
    startPitch: pitches[0],
    startBeat: sorted[0].startBeat,
    firstDuration: sorted[0].durationBeats,
    intervals,
    onsets,
    contourSigns: intervals.map((iv) => Math.sign(iv)),
    register: pitches.reduce((a, b) => a + b, 0) / pitches.length,
  }
}

function seqSimilarity(a: number[], b: number[], tolerance: number): number {
  const len = Math.max(a.length, b.length)
  if (len === 0) return 1
  let match = 0
  for (let i = 0; i < len; i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined || y === undefined) continue
    if (Math.abs(x - y) <= tolerance) match++
  }
  return match / len
}

const OPENING_WEIGHTS = {
  pitchContour: 0.3,
  rhythm: 0.25,
  entryTiming: 0.15,
  register: 0.1,
  intent: 0.1,
  phraseLength: 0.1,
}

/**
 * 2候補の「冒頭」の似ている度合いを [0,1] で返す(1=ほぼ同一の入口)。
 * 全体類似度とは別に、冒頭1〜2小節に特化した重み付けを用いる。
 */
export function openingSimilarity(
  a: { notes: MelodyNote[]; plan?: MelodyOpeningPlan },
  b: { notes: MelodyNote[]; plan?: MelodyOpeningPlan },
): number {
  const fa = extractOpeningFeatures(a.notes)
  const fb = extractOpeningFeatures(b.notes)
  if (!fa || !fb) return 0

  // 冒頭ピッチ&輪郭: 開始音の近さ + 音程列 + 輪郭符号列
  const startPitchSim = 1 - Math.min(1, Math.abs(fa.startPitch - fb.startPitch) / 12)
  const intervalSim = seqSimilarity(fa.intervals, fb.intervals, 1)
  const contourSim = seqSimilarity(fa.contourSigns, fb.contourSigns, 0)
  const pitchContourSim = startPitchSim * 0.4 + intervalSim * 0.35 + contourSim * 0.25

  // 冒頭リズム: オンセット間隔 + 最初の音価
  const onsetSim = seqSimilarity(fa.onsets, fb.onsets, 0.25)
  const firstDurSim = 1 - Math.min(1, Math.abs(fa.firstDuration - fb.firstDuration) / 2)
  const rhythmSim = onsetSim * 0.7 + firstDurSim * 0.3

  // 開始タイミング(弱起/強拍)
  const entryTimingSim = 1 - Math.min(1, Math.abs(fa.startBeat - fb.startBeat) / 2)

  // 音域
  const registerSim = 1 - Math.min(1, Math.abs(fa.register - fb.register) / 12)

  // Opening Intent(型が分かる場合のみ。無ければ中立0.5)
  let intentSim = 0.5
  if (a.plan && b.plan) {
    const ea = a.plan.intent
    const eb = b.plan.intent
    intentSim =
      (ea.entryType === eb.entryType ? 0.4 : 0) +
      (ea.initialDirection === eb.initialDirection ? 0.3 : 0) +
      (ea.register === eb.register ? 0.15 : 0) +
      (ea.emotionalFunction === eb.emotionalFunction ? 0.15 : 0)
  }

  // 冒頭フレーズ長
  let phraseLenSim = 0.5
  if (a.plan && b.plan) {
    phraseLenSim = 1 - Math.min(1, Math.abs(a.plan.openingPhraseLengthBeats - b.plan.openingPhraseLengthBeats) / 8)
  }

  return (
    pitchContourSim * OPENING_WEIGHTS.pitchContour +
    rhythmSim * OPENING_WEIGHTS.rhythm +
    entryTimingSim * OPENING_WEIGHTS.entryTiming +
    registerSim * OPENING_WEIGHTS.register +
    intentSim * OPENING_WEIGHTS.intent +
    phraseLenSim * OPENING_WEIGHTS.phraseLength
  )
}

export const OPENING_SIMILARITY_MAX = 0.7
export const MAX_OPENING_REGEN_ATTEMPTS = 5

// ---- テスト・評価用ヘルパー --------------------------------------------------

export function countDistinctEntryTypes(intents: MelodyOpeningIntent[]): number {
  return new Set(intents.map((i) => i.entryType)).size
}

export function countDistinctInitialDirections(intents: MelodyOpeningIntent[]): number {
  return new Set(intents.map((i) => i.initialDirection)).size
}

export function countDistinctOpeningContours(plans: MelodyOpeningPlan[]): number {
  return new Set(plans.map((p) => p.openingContour)).size
}

/**
 * 3案の冒頭ノートが「単なる移高(トランスポーズ)関係」になっていないか。
 * 冒頭のリズム(オンセット・音価)が一致し、かつ音程列も一致する(=定数分ずらしただけ)ペアがあればtrue。
 */
export function hasIdenticalOpeningNotesWithOnlyTransposition(patterns: MelodyNote[][]): boolean {
  const feats = patterns.map(extractOpeningFeatures)
  for (let i = 0; i < feats.length; i++) {
    for (let j = i + 1; j < feats.length; j++) {
      const a = feats[i]
      const b = feats[j]
      if (!a || !b) continue
      const n = Math.min(a.intervals.length, b.intervals.length, a.onsets.length, b.onsets.length)
      if (n < 2) continue
      const sameRhythm =
        a.onsets.slice(0, n).every((o, k) => Math.abs(o - b.onsets[k]) < 1e-6) &&
        Math.abs(a.firstDuration - b.firstDuration) < 1e-6
      const sameIntervals = a.intervals.slice(0, n).every((iv, k) => iv === b.intervals[k])
      if (sameRhythm && sameIntervals) return true
    }
  }
  return false
}
