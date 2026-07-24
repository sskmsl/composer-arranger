/**
 * Elegiac Cantabile Generator Profile (Melody Candidate Diversity v1.2 §3)
 *
 * 生成順序: phrase arc → climax → target tones → melodic line
 * (既存Cinematicのパラメータ変更版として実装しない。歌唱的な単旋律線そのものを
 * 目的として、長い呼吸・順次進行主体・倚音/遅延解決・後半一度きりのクライマックスを
 * 明示的に設計する専用パイプライン)
 */
import type { SeededRandom } from "@/core/rng"
import type { MelodyNote } from "@/core/melody"
import type { HarmonicMapEntry } from "./harmonicMap"
import { chordAtBeat } from "./harmonicMap"
import { chordTonePitchClasses, allUsablePitchClasses, type ParsedChord } from "@/core/chord"
import { nearestAllowedPitch } from "./pitchUtils"
import type { RangeSetting } from "./generationParams"
import type { CandidateMelodyDNA, MelodyOpeningPlan, SongMotifDNA } from "@/core/melody"
import { openingBand, openingDirectionSign, openingStartMidi } from "./openingIntent"
import { phraseLengthsForDNA } from "./candidateMelodyDNA"

const PHRASE_UNIT_BEATS = 16

export type CadenceDegree = "third" | "fifth" | "majorSeventh" | "ninth"

export interface ElegiacPatternPlan {
  climaxFraction: number
  contourOrder: "rise-first" | "fall-first"
  cadenceDegree: CadenceDegree
  appoggiaturaBias: number
  breathFraction: number
  anchorCount: number
}

interface AnchorBeat {
  beat: number
  role: "start" | "climax" | "cadence" | "passing"
}

interface Anchor extends AnchorBeat {
  pitch: number
}

function cadenceInterval(degree: CadenceDegree, chord: ParsedChord): number {
  switch (degree) {
    case "third":
      return chord.isMinor ? 3 : 4
    case "fifth":
      return 7
    case "majorSeventh":
      return 11
    case "ninth":
      return 14
  }
}

/** noteDensity(0..1)からアンカー数を決める(intensityで通常密度側へ補間) */
function anchorCountFor(lengthBeats: number, noteDensity: number, intensity: number): number {
  const neutralDensity = 0.55
  const density = noteDensity + (neutralDensity - noteDensity) * (1 - intensity)
  return Math.max(4, Math.round((lengthBeats * density) / 1.4))
}

function buildAnchorBeats(rng: SeededRandom, start: number, length: number, plan: ElegiacPatternPlan): AnchorBeat[] {
  const climaxBeat = start + length * plan.climaxFraction
  const riseCount = plan.contourOrder === "rise-first" ? Math.ceil(plan.anchorCount * 0.55) : Math.floor(plan.anchorCount * 0.4)
  const fallCount = Math.max(1, plan.anchorCount - riseCount - 2)
  const jitterSpan = (length / plan.anchorCount) * 0.3

  const anchors: AnchorBeat[] = [{ beat: start, role: "start" }]
  for (let i = 1; i <= riseCount; i++) {
    const t = i / (riseCount + 1)
    anchors.push({ beat: start + (climaxBeat - start) * t + (rng.next() - 0.5) * jitterSpan, role: "passing" })
  }
  anchors.push({ beat: climaxBeat, role: "climax" })
  for (let i = 1; i <= fallCount; i++) {
    const t = i / (fallCount + 1)
    anchors.push({ beat: climaxBeat + (start + length - climaxBeat) * t + (rng.next() - 0.5) * jitterSpan, role: "passing" })
  }
  anchors.push({ beat: start + length - 0.25, role: "cadence" })

  for (const a of anchors) a.beat = Math.max(start, Math.min(start + length - 0.1, a.beat))
  return anchors.sort((a, b) => a.beat - b.beat)
}

