import type { MelodyNote, MelodyVariant } from "./melody"
import {
  DEFAULT_SECTION_CONTENT,
  partRoleFor,
  type PartRole,
  type ResolvedLeadContent,
  type SectionContentPlan,
  type SectionLayer,
} from "./sectionContent"

/**
 * Issue #41: content未指定の旧候補は通常Melodyとして扱う。
 * これにより既存プロジェクトの生成結果・再生・書き出しの挙動が変わらない。
 */
export function resolvedLeadContent(variant: Pick<MelodyVariant, "leadContent">): ResolvedLeadContent {
  return variant.leadContent ?? "melody"
}

/** Layerを持たない旧候補へ与える、実音から逆算した最小限の計画 */
export function fallbackPlanFor(content: ResolvedLeadContent, notes: MelodyNote[]): SectionContentPlan {
  return {
    content,
    entryOffsetBeats: 0,
    pickupBeats: 0,
    register: "middle",
    pitchVocabulary: [],
    rhythmGrammar: "legacy",
    recurrenceStrategy: content === "melody" ? "phrase" : "none",
    developmentStrategy: content === "melody" ? "develop" : "none",
    chordBoundaryResponse: "follow",
    cellLengthBeats: 0,
    repetitionCount: 0,
    sustainRatioTarget: 0,
    motifIntervals: [],
    cellDurations: notes.map((note) => note.durationBeats),
    restBeats: [],
  }
}

/**
 * partRoleの正はLayer。旧候補(layers未保存)には notes 全体を単一のleadレイヤーとして
 * 見せることで、呼び出し側が常にLayer経路だけを扱えるようにする。
 */
export function layersOf(variant: MelodyVariant): SectionLayer[] {
  if (variant.layers && variant.layers.length > 0) return variant.layers
  const content = resolvedLeadContent(variant)
  return [
    {
      id: `${variant.id}:legacy-lead`,
      partRole: partRoleFor(content),
      content,
      plan: variant.contentPlan ?? fallbackPlanFor(content, variant.notes),
      notes: variant.notes,
    },
  ]
}

/** 全Layerのノートを平坦化する(MelodyVariant.notes に入れる派生値) */
export function flattenLayerNotes(layers: SectionLayer[]): MelodyNote[] {
  return layers.flatMap((layer) => layer.notes).sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

/** 指定partRoleのノートだけを取り出す(MIDIのトラック分割用) */
export function notesByPartRole(variant: MelodyVariant, partRole: PartRole): MelodyNote[] {
  return layersOf(variant)
    .filter((layer) => layer.partRole === partRole)
    .flatMap((layer) => layer.notes)
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

/**
 * リードが鳴らない候補(Chords Only / Silence)。
 * 空のノート列はエラーではなく正常な状態として扱う。
 */
export function hasNoLeadNotes(variant: MelodyVariant): boolean {
  return notesByPartRole(variant, "lead").length === 0
}

/** セクション設定からリード内容を読む(未設定は既定のmelody) */
export function sectionLeadSetting(section: { content?: { lead: string } }): string {
  return section.content?.lead ?? DEFAULT_SECTION_CONTENT.lead
}
