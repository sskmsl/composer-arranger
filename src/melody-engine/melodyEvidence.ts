import type { MelodyNote, MelodyVariant, PlannedToneRole } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { noteName, pitchClass } from "@/core/note"

export interface MelodyEvidenceItem {
  id: string
  title: string
  /** MIDIから直接確認できる事実。感情効果を断定する文章は入れない。 */
  observation: string
  /** その事実を作曲判断へ翻訳した、限定的な解釈。 */
  interpretation: string
  range: { startBeat: number; endBeat: number }
}

export interface MelodyCandidateEvidence {
  items: MelodyEvidenceItem[]
  cautions: string[]
}

const ROLE_LABELS: Partial<Record<PlannedToneRole, string>> = {
  "approach-tone": "アプローチ音",
  appoggiatura: "倚音",
  suspension: "掛留音",
  anticipation: "先取音",
  "tension-hold": "テンション保持",
  "passing-tone": "経過音",
  "neighbor-tone": "刺繍音",
}

function roundBeat(value: number): number {
  return Math.round(value * 100) / 100
}

export function musicalPosition(beat: number, beatsPerBar: number): string {
  const safeBeatsPerBar = Math.max(0.25, beatsPerBar)
  const bar = Math.floor(Math.max(0, beat) / safeBeatsPerBar) + 1
  const beatInBar = Math.max(0, beat) % safeBeatsPerBar
  return `${bar}小節目 ${roundBeat(beatInBar + 1)}拍`
}

function chordAt(chords: readonly ChordEvent[], beat: number): ChordEvent | undefined {
  return chords.find(
    (chord) =>
      beat >= chord.startBeat &&
      beat < chord.startBeat + chord.durationBeats,
  )
}

function rangeAround(startBeat: number, endBeat: number, totalBeats: number) {
  return {
    startBeat: Math.max(0, startBeat - 0.5),
    endBeat: Math.min(totalBeats, Math.max(startBeat + 1, endBeat + 0.75)),
  }
}