function assignAnchorPitches(
  rng: SeededRandom,
  anchorBeats: AnchorBeat[],
  harmonicMap: HarmonicMapEntry[],
  range: RangeSetting,
  plan: ElegiacPatternPlan,
): Anchor[] {
  const first = anchorBeats[0].beat
  const climax = anchorBeats.find((a) => a.role === "climax")?.beat ?? anchorBeats[Math.floor(anchorBeats.length / 2)].beat
  const last = anchorBeats[anchorBeats.length - 1].beat
  const mid = Math.round((range.low + range.high) / 2)
  const anchors: Anchor[] = []
  let prevPitch = mid

  for (const { beat, role } of anchorBeats) {
    const entry = chordAtBeat(harmonicMap, beat)
    const chordTones = entry ? chordTonePitchClasses(entry.parsed) : [0, 4, 7]
    const usable = entry ? allUsablePitchClasses(entry.parsed) : chordTones

    let pitch: number

    if (role === "start") {
      pitch = nearestAllowedPitch(mid, chordTones, range)
    } else if (role === "climax") {
      const headroom = 3
      pitch = nearestAllowedPitch(range.high - headroom, usable, range)
    } else if (role === "cadence" && entry) {
      const interval = cadenceInterval(plan.cadenceDegree, entry.parsed)
      const targetPc = (entry.parsed.rootPc + interval) % 12
      pitch = nearestAllowedPitch(prevPitch, [targetPc], range)
    } else {
      // 弧の形(climaxへ向けて上昇、その後下降)に沿って線形補間し、コードトーンへスナップする
      const towardClimax = beat < climax
      const t = towardClimax ? (beat - first) / Math.max(0.01, climax - first) : (beat - climax) / Math.max(0.01, last - climax)
      const climaxPitch = range.high - 3
      const edgePitch = mid
      const target = towardClimax ? edgePitch + (climaxPitch - edgePitch) * t : climaxPitch + (edgePitch - climaxPitch) * t
      const allowed = rng.chance(0.25) ? usable : chordTones
      pitch = nearestAllowedPitch(target, allowed, range)
    }

    anchors.push({ beat, pitch, role })
    prevPitch = pitch
  }

  return anchors
}

/** 倚音: 構造点以外のアンカーの直前に、隣接音1音を短く挿入して遅延解決を作る */
function withAppoggiaturas(rng: SeededRandom, anchors: Anchor[], plan: ElegiacPatternPlan): { beat: number; pitch: number; isAppoggiatura: boolean }[] {
  const out: { beat: number; pitch: number; isAppoggiatura: boolean }[] = []
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const prev = anchors[i - 1]
    const canOrnament = a.role === "passing" && prev && a.beat - prev.beat > 1.2 && rng.chance(plan.appoggiaturaBias)
    if (canOrnament) {
      const step = rng.chance(0.5) ? 1 : -1
      const ornamentBeat = a.beat - Math.min(0.75, (a.beat - prev.beat) * 0.3)
      out.push({ beat: ornamentBeat, pitch: a.pitch + step, isAppoggiatura: true })
    }
    out.push({ beat: a.beat, pitch: a.pitch, isAppoggiatura: false })
  }
  return out
}

function toNotes(rng: SeededRandom, points: { beat: number; pitch: number }[], phraseEnd: number, breathStart: number): MelodyNote[] {
  const notes: MelodyNote[] = []
  for (let i = 0; i < points.length; i++) {
    const cur = points[i]
    if (cur.beat >= phraseEnd) continue
    const next = points[i + 1]
    let end = next ? Math.min(next.beat, phraseEnd) : phraseEnd
    // ブレス位置: 1箇所だけ、次アンカーとの間に短い間を空ける
    if (next && Math.abs(cur.beat - breathStart) < 1 && end - cur.beat > 1.5) {
      end -= 0.5
    }
    // 収まる長さ(available)を上限としてクリップする。無理に最低音価を確保すると
    // 次の音やフレーズ終端と重なるため、収まらないほど短い点は結合/除外する
    const available = end - cur.beat
    if (available < 0.15) continue
    notes.push({
      id: crypto.randomUUID(),
      startBeat: cur.beat,
      durationBeats: available,
      pitch: Math.round(cur.pitch),
      velocity: 72 + rng.intBetween(0, 6),
      locks: [],
    })
  }
  return notes
}

