import { parseChordSymbol } from "./chord"
import type { MelodyNote } from "./melody"
import type { ChordEvent } from "./project"

export type ArrangementApproach = "safe" | "surprise-tension"

export type ArrangementSurpriseTechnique =
  | "chromatic-resolution"
  | "next-chord-anticipation"
  | "unused-register-accent"
  | "motif-inversion"
  | "transition-rise"
  | "planned-tension"
  | "contextual-fit"

/** Generator共通の「なぜこの一手が成立するか」。音符自体とは分離して保存する。 */
export interface ArrangementNecessity {
  approach: ArrangementApproach
  technique: ArrangementSurpriseTechnique
  score: number
  reason: string
  evidence: string[]
  resolution: string | null
}

export interface ArrangementSurpriseContext {
  chords: Pick<ChordEvent, "startBeat" | "durationBeats" | "symbol">[]
  melodyNotes: MelodyNote[]
  totalBeats: number
  sectionRole: string
  nextSectionRole?: string
  nextSectionFirstChord?: string
  existingSupportNoteCount?: number
}

export interface ArrangementSurpriseOpportunity {
  technique: ArrangementSurpriseTechnique | "intentional-silence"
  score: number
  reason: string
  requiredResolution: string | null
}

type CandidateWithNotes = {
  notes: MelodyNote[]
  arrangementNecessity?: ArrangementNecessity
}

const pc = (pitch: number) => ((pitch % 12) + 12) % 12

function chordPitchClasses(symbol: string | undefined): Set<number> {
  if (!symbol) return new Set()
  const parsed = parseChordSymbol(symbol)
  if (!parsed) return new Set()
  return new Set(
    [...parsed.tones, ...parsed.tensions].map((tone) => tone.pitchClass),
  )
}

function chordAt(
  chords: ArrangementSurpriseContext["chords"],
  beat: number,
): ArrangementSurpriseContext["chords"][number] | undefined {
  return chords.find(
    (chord) =>
      beat >= chord.startBeat - 0.001 &&
      beat < chord.startBeat + chord.durationBeats - 0.001,
  ) ?? chords.at(-1)
}

function overlapsMelodyGap(
  note: MelodyNote,
  melody: readonly MelodyNote[],
): boolean {
  return !melody.some((lead) => {
    const start = Math.max(note.startBeat, lead.startBeat)
    const end = Math.min(
      note.startBeat + note.durationBeats,
      lead.startBeat + lead.durationBeats,
    )
    return end - start > 0.08
  })
}

function invertedMotifMatch(
  candidate: readonly MelodyNote[],
  melody: readonly MelodyNote[],
): boolean {
  if (candidate.length < 3 || melody.length < 3) return false
  const candidateIntervals = candidate
    .slice(0, 4)
    .slice(1)
    .map((note, index) => note.pitch - candidate[index].pitch)
  const melodyIntervals = melody
    .slice(0, 4)
    .slice(1)
    .map((note, index) => note.pitch - melody[index].pitch)
  const length = Math.min(candidateIntervals.length, melodyIntervals.length)
  if (length < 2) return false
  return candidateIntervals.slice(0, length).every(
    (interval, index) =>
      Math.abs(interval) === Math.abs(melodyIntervals[index]) &&
      Math.sign(interval) === -Math.sign(melodyIntervals[index]),
  )
}

/**
 * 候補を奇抜さではなく「逸脱 → 文脈上の回収」で評価する。
 * 成立根拠が見つからない候補は、必ずSafeへ戻す。
 */
