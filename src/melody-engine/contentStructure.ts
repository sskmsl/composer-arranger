import type { MelodyNote } from "@/core/melody"
import { pitchClass } from "@/core/note"
import type { ContentStructureFeatures, ResolvedLeadContent, SectionContentPlan } from "@/core/sectionContent"

const EPS = 1e-6

/**
 * Issue #41: 第2段階の本格的な品質スコアの前に、第1段階で
 * 「Mode名だけ違い、実音は似る」候補を検出するための構造特徴量。
 */
export function computeContentStructureFeatures(
  notes: MelodyNote[],
  plan: SectionContentPlan,
  totalBeats: number,
): ContentStructureFeatures {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const pitches = sorted.map((note) => note.pitch)
  const intervalSequence = pitches.slice(1).map((pitch, i) => pitch - pitches[i])
  const onsetPattern = sorted.map((note) => note.startBeat)
  const durationPattern = sorted.map((note) => note.durationBeats)
  const soundingBeats = durationPattern.reduce((sum, d) => sum + d, 0)
  // 「長い持続音」の定義は1拍以上。Droneは大半がこれに該当する
  const sustainBeats = sorted.filter((note) => note.durationBeats >= 1).reduce((sum, note) => sum + note.durationBeats, 0)
  const span = Math.max(EPS, totalBeats)

  const recurrence = detectPeriodicity(sorted, plan.cellLengthBeats)

  return {
    content: plan.content,
    entryOffsetBeats: plan.entryOffsetBeats,
    pitchClassCardinality: new Set(pitches.map((p) => pitchClass(p))).size,
    intervalSequence,
    onsetPattern,
    durationPattern,
    sustainRatio: soundingBeats > EPS ? sustainBeats / soundingBeats : 0,
    restRatio: Math.max(0, 1 - soundingBeats / span),
    recurrencePeriodBeats: recurrence.periodBeats,
    recurrenceStrength: recurrence.strength,
    registerCenter: pitches.length > 0 ? pitches.reduce((sum, p) => sum + p, 0) / pitches.length : 0,
    contour: intervalSequence.map((interval) => Math.sign(interval)),
  }
}

/**
 * 周期性の強さ。plan の周期長を手がかりに、各周期の同じ位置へ
 * 同じ相対オンセット・同じ音程差が再出現しているかを測る。
 * Ostinatoは高く、Motifの疎な反復は低くなる。
 */
export function detectPeriodicity(
  notes: MelodyNote[],
  hintPeriodBeats: number,
): { periodBeats?: number; strength: number } {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  if (sorted.length < 4 || hintPeriodBeats <= EPS) return { strength: 0 }

  const start = sorted[0].startBeat
  const cycles = new Map<number, { offset: number; pitch: number }[]>()
  for (const note of sorted) {
    const cycleIndex = Math.floor((note.startBeat - start) / hintPeriodBeats + EPS)
    const offset = Number(((note.startBeat - start) % hintPeriodBeats).toFixed(4))
    if (!cycles.has(cycleIndex)) cycles.set(cycleIndex, [])
    cycles.get(cycleIndex)!.push({ offset, pitch: note.pitch })
  }
  const groups = [...cycles.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  if (groups.length < 2) return { periodBeats: hintPeriodBeats, strength: 0 }

  // 先頭周期をリファレンスに、以降の周期がどれだけ同じ形か
  const reference = groups[0]
  let matched = 0
  let compared = 0
  for (const group of groups.slice(1)) {
    for (const item of group) {
      compared++
      const hit = reference.find((ref) => Math.abs(ref.offset - item.offset) < 0.05)
      if (!hit) continue
      // 同じ拍位置にあり、音高も同じか近い(周期内の1音変異は許容する)
      if (Math.abs(hit.pitch - item.pitch) <= 2) matched++
    }
  }
  return { periodBeats: hintPeriodBeats, strength: compared > 0 ? matched / compared : 0 }
}

function normalizedDistance(a: number, b: number, scale: number): number {
  return Math.min(1, Math.abs(a - b) / Math.max(EPS, scale))
}

/** 2つの数列の一致度(0..1)。長さ違いは短い側で比較し、長さ差もペナルティにする */
function sequenceSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0
  const length = Math.min(a.length, b.length)
  let same = 0
  for (let i = 0; i < length; i++) {
    if (Math.abs(a[i] - b[i]) < 0.05) same++
  }
  const lengthRatio = length / Math.max(a.length, b.length)
  return (same / length) * lengthRatio
}

/** Issue #41 推奨の類似度軸と重み */
export const CONTENT_SIMILARITY_WEIGHTS = {
  entryTiming: 0.15,
  intervalPitch: 0.15,
  rhythmOnset: 0.2,
  recurrencePattern: 0.2,
  sustainRest: 0.15,
  register: 0.05,
  contentGrammar: 0.1,
} as const

/** これ以上似ている候補は作り直す(実測分布と試聴で調整する初期閾値) */
export const CONTENT_SIMILARITY_MAX = 0.7

export interface ContentSimilarityBreakdown {
  entryTiming: number
  intervalPitch: number
  rhythmOnset: number
  recurrencePattern: number
  sustainRest: number
  register: number
  contentGrammar: number
  overall: number
}

/**
 * content候補どうしの類似度。ラベルが違っても実音が似ていれば高く出る。
 * 「開始音だけ / 移高だけ / 音価倍率だけが違う」候補を弾くための指標。
 */
