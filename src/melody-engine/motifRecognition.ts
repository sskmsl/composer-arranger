import type { MelodyNote } from "@/core/melody"

/**
 * 核(Core Hook)と、その後の各単位の関係を測る(展開の操作そのものは motifDevelopment.ts / hookDevelopment.ts)。
 * tools/melody-reference/analyze_motif_development.py と同じ分類で、
 * Schumann / Brahms の公開楽譜で数えた割合は reference/composerPrinciples.json に数値だけ残している。
 *
 *   exact / sequence / register : 同じ音程(調の中の移高は±1半音まで同じとみなす)とリズム
 *   tail      : 頭は同じで語尾だけ違う(小変形)
 *   truncated / extended : 頭だけ / 後ろへ伸ばした形
 *   rhythm    : リズムは同じで音程が違う(発展的変奏で最も多い)
 *   interval  : 音程は同じでリズムが違う
 *   deletion  : 1音を抜いた形
 *   small     : 違いが3割以下
 *   other     : 別の素材
 */
export type MotifRelation =
  | "exact" | "sequence" | "register" | "tail" | "truncated" | "extended"
  | "rhythm" | "interval" | "deletion" | "small" | "other"

export const LITERAL_RELATIONS: readonly MotifRelation[] = ["exact", "sequence", "register"]
export const RECOGNIZABLE_RELATIONS: readonly MotifRelation[] = [
  "exact", "sequence", "register", "tail", "truncated", "extended", "rhythm", "interval", "deletion", "small",
]

interface Token { interval: number | null; gap: number }

function sameInterval(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === null && b === null
  return (a === 0 && b === 0) || (a * b > 0 && Math.abs(a - b) <= 1)
}

function tokensOf(notes: readonly MelodyNote[], start: number): Token[] {
  return notes.map((note, index) => ({
    interval: index === 0 ? null : note.pitch - notes[index - 1].pitch,
    gap: Math.round((note.startBeat - (index === 0 ? start : notes[index - 1].startBeat)) * 1000) / 1000,
  }))
}

const sameToken = (a: Token, b: Token) => sameInterval(a.interval, b.interval) && Math.abs(a.gap - b.gap) < .02

function fuzzyDistance(a: Token[], b: Token[]): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (sameToken(a[i - 1], b[j - 1]) ? 0 : 1))
      previous = current
    }
  }
  return row[b.length] / Math.max(1, a.length, b.length)
}

/** 核と、ある窓の関係を1つに決める(分析スクリプトと同じ優先順) */
export function classifyMotifRelation(
  core: readonly MelodyNote[],
  coreStart: number,
  candidate: readonly MelodyNote[],
  candidateStart: number,
): { relation: MotifRelation; distance: number } {
  if (candidate.length < 2 || core.length < 3) return { relation: "other", distance: 1 }
  const ct = tokensOf(core, coreStart)
  const wt = tokensOf(candidate, candidateStart)
  const rhythmSame = ct.length === wt.length && ct.every((token, index) => Math.abs(token.gap - wt[index].gap) < .02)
  const intervalSame = ct.length === wt.length && ct.every((token, index) => sameInterval(token.interval, wt[index].interval))
  const transposition = candidate[0].pitch - core[0].pitch
  if (rhythmSame && intervalSame) {
    const exactIntervals = ct.every((token, index) => token.interval === wt[index].interval)
    if (transposition === 0 && exactIntervals) return { relation: "exact", distance: 0 }
    if (transposition % 12 === 0 && exactIntervals) return { relation: "register", distance: 0 }
    return { relation: "sequence", distance: 0 }
  }
  const distance = fuzzyDistance(ct, wt)
  const head = Math.max(2, Math.ceil(ct.length / 2))
  if (wt.length >= head && ct.slice(0, head).every((token, index) => sameToken(token, wt[index]))) {
    if (wt.length < ct.length && wt.every((token, index) => sameToken(ct[index], token))) return { relation: "truncated", distance }
    if (wt.length > ct.length && ct.every((token, index) => sameToken(token, wt[index]))) return { relation: "extended", distance }
    return { relation: "tail", distance }
  }
  if (rhythmSame) return { relation: "rhythm", distance }
  if (intervalSame) return { relation: "interval", distance }
  if (wt.length === ct.length - 1) {
    for (let skip = 1; skip < core.length; skip++) {
      const reduced = tokensOf(core.filter((_, index) => index !== skip), coreStart)
      if (reduced.every((token, index) => sameInterval(token.interval, wt[index]?.interval ?? null))) return { relation: "deletion", distance }
    }
  }
  return { relation: distance <= .34 ? "small" : "other", distance }
}

