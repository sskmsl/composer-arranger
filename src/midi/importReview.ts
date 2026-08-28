import type { MidiImportAnalysis } from "./importMidi"

export type MidiReviewIssueId = "melody" | "key" | "chords" | "sections"

export interface MidiReviewIssue {
  id: MidiReviewIssueId
  title: string
  detail: string
  confidence?: number
}

export function buildMidiReviewIssues(
  analysis: Pick<
    MidiImportAnalysis,
    "keyInference" | "melodyTrackConfidence" | "sectionsFromMarkers" | "totalBars"
  >,
  chordInferenceConfidence: number,
): MidiReviewIssue[] {
  const issues: MidiReviewIssue[] = []
  if (analysis.melodyTrackConfidence < 0.72) {
    issues.push({
      id: "melody",
      title: "Melody判定の信頼度が低いため確認してください",
      detail: "AI推奨トラックを選択済みです。主旋律でなければ変更してください。",
      confidence: analysis.melodyTrackConfidence,
    })
  }
  if (analysis.keyInference.source === "pitch-profile" && analysis.keyInference.confidence < 0.65) {
    issues.push({
      id: "key",
      title: "Key推定に複数の候補があります",
      detail: "最も適合度が高いKeyを選択済みです。必要な場合だけ修正してください。",
      confidence: analysis.keyInference.confidence,
    })
  }
  if (chordInferenceConfidence < 0.55) {
    issues.push({
      id: "chords",
      title: "コード推定の信頼度が低めです",
      detail: "Harmony／Bass素材が少ない可能性があります。あとからコード一覧で修正できます。",
      confidence: chordInferenceConfidence,
    })
  }
  if (!analysis.sectionsFromMarkers && analysis.totalBars > 4) {
    issues.push({
      id: "sections",
      title: "Section境界をMIDIから確定できませんでした",
      detail: "曲全体を1つのSectionとして選択済みです。必要なら詳細から境界を追加してください。",
    })
  }
  return issues
}