export function evaluateArrangementNecessity(
  notes: readonly MelodyNote[],
  context: ArrangementSurpriseContext,
): ArrangementNecessity {
  const ordered = [...notes].sort(
    (left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch,
  )
  const melody = [...context.melodyNotes].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  const evidence: string[] = []
  const candidates: ArrangementNecessity[] = []
  const currentFinalChord = chordPitchClasses(context.chords.at(-1)?.symbol)
  const nextChord = chordPitchClasses(context.nextSectionFirstChord)

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const note = ordered[index]
    const next = ordered[index + 1]
    const harmony = chordPitchClasses(chordAt(context.chords, note.startBeat)?.symbol)
    if (
      !harmony.has(pc(note.pitch)) &&
      harmony.has(pc(next.pitch)) &&
      Math.abs(next.pitch - note.pitch) === 1 &&
      next.startBeat - note.startBeat <= 2
    ) {
      candidates.push({
        approach: "surprise-tension",
        technique: "chromatic-resolution",
        score: 88,
        reason: `非和声音を半音で${next.pitch > note.pitch ? "上" : "下"}の安定音へ解決`,
        evidence: ["緊張音の直後に半音の解決先がある", "逸脱が2拍以内に回収される"],
        resolution: `MIDI ${note.pitch} → ${next.pitch}で解決`,
      })
    }
  }

  const ending = ordered.at(-1)
  if (
    ending &&
    nextChord.size > 0 &&
    nextChord.has(pc(ending.pitch)) &&
    !currentFinalChord.has(pc(ending.pitch)) &&
    ending.startBeat >= context.totalBeats - 2
  ) {
    candidates.push({
      approach: "surprise-tension",
      technique: "next-chord-anticipation",
      score: 86,
      reason: `現コード外の音を、次の${context.nextSectionFirstChord}の先取音として配置`,
      evidence: ["Section終端2拍以内", "次コードの構成音", "現コードでは未解決"],
      resolution: `次Sectionの${context.nextSectionFirstChord}で意味が確定`,
    })
  }

  const melodyHigh = melody.length > 0
    ? Math.max(...melody.map((note) => note.pitch))
    : null
  const highGapAccent = ordered.find(
    (note) =>
      melodyHigh !== null &&
      note.pitch >= melodyHigh + 5 &&
      overlapsMelodyGap(note, melody),
  )
  if (highGapAccent && ordered.length <= 4) {
    candidates.push({
      approach: "surprise-tension",
      technique: "unused-register-accent",
      score: 78,
      reason: "ボーカル休符の未使用高域を、短いアクセントだけで補完",
      evidence: ["主旋律と発音が重ならない", "主旋律最高音より5半音以上高い", "4音以内の限定使用"],
      resolution: "短く退場し、主旋律の音域を継続的には奪わない",
    })
  }

  if (invertedMotifMatch(ordered, melody)) {
    candidates.push({
      approach: "surprise-tension",
      technique: "motif-inversion",
      score: 82,
      reason: "既出の主旋律モチーフを反転し、別の声として記憶を呼び戻す",
      evidence: ["冒頭音程幅を保持", "進行方向だけを反転", "無関係な新素材ではない"],
      resolution: "元モチーフとの音程関係が聴感上の根拠になる",
    })
  }

  const tail = ordered.filter((note) => note.startBeat >= context.totalBeats - 4)
  const tailIntervals = tail.slice(1).map(
    (note, index) => note.pitch - tail[index].pitch,
  )
  if (
    context.nextSectionRole &&
    tailIntervals.length >= 2 &&
    tailIntervals.every((interval) => interval > 0 && interval <= 5)
  ) {
    candidates.push({
      approach: "surprise-tension",
      technique: "transition-rise",
      score: context.nextSectionRole.includes("chorus") ? 84 : 74,
      reason: `次の${context.nextSectionRole}へ向かう上行形でSection間の推進力を強調`,
      evidence: ["Section終端4拍以内", "3音以上の連続上行", "次Sectionが存在する"],
      resolution: `次の${context.nextSectionRole}への到達で上行エネルギーを回収`,
    })
  }

  const planned = ordered.find(
    (note) =>
      (note.plannedToneRole === "suspension" ||
        note.plannedToneRole === "appoggiatura" ||
        note.plannedToneRole === "tension-hold") &&
      note.plannedResolution,
  )
  if (planned?.plannedResolution) {
    candidates.push({
      approach: "surprise-tension",
      technique: "planned-tension",
      score: 80,
      reason: "計画済みの緊張音を、指定された解決拍まで意図的に保持",
      evidence: [planned.plannedToneRole ?? "tension", "解決音と解決拍が事前計画済み"],
      resolution: `beat ${planned.plannedResolution.targetBeat}でpitch class ${planned.plannedResolution.targetPitchClass}へ解決`,
    })
  }

  if (candidates.length > 0) {
    return candidates.sort((left, right) => right.score - left.score)[0]
  }

  const gapNotes = ordered.filter((note) => overlapsMelodyGap(note, melody)).length
  if (gapNotes > 0) evidence.push(`${gapNotes}/${ordered.length}音が主旋律の休符内`)
  if (context.existingSupportNoteCount) {
    evidence.push(`既存補助音 ${context.existingSupportNoteCount}音を考慮`)
  }
  return {
    approach: "safe",
    technique: "contextual-fit",
    score: Math.min(100, 60 + gapNotes * 4),
    reason: gapNotes > 0
      ? "主旋律の休符を使い、コードと空き音域へ自然に収める"
      : "コード・音域・Sectionの役割へ自然に適合させる",
    evidence,
    resolution: null,
  }
}