function intervalSequence(notes: readonly MelodyNote[]): number[] {
  return notes.slice(1).map((note, index) => note.pitch - notes[index].pitch)
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function motifEvidence(
  notes: readonly MelodyNote[],
  beatsPerBar: number,
  totalBeats: number,
): MelodyEvidenceItem | null {
  if (notes.length < 6) return null
  const motifLength = Math.min(4, Math.max(3, Math.floor(notes.length / 4)))
  const source = notes.slice(0, motifLength)
  const sourceIntervals = intervalSequence(source)
  const sourceEnd = source[source.length - 1].startBeat + source[source.length - 1].durationBeats

  for (let index = motifLength; index <= notes.length - motifLength; index++) {
    const candidate = notes.slice(index, index + motifLength)
    if (candidate[0].startBeat < sourceEnd + 0.5) continue
    if (!sameNumbers(sourceIntervals, intervalSequence(candidate))) continue

    const transposition = candidate[0].pitch - source[0].pitch
    const sourceDurations = source.map((note) => note.durationBeats)
    const candidateDurations = candidate.map((note) => note.durationBeats)
    const averageRatio = candidateDurations.reduce(
      (sum, duration, durationIndex) =>
        sum + duration / Math.max(0.125, sourceDurations[durationIndex]),
      0,
    ) / motifLength
    const rhythmDescription = Math.abs(averageRatio - 1) >= 0.25
      ? `、平均音価は約${averageRatio.toFixed(1)}倍`
      : "、音価構成はほぼ同じ"
    const transposeDescription = transposition === 0
      ? "同じ音高"
      : `${Math.abs(transposition)}半音${transposition > 0 ? "上" : "下"}へ移高`

    return {
      id: "motif-return",
      title: "Motifの初出と回帰",
      observation: `${musicalPosition(source[0].startBeat, beatsPerBar)}の${source.map((note) => noteName(note.pitch)).join("–")}と同じ音程列が、${musicalPosition(candidate[0].startBeat, beatsPerBar)}で${transposeDescription}${rhythmDescription}で再登場します。`,
      interpretation: "新しい素材ではなく、冒頭の音程関係を再利用している候補です。",
      range: rangeAround(
        source[0].startBeat,
        candidate[candidate.length - 1].startBeat + candidate[candidate.length - 1].durationBeats,
        totalBeats,
      ),
    }
  }
  return null
}

function resolutionEvidence(
  notes: readonly MelodyNote[],
  chords: readonly ChordEvent[],
  beatsPerBar: number,
  totalBeats: number,
): { item: MelodyEvidenceItem | null; unresolved: number } {
  const planned = notes.filter(
    (note) => note.plannedResolution && ROLE_LABELS[note.plannedToneRole ?? "chord-tone"],
  )
  let unresolved = 0
  let firstResolved: MelodyEvidenceItem | null = null
  for (const note of planned) {
    const resolution = note.plannedResolution!
    const target = notes.find(
      (candidate) =>
        candidate.id !== note.id &&
        candidate.startBeat >= note.startBeat &&
        candidate.startBeat <= resolution.targetBeat + resolution.maximumDelayBeats + 0.01 &&
        pitchClass(candidate.pitch) === resolution.targetPitchClass,
    )
    if (!target) {
      unresolved++
      continue
    }
    if (firstResolved) continue
    const delay = roundBeat(target.startBeat - note.startBeat)
    const chord = chordAt(chords, note.startBeat)
    const role = ROLE_LABELS[note.plannedToneRole ?? "chord-tone"] ?? "非和声音"
    firstResolved = {
        id: "planned-resolution",
        title: "緊張音と実際の解決",
        observation: `${musicalPosition(note.startBeat, beatsPerBar)}${chord ? `の${chord.symbol}上` : ""}で${noteName(note.pitch)}を${role}として置き、${delay}拍後の${noteName(target.pitch)}へ解決しています。`,
        interpretation: "テンション率ではなく、緊張音と到着音を時間上の一組として確認できます。",
        range: rangeAround(note.startBeat, target.startBeat + target.durationBeats, totalBeats),
    }
  }
  return { item: firstResolved, unresolved }
}

function climaxEvidence(
  notes: readonly MelodyNote[],
  beatsPerBar: number,
  totalBeats: number,
): MelodyEvidenceItem | null {
  if (notes.length === 0) return null
  const highestPitch = Math.max(...notes.map((note) => note.pitch))
  const peaks = notes.filter((note) => note.pitch === highestPitch)
  const firstPeak = peaks[0]
  const position = totalBeats > 0 ? firstPeak.startBeat / totalBeats : 0
  return {
    id: "highest-note",
    title: "最高音の使用位置",
    observation: `最高音${noteName(highestPitch)}は${musicalPosition(firstPeak.startBeat, beatsPerBar)}で初めて現れ、全体で${peaks.length}回使われています。位置はSection全長の約${Math.round(position * 100)}%です。`,
    interpretation: peaks.length === 1
      ? "最高音を一度だけ使っているため、少なくとも音域上は希少な出来事です。"
      : "最高音が複数回あるため、単独の頂点ではなく反復される上限として機能します。",
    range: rangeAround(firstPeak.startBeat, firstPeak.startBeat + firstPeak.durationBeats, totalBeats),
  }
}

function silenceEvidence(
  notes: readonly MelodyNote[],
  beatsPerBar: number,
  totalBeats: number,
): MelodyEvidenceItem | null {
  if (notes.length < 2) return null
  const gaps = notes.slice(0, -1).map((note, index) => {
    const end = note.startBeat + note.durationBeats
    return { start: end, end: notes[index + 1].startBeat, duration: notes[index + 1].startBeat - end }
  }).filter((gap) => gap.duration >= 0.5)
  if (gaps.length === 0) return null
  const gap = [...gaps].sort((a, b) => b.duration - a.duration)[0]
  return {
    id: "structural-silence",
    title: "実際に置かれた余白",
    observation: `${musicalPosition(gap.start, beatsPerBar)}から${roundBeat(gap.duration)}拍、メロディが発音しない区間があります。`,
    interpretation: "音数の印象ではなく、次の音まで待たせる実時間として確認できます。",
    range: rangeAround(gap.start, gap.end, totalBeats),
  }
}

function leapRecoveryEvidence(
  notes: readonly MelodyNote[],
  beatsPerBar: number,
  totalBeats: number,
): MelodyEvidenceItem | null {
  for (let index = 1; index < notes.length - 1; index++) {
    const leap = notes[index].pitch - notes[index - 1].pitch
    const recovery = notes[index + 1].pitch - notes[index].pitch
    if (
      Math.abs(leap) < 5 ||
      recovery === 0 ||
      Math.sign(leap) === Math.sign(recovery) ||
      Math.abs(recovery) > 3
    ) continue
    return {
      id: "leap-recovery",
      title: "跳躍と回収",
      observation: `${musicalPosition(notes[index - 1].startBeat, beatsPerBar)}から${noteName(notes[index - 1].pitch)}→${noteName(notes[index].pitch)}へ${Math.abs(leap)}半音跳躍し、直後に${noteName(notes[index + 1].pitch)}へ反対方向に${Math.abs(recovery)}半音戻ります。`,
      interpretation: "跳躍を置いたままにせず、直後の進行で輪郭を回収しています。",
      range: rangeAround(
        notes[index - 1].startBeat,
        notes[index + 1].startBeat + notes[index + 1].durationBeats,
        totalBeats,
      ),
    }
  }
  return null
}

export function explainMelodyCandidate(
  variant: Pick<MelodyVariant, "notes" | "candidateMelodyDNA">,
  chords: readonly ChordEvent[],
  beatsPerBar: number,
  totalBeats: number,
): MelodyCandidateEvidence {
  const notes = [...variant.notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  const items: MelodyEvidenceItem[] = []
  const cautions: string[] = []
  if (notes.length === 0) return { items, cautions: ["表示できるメロディノートがありません。"] }

  const resolution = resolutionEvidence(notes, chords, beatsPerBar, totalBeats)
  const candidates = [
    resolution.item,
    motifEvidence(notes, beatsPerBar, totalBeats),
    climaxEvidence(notes, beatsPerBar, totalBeats),
    silenceEvidence(notes, beatsPerBar, totalBeats),
    leapRecoveryEvidence(notes, beatsPerBar, totalBeats),
  ]
  for (const item of candidates) {
    if (item && items.length < 4) items.push(item)
  }

  if (resolution.unresolved > 0) {
    cautions.push(`解決計画を持つ音のうち${resolution.unresolved}音は、指定時間内の到着音を実音から確認できません。`)
  }
  const highest = Math.max(...notes.map((note) => note.pitch))
  const peakCount = notes.filter((note) => note.pitch === highest).length
  if (peakCount >= 3) cautions.push(`最高音${noteName(highest)}が${peakCount}回あり、頂点の希少性は弱めです。`)
  if (!items.some((item) => item.id === "structural-silence")) {
    cautions.push("0.5拍以上の明確なメロディ休止がなく、余白の効果は限定的です。")
  }
  const conflictCount = notes.filter((note) => note.plannedToneRole === "unresolved-conflict").length
  if (conflictCount > 0) cautions.push(`意味づけされていない和声衝突が${conflictCount}音残っています。`)
  if (variant.candidateMelodyDNA?.endingStrategy) {
    const last = notes[notes.length - 1]
    const chord = chordAt(chords, last.startBeat)
    cautions.push(`終端は${noteName(last.pitch)}${chord ? `（${chord.symbol}上）` : ""}、計画は${variant.candidateMelodyDNA.endingStrategy}です。最終的な終止感は試聴で判断してください。`)
  }

  return { items, cautions: cautions.slice(0, 3) }
}