export interface MotifDevelopmentProfile {
  /** 核の後の各単位の関係(時間順) */
  relations: MotifRelation[]
  /** 核だと分かる形で戻ってくる単位の割合 */
  recognizableShare: number
  /** 戻ってきた形がすべて字義どおりの反復か */
  literalOnly: boolean
  /** 使った変形の種類の数(字義どおりの反復は数えない) */
  transformKinds: number
  /** 最後の2単位のどこかで核が戻るか */
  lateReturn: boolean
  /** 核に無い音高クラスが後から入る割合 */
  newPitchShare: number
  /** 変形の量(戻ってきた単位の変化の割合の平均) */
  meanChange: number
  /** 上の値をまとめた「覚えたまま育っているか」(0〜1) */
  score: number
}

/**
 * 旋律を核の長さごとの単位に分け、核との関係を測る。
 * 目標は「同じ Hook だと分かる + しかし展開している」:
 * 戻りが多く(Boutonnat 的な反復)、字義どおりだけではなく、変形は2種類まで(分析した2人とも1フレーズの中央値が2種類)、
 * 最後に核が戻り、新しい音を足しすぎない。
 */
export function measureMotifDevelopment(
  source: readonly MelodyNote[],
  coreLengthBeats: number,
  totalBeats: number,
): MotifDevelopmentProfile {
  const notes = [...source].sort((a, b) => a.startBeat - b.startBeat)
  const unit = Math.max(1, coreLengthBeats)
  const empty: MotifDevelopmentProfile = {
    relations: [], recognizableShare: 0, literalOnly: false, transformKinds: 0, lateReturn: false, newPitchShare: 0, meanChange: 0, score: 0,
  }
  if (notes.length === 0) return empty
  const coreStart = Math.floor(notes[0].startBeat / unit) * unit
  const inWindow = (start: number) => notes.filter((note) => note.startBeat >= start - 1e-6 && note.startBeat < start + unit - 1e-6)
  const core = inWindow(coreStart)
  if (core.length < 3) return empty
  const corePcs = new Set(core.map((note) => ((note.pitch % 12) + 12) % 12))
  const relations: MotifRelation[] = []
  const changes: number[] = []
  let newPitchNotes = 0
  let laterNotes = 0
  for (let start = coreStart + unit; start + unit <= totalBeats + 1e-6; start += unit) {
    const window = inWindow(start)
    if (window.length === 0) continue
    // フレーズの頭が少し遅れて入る場合も同じ単位として比べる(弱起・休符からの入り)
    const offset = window[0].startBeat - start - (core[0].startBeat - coreStart)
    const { relation, distance } = classifyMotifRelation(core, coreStart, window, start + offset)
    relations.push(relation)
    if (relation !== "other") changes.push(distance)
    laterNotes += window.length
    newPitchNotes += window.filter((note) => !corePcs.has(((note.pitch % 12) + 12) % 12)).length
  }
  if (relations.length === 0) return empty
  const recognized = relations.filter((relation) => RECOGNIZABLE_RELATIONS.includes(relation))
  const recognizableShare = recognized.length / relations.length
  const literalOnly = recognized.length > 0 && recognized.every((relation) => LITERAL_RELATIONS.includes(relation))
  const transformKinds = new Set(recognized.filter((relation) => !LITERAL_RELATIONS.includes(relation))).size
  const lateReturn = relations.slice(-2).some((relation) => RECOGNIZABLE_RELATIONS.includes(relation))
  const newPitchShare = laterNotes > 0 ? newPitchNotes / laterNotes : 0
  const meanChange = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0
  // 戻りは半分以上あると Hook が保たれる(8小節で2〜4回)。変形は1〜2種類が最もよく、3種類以上は散らかる。
  const recognition = Math.min(1, recognizableShare / .5)
  const variety = transformKinds === 0 ? .35 : transformKinds <= 2 ? 1 : Math.max(0, 1 - (transformKinds - 2) * .35)
  const restraint = meanChange <= .5 ? 1 : Math.max(0, 1 - (meanChange - .5) * 2)
  const economy = newPitchShare <= .5 ? 1 : Math.max(0, 1 - (newPitchShare - .5) * 2)
  const score = recognition * .38 + variety * .24 + (lateReturn ? 1 : 0) * .16 + restraint * .12 + economy * .1
  return { relations, recognizableShare, literalOnly, transformKinds, lateReturn, newPitchShare, meanChange, score }
}
