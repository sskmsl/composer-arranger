import type { MelodyNote } from "./melody"
import type { ComposerProject } from "./project"

export type MelodyLayerKind = "counter" | "decoration" | "intro"

/** 主旋律に重ねて見せる、そのセクションで採用済みの旋律(対旋律・装飾・イントロ) */
export interface AdoptedMelodyLayer {
  kind: MelodyLayerKind
  /** 採用中の候補の名前(採用していなければ null) */
  name: string | null
  /** セクション頭からの拍で表した音符(採用していなければ空) */
  notes: MelodyNote[]
  /** まだ採用していない候補の数(生成済みで未採用のもの) */
  candidateCount: number
}

/**
 * セクションの対旋律・装飾・イントロの採用状況。
 * 旋律タブで、主旋律のピアノロールへの重ね表示と、各作業の状況カードに使う。
 */
export function adoptedMelodyLayers(project: ComposerProject, sectionId: string): AdoptedMelodyLayer[] {
  const reactive = project.reactiveLayerCandidates ?? []
  const counterId = project.sectionReactiveLayerAssignments?.[sectionId]
  const decorationId = project.sectionDecorationLayerAssignments?.[sectionId]
  const introId = project.sectionSignaturePhraseAssignments?.[sectionId]
  const counter = reactive.find((candidate) => candidate.id === counterId && candidate.kind === "counter")
  const decoration = reactive.find((candidate) => candidate.id === decorationId && candidate.kind === "decoration")
  const intro = project.signaturePhraseCandidates.find((candidate) => candidate.id === introId)
  return [
    {
      kind: "counter",
      name: counter?.name ?? null,
      notes: counter?.notes ?? [],
      candidateCount: reactive.filter((c) => c.sectionId === sectionId && c.kind === "counter").length,
    },
    {
      kind: "decoration",
      name: decoration?.name ?? null,
      notes: decoration?.notes ?? [],
      candidateCount: reactive.filter((c) => c.sectionId === sectionId && c.kind === "decoration").length,
    },
    {
      kind: "intro",
      name: intro?.name ?? null,
      notes: intro?.notes ?? [],
      candidateCount: project.signaturePhraseCandidates.filter((c) => c.sectionId === sectionId).length,
    },
  ]
}