export function generateElegiacPattern(
  rng: SeededRandom,
  harmonicMap: HarmonicMapEntry[],
  phraseStart: number,
  phraseLength: number,
  range: RangeSetting,
  intensity: number,
  noteDensity: number,
  dna?: SongMotifDNA,
  opening?: MelodyOpeningPlan,
  candidateMelodyDNA?: CandidateMelodyDNA,
): { notes: MelodyNote[]; plan: ElegiacPatternPlan } {
  // Song Motif DNA(任意): 倚音の出やすさとカデンツの色合いを、確率的に軽く寄せる。
  // noteDensityのように丸め/閾値の内側で消えてしまわない、連続的な効き方をする箇所へ反映する。
  const appoggiaturaBase = dna ? 0.35 * 0.65 + Math.min(0.9, dna.approachNoteTendency) * 0.35 : 0.35
  const cadenceOptions: CadenceDegree[] = ["third", "fifth", "majorSeventh", "ninth"]
  const cadenceWeights = dna
    ? cadenceOptions.map((d) => (d === "third" || d === "fifth" ? 1 - dna.phraseEndingTendency * 0.7 : 1 + dna.phraseEndingTendency * 0.7))
    : [1, 1, 1, 1]

  // 冒頭設計(任意): 進行方向から弧の向き(rise/fall-first)を決め、倚音入口(suspension)なら倚音を出やすくする
  const contourOrder = opening
    ? openingDirectionSign(opening) >= 0
      ? "rise-first"
      : "fall-first"
    : rng.chance(0.5)
      ? "rise-first"
      : "fall-first"

  const plan: ElegiacPatternPlan = {
    climaxFraction: candidateMelodyDNA
      ? Math.max(0.3, Math.min(0.88, candidateMelodyDNA.climaxPlan.targetFraction + (rng.next() - 0.5) * 0.08))
      : 0.55 + rng.next() * 0.3,
    contourOrder,
    cadenceDegree:
      candidateMelodyDNA?.endingStrategy === "resolved"
        ? rng.pick(["third", "fifth"] as CadenceDegree[])
        : candidateMelodyDNA?.endingStrategy === "open" || candidateMelodyDNA?.endingStrategy === "suspended"
          ? rng.pick(["majorSeventh", "ninth"] as CadenceDegree[])
          : rng.weightedPick(cadenceOptions, cadenceWeights),
    appoggiaturaBias:
      (opening?.openingContour === "suspension-entry" ? Math.max(appoggiaturaBase, 0.6) : appoggiaturaBase) +
      rng.next() * 0.35 * intensity +
      (candidateMelodyDNA?.harmonicResponse === "delayed-resolution" ? 0.12 : 0),
    breathFraction:
      candidateMelodyDNA?.phraseArchitecture === "asymmetric"
        ? 0.36 + rng.next() * 0.16
        : candidateMelodyDNA?.phraseArchitecture === "long-arc"
          ? 0.62 + rng.next() * 0.15
          : 0.3 + rng.next() * 0.4,
    anchorCount: anchorCountFor(phraseLength, noteDensity, intensity),
  }

  const beats = buildAnchorBeats(rng, phraseStart, phraseLength, plan)
  const anchors = assignAnchorPitches(rng, beats, harmonicMap, range, plan)
  // 冒頭設計を最初のアンカー(start)へ適用する: 入りのタイミング・音域・開始音を計画で分ける
  if (opening) applyElegiacOpening(anchors, opening, range, phraseStart)
  const withOrnaments = withAppoggiaturas(rng, anchors, plan)
  const breathBeat = phraseStart + phraseLength * plan.breathFraction
  const notes = toNotes(rng, withOrnaments, phraseStart + phraseLength, breathBeat)

  return { notes, plan }
}

/**
 * 最初のアンカー(start)へOpening Planを適用する。開始音だけでなく、入りのタイミング(弱起/導入の間)、
 * 開始音域、次アンカーへの進行方向を計画で分ける。これにより「内側へ沈む案」「静かに開く案」
 * 「遠くから近づく案」などの入口差が、生成段階で作られる。
 */
function applyElegiacOpening(anchors: Anchor[], opening: MelodyOpeningPlan, range: RangeSetting, phraseStart: number): void {
  if (anchors.length === 0) return
  const startIdx = anchors.findIndex((a) => a.role === "start")
  const idx = startIdx >= 0 ? startIdx : 0
  const start = anchors[idx]
  // 入りのタイミング(弱起/休符後の導入)
  start.beat = phraseStart + opening.startBeatOffset
  // 開始音域と開始音
  start.pitch = openingStartMidi(opening, range)
  // 次アンカーの向きを初期進行方向へ寄せる(順次で。跳躍は後続の構造点へ残す)
  const next = anchors[idx + 1]
  if (next && next.role === "passing") {
    const sign = openingDirectionSign(opening)
    if (sign !== 0) {
      // 冒頭の2音目は計画音域帯の内側に収め、後半へ温存したクライマックスを侵さない
      const band = openingBand(opening, range)
      next.pitch = nearestAllowedPitch(start.pitch + sign * 2, [next.pitch % 12, (next.pitch + 1) % 12, (next.pitch - 1 + 12) % 12], band)
    }
  }
  anchors.sort((a, b) => a.beat - b.beat)
}

/** セクション全体をPHRASE_UNIT_BEATSごとの旋律文(それぞれ独自のクライマックスを持つ)に分割して生成する */
export function generateElegiacCantabile(
  rng: SeededRandom,
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  range: RangeSetting,
  intensity: number,
  noteDensity: number,
  dna?: SongMotifDNA,
  opening?: MelodyOpeningPlan,
  candidateMelodyDNA?: CandidateMelodyDNA,
): MelodyNote[] {
  const notes: MelodyNote[] = []
  const phraseLengths = phraseLengthsForDNA(
    totalBeats,
    opening,
    PHRASE_UNIT_BEATS,
    candidateMelodyDNA,
  )
  let cursor = 0
  for (let phraseIndex = 0; phraseIndex < phraseLengths.length; phraseIndex++) {
    const unitLength = phraseLengths[phraseIndex]
    const first = phraseIndex === 0
    // 冒頭設計は最初の旋律文にのみ適用する
    const { notes: unitNotes } = generateElegiacPattern(
      rng,
      harmonicMap,
      cursor,
      unitLength,
      range,
      intensity,
      noteDensity,
      dna,
      first ? opening : undefined,
      candidateMelodyDNA,
    )
    notes.push(...unitNotes)
    cursor += unitLength
  }
  return notes
}