export function contentSimilarity(
  a: ContentStructureFeatures,
  b: ContentStructureFeatures,
): ContentSimilarityBreakdown {
  const entryTiming = 1 - normalizedDistance(a.entryOffsetBeats, b.entryOffsetBeats, 8)
  // 音程列は移高に不変なので、移高だけが違う候補はここで高く出る
  const intervalPitch = sequenceSimilarity(a.intervalSequence, b.intervalSequence)
  const rhythmOnset = sequenceSimilarity(a.onsetPattern, b.onsetPattern)
  const recurrencePattern =
    1 -
    Math.min(
      1,
      Math.abs(a.recurrenceStrength - b.recurrenceStrength) +
        normalizedDistance(a.recurrencePeriodBeats ?? 0, b.recurrencePeriodBeats ?? 0, 8),
    )
  const sustainRest =
    1 - Math.min(1, Math.abs(a.sustainRatio - b.sustainRatio) + Math.abs(a.restRatio - b.restRatio))
  const register = 1 - normalizedDistance(a.registerCenter, b.registerCenter, 12)
  const contentGrammar = a.content === b.content ? 1 : 0

  const w = CONTENT_SIMILARITY_WEIGHTS
  const overall =
    entryTiming * w.entryTiming +
    intervalPitch * w.intervalPitch +
    rhythmOnset * w.rhythmOnset +
    recurrencePattern * w.recurrencePattern +
    sustainRest * w.sustainRest +
    register * w.register +
    contentGrammar * w.contentGrammar

  return { entryTiming, intervalPitch, rhythmOnset, recurrencePattern, sustainRest, register, contentGrammar, overall }
}

/**
 * 2候補が同じBase Melodyを共有しているか。
 * 音程列とオンセット列の両方がほぼ一致していれば、音価や移高を変えただけの
 * 同一素材と判断する(melody / motif / ostinato が同じ骨格を使う事故の検出)。
 */
export function hasSharedBaseMelody(a: MelodyNote[], b: MelodyNote[]): boolean {
  const intervalsA = intervalsOf(a)
  const intervalsB = intervalsOf(b)
  const onsetsA = onsetsOf(a)
  const onsetsB = onsetsOf(b)
  if (intervalsA.length === 0 || intervalsB.length === 0) return false
  return sequenceSimilarity(intervalsA, intervalsB) > 0.85 && sequenceSimilarity(onsetsA, onsetsB) > 0.85
}

/**
 * 一方が他方の単純な移高コピーか。
 * 音程列と音価列が完全一致し、全音高の差が一定であれば移高だけの違い。
 */
export function isOnlyTransposedCopy(a: MelodyNote[], b: MelodyNote[]): boolean {
  const sortedA = [...a].sort((x, y) => x.startBeat - y.startBeat)
  const sortedB = [...b].sort((x, y) => x.startBeat - y.startBeat)
  if (sortedA.length !== sortedB.length || sortedA.length === 0) return false
  const delta = sortedB[0].pitch - sortedA[0].pitch
  for (let i = 0; i < sortedA.length; i++) {
    if (Math.abs(sortedA[i].startBeat - sortedB[i].startBeat) > 0.05) return false
    if (Math.abs(sortedA[i].durationBeats - sortedB[i].durationBeats) > 0.05) return false
    if (sortedB[i].pitch - sortedA[i].pitch !== delta) return false
  }
  return true
}

function intervalsOf(notes: MelodyNote[]): number[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  return sorted.slice(1).map((note, i) => note.pitch - sorted[i].pitch)
}

function onsetsOf(notes: MelodyNote[]): number[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  const first = sorted[0]?.startBeat ?? 0
  return sorted.map((note) => note.startBeat - first)
}

export interface StructuralValidation {
  ok: boolean
  problems: string[]
}

/**
 * content別の最低限の構造検証。
 * 第2段階の品質スコアの代わりではなく、「そのcontentとして成立していない」
 * 生成結果(Droneが同音連打になっている等)を弾くための下限チェック。
 */
export function validateContentStructure(
  features: ContentStructureFeatures,
  plan: SectionContentPlan,
  notes: MelodyNote[],
  totalBeats: number,
): StructuralValidation {
  const problems: string[] = []
  const content: ResolvedLeadContent = plan.content

  const early = notes.filter((note) => note.startBeat < plan.entryOffsetBeats - EPS)
  if (early.length > 0) problems.push("entryOffsetより前にリードノートがある")

  if (content === "melody") {
    // melody は歌うべき内容なので、鳴らせる区間があるのに0音なら成立していない。
    // (Autoがmelodyを選んだのに実音が作られなかった場合をここで捕まえる)
    const hasRoom = plan.entryOffsetBeats + plan.pickupBeats < totalBeats - EPS
    if (hasRoom && notes.length === 0) problems.push("Melodyの実音が生成されていない")
  }

  if (content === "motif") {
    if (notes.length < 2) problems.push("Motifの音数が2音未満")
    // 2〜5音の核が識別できること。核1回あたりの音数で見る
    if (plan.cellDurations.length < 2 || plan.cellDurations.length > 5) {
      problems.push("Motifの核が2〜5音の範囲外")
    }
    // 疎な反復であること(隙間なく続くと通常のフレーズになる)
    if (features.restRatio < 0.1) problems.push("Motifに余白がなく通常フレーズ化している")
  }

  if (content === "ostinato") {
    if (features.recurrenceStrength < 0.5) problems.push("Ostinatoの周期性が弱い")
    if (plan.repetitionCount < 2) problems.push("Ostinatoの周期が2周未満")
  }

  if (content === "drone") {
    if (features.pitchClassCardinality > 2) problems.push("Droneのピッチクラスが3種類以上")
    if (features.sustainRatio < 0.8) problems.push("Droneの持続比率が低く同音反復に近い")
  }

  if (content === "none") {
    // primary は0音であることが正しい状態。ここでは侵入だけを見る
    if (plan.repetitionCount !== 0) problems.push("noneに反復計画が入っている")
  }

  return { ok: problems.length === 0, problems }
}