/** Surpriseは品質の代用にせず、強い必然性がある候補だけを少数残す。 */
export function annotateArrangementApproaches<T extends CandidateWithNotes>(
  candidates: readonly T[],
  context: ArrangementSurpriseContext,
  options: { maximumSurpriseCount?: number; minimumScore?: number } = {},
): Array<T & { arrangementNecessity: ArrangementNecessity }> {
  const maximum = Math.max(0, options.maximumSurpriseCount ?? 2)
  const minimum = options.minimumScore ?? 74
  const evaluated = candidates.map((candidate) => ({
    candidate,
    necessity: evaluateArrangementNecessity(candidate.notes, context),
  }))
  const allowed = new Set(
    evaluated
      .filter(
        (item) =>
          item.necessity.approach === "surprise-tension" &&
          item.necessity.score >= minimum &&
          item.necessity.resolution,
      )
      .sort((left, right) => right.necessity.score - left.necessity.score)
      .slice(0, maximum)
      .map((item) => item.candidate),
  )
  return evaluated.map(({ candidate, necessity }) => ({
    ...candidate,
    arrangementNecessity:
      necessity.approach === "surprise-tension" && !allowed.has(candidate)
        ? {
            ...necessity,
            approach: "safe",
            technique: "contextual-fit",
            reason: "文脈的な逸脱候補だが、Surprise枠を限定してSafe案として提示",
          }
        : necessity,
  }))
}

/** AI Partnerへ渡すのは「奇抜にせよ」ではなく、現在の曲で成立し得る機会だけ。 */
export function identifyArrangementSurpriseOpportunities(
  context: ArrangementSurpriseContext,
): ArrangementSurpriseOpportunity[] {
  const melody = [...context.melodyNotes].sort(
    (left, right) => left.startBeat - right.startBeat,
  )
  const occupied = melody.reduce(
    (sum, note) => sum + Math.min(note.durationBeats, context.totalBeats),
    0,
  )
  const silenceRatio = context.totalBeats > 0
    ? Math.max(0, 1 - occupied / context.totalBeats)
    : 0
  const opportunities: ArrangementSurpriseOpportunity[] = []
  if (silenceRatio >= 0.22) {
    opportunities.push({
      technique: "unused-register-accent",
      score: Math.round(62 + Math.min(24, silenceRatio * 50)),
      reason: "主旋律の休符に、未使用音域の短い1音または小型Gestureを置ける",
      requiredResolution: "主旋律再開前に退場する",
    })
  }
  if (context.nextSectionFirstChord) {
    opportunities.push({
      technique: "next-chord-anticipation",
      score:
        context.nextSectionRole?.includes("chorus") ||
        context.sectionRole === "pre-chorus"
          ? 86
          : 74,
      reason: `次の${context.nextSectionFirstChord}を半音または共通音で先取りできる`,
      requiredResolution: `次Sectionの${context.nextSectionFirstChord}へ接続する`,
    })
    opportunities.push({
      technique: "transition-rise",
      score: context.nextSectionRole?.includes("chorus") ? 84 : 70,
      reason: `次の${context.nextSectionRole ?? "Section"}へ向かう1〜2小節だけ運動量を変えられる`,
      requiredResolution: "次Section頭で上行・スウェルを止める",
    })
  }
  if (context.existingSupportNoteCount && context.existingSupportNoteCount > 8) {
    opportunities.push({
      technique: "intentional-silence",
      score: Math.min(92, 70 + context.existingSupportNoteCount),
      reason: "直前までの密度が高いため、何も足さないこと自体が最も強い対比になる",
      requiredResolution: null,
    })
  }
  return opportunities
    .filter((opportunity) => opportunity.score >= 70)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
}
