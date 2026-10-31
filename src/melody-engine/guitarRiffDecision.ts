import type { FullSongArrangement } from "@/core/arrangementGeneration"

export type GuitarRiffOmissionReason = "boundary" | "short-phrase" | "balance"
export interface GuitarRiffAttempt {
  considered: Set<string>
  omissions: Map<string, GuitarRiffOmissionReason>
}
export interface GuitarRiffDecision {
  overall?: "instruction" | "no-candidate"
  omissions: ReadonlyArray<{ sectionId: string; reason: GuitarRiffOmissionReason }>
}

// 診断はこの生成結果の寿命だけ保持する。保存形式や演奏結果には項目を足さない。
const decisions = new WeakMap<FullSongArrangement, GuitarRiffDecision>()

export function guitarRiffDecision(arrangement: FullSongArrangement): GuitarRiffDecision | undefined {
  return decisions.get(arrangement)
}

/** Workerから別便で受け取った診断を、この生成結果だけへ戻す。JSONには入れない。 */
export function attachGuitarRiffDecision(arrangement: FullSongArrangement, decision: GuitarRiffDecision): void {
  decisions.set(arrangement, decision)
}

export function rememberGuitarRiffDecision(arrangement: FullSongArrangement, attempts: GuitarRiffAttempt[], instruction = false): void {
  const playing = new Set(arrangement.tracks.find((track) => track.id === "gtr-riff")?.notes.map((note) => note.sectionId))
  const omissions = new Map<string, GuitarRiffOmissionReason>()
  // 最後に実際に試した候補の記録を使い、採用結果で鳴る区間は除く。
  for (const attempt of attempts) for (const [sectionId, reason] of attempt.omissions) {
    if (!playing.has(sectionId)) omissions.set(sectionId, reason)
  }
  decisions.set(arrangement, {
    ...(instruction ? { overall: "instruction" as const }
      : playing.size === 0 && omissions.size === 0 ? { overall: "no-candidate" as const } : {}),
    omissions: [...omissions].map(([sectionId, reason]) => ({ sectionId, reason })),
  })
}
