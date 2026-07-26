import { create } from "zustand"
import {
  createEmptyProject,
  effectiveSongProfile,
  type ComposerProject,
  type SongProfileId,
} from "@/core/project"
import type { Section, SectionRole } from "@/core/section"
import { parseTimeSignature } from "@/core/section"
import type {
  LockKind,
  MelodyGeneratorProfile,
  MelodyNote,
  MelodyVariant,
  RangeRegenerationLocks,
} from "@/core/melody"
import { parseChordInputText } from "@/core/chordInput"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { buildHarmonicMap } from "@/melody-engine/harmonicMap"
import { generateFromChordsWithProfiles, toMelodyVariantFromProfile } from "@/melody-engine/generateFromChords"
import { resolveGenerationParams, RANGE_PRESETS, type Density, type Drama, type RangeSetting } from "@/melody-engine/generationParams"
import { computeMelodyFeatures } from "@/melody-engine/features"
import { extractMotifDNA } from "@/melody-engine/motifDNA"
import { generateRangeRegenerationCandidates } from "@/melody-engine/rangeRegeneration"
import {
  seedContinue,
  seedExpand,
  seedAnswerPhrase,
  seedVariation,
  seedLift,
  seedRestrain,
  type SeedOperation,
} from "@/melody-engine/developSeed"
import { createSeed } from "@/core/rng"
import {
  saveProject,
  loadLastOpenedProject,
  loadProject as loadProjectById,
  backupProjectTimingSnapshot,
  duplicateProject as duplicateStoredProjectRepo,
  renameProject as renameStoredProjectRepo,
  deleteProject as deleteStoredProjectRepo,
} from "@/storage/projectRepository"
import { resolveProjectTiming, resolveAmbiguousTiming } from "@/core/timingMigration"
import { moveSectionInTimeline, normalizeSectionTimeline } from "@/core/sectionTimeline"
import { DEFAULT_SECTION_CONTENT, LEAD_CONTENT_LABELS, type SectionContentSettings } from "@/core/sectionContent"
import {
  chorusPeakMidi,
  fallbackPlanFor,
  flattenLayerNotes,
  replaceVariantNotes,
  resolvedLeadContent,
} from "@/core/sectionLayers"
import {
  generateMelodyPickupNotes,
  generateSectionContent,
  toMelodyVariantFromContent,
  usesContentPipeline,
} from "@/melody-engine/generateSectionContent"
import {
  chordsForWindow,
  isFullSectionWindow,
  leadWindowOf,
  shiftNotesToSection,
  windowLengthBeats,
} from "@/melody-engine/leadWindow"
import { applyProfileOverride, generatorProfileIntensity } from "@/melody-engine/generatorProfile"
import type { PhraseCandidate, PhraseLengthBars } from "@/core/phrase"
import {
  generatePhraseCandidates,
  regeneratePhraseCandidate as buildRegeneratedPhrase,
  type GeneratePhrasesInput,
} from "@/phrase-engine/generatePhrases"

export type RangePreset = "low" | "middle" | "high" | "custom"

/** Issue #16: 時間単位移行の状態をUIへ伝えるための通知 */
export type TimingNotice =
  | { kind: "auto-converted"; factor: number; timeSignature: string }
  | { kind: "ambiguous"; timeSignature: string; reason: string }

interface GenerationSettings {
  density: Density
  rangePreset: RangePreset
  customRange: RangeSetting
  drama: Drama
  /** Melody Candidate Diversity v1.2: 有効化するGenerator Profile(未選択時はStandardのみ) */
  selectedGeneratorProfiles: MelodyGeneratorProfile[]
}

interface ProjectState {
  project: ComposerProject
  selectedSectionId: string | null
  activeBatchId: string | null
  activeCandidateIndex: number
  activePhraseBatchId: string | null
  activePhraseCandidateIndex: number
  generationSettings: GenerationSettings
  history: ComposerProject[]
  future: ComposerProject[]
  hydrated: boolean
  workflowNotice: string | null
  /** Issue #16: 時間単位の自動変換通知/確認待ち(判定できなかった場合) */
  timingNotice: TimingNotice | null

  hydrate: () => Promise<void>
  newProject: () => void
  loadProject: (project: unknown) => void
  loadProjectById: (id: string) => Promise<void>
  /** Issue #14: 保存済みプロジェクトを複製する(新しいprojectId・全データ保持)。複製したidを返す */
  duplicateStoredProject: (projectId: string) => Promise<string | null>
  /** Issue #14: 保存済みプロジェクトのタイトルを変更する(開いている場合は現在の表示も更新) */
  renameStoredProject: (projectId: string, title: string) => Promise<void>
  /** Issue #14: 保存済みプロジェクトを削除する(開いている場合は新規プロジェクトへ切り替え) */
  deleteStoredProject: (projectId: string) => Promise<void>
  persist: () => void
  /** timingNoticeがambiguousの場合にユーザーの選択を適用する。auto-convertedの通知は単に閉じる */
  confirmTimingConversion: (convert: boolean) => void
  dismissTimingNotice: () => void

  updateSongField: <K extends keyof ComposerProject["song"]>(key: K, value: ComposerProject["song"][K]) => void
  setSectionProfileOverride: (sectionId: string, profile: SongProfileId | null) => void

  addSection: (name: string, role: SectionRole, lengthBars: number) => void
  updateSection: (sectionId: string, patch: Partial<Section>) => void
  /** Issue #41: セクションのリード内容/伴奏/entryOffset/pickupを更新する */
  setSectionContent: (sectionId: string, patch: Partial<SectionContentSettings>) => void
  /** Issue #45: セクションへ独立Accompaniment Pattern Templateを割り当てる。 */
  setSectionAccompanimentPattern: (sectionId: string, patternId: string | null) => void
  removeSection: (sectionId: string) => void
  duplicateSection: (sectionId: string) => void
  moveSection: (sectionId: string, targetIndex: number) => void
  selectSection: (sectionId: string | null) => void

  setChordText: (sectionId: string, text: string) => void
  /** 現在のコード進行をそのまま複製して後ろへ繋げ、小節数を2倍にする */
  repeatSectionChords: (sectionId: string) => void
  /** Issue #12: セクション長に満たない場合、最後のコードを不足分だけ延長して充足させる */
  extendLastChordToFill: (sectionId: string) => void
  setGenerationSettings: (patch: Partial<GenerationSettings>) => void
  toggleGeneratorProfile: (profile: MelodyGeneratorProfile) => void
  /** Song Motif DNA(将来のセクション間一貫性チェックの土台): 指定Variantから抽出して保存する */
  extractMotifDNAFromVariant: (variantId: string) => void

  generateForSection: (sectionId: string) => void
  setActiveCandidateIndex: (index: number) => void
  setActiveMelody: (variantId: string) => void
  assignVariantToSection: (sectionId: string, variantId: string | null) => void
  setVariantReviewState: (variantId: string, reviewState: "favorite" | "rejected" | null) => void
  /** 生成履歴からVariantを選ぶ: Active Melodyにするだけでなく、現在の候補バッチ表示も解除する */
  selectVariantFromHistory: (variantId: string) => void
  renameVariant: (variantId: string, name: string) => void
  deleteVariant: (variantId: string) => void

  generatePhrasesForSection: (sectionId: string, lengthBars?: PhraseLengthBars) => void
  setActivePhraseCandidateIndex: (index: number) => void
  regeneratePhrase: (candidateId: string) => void

  toggleNoteLock: (variantId: string, noteId: string, lock: LockKind) => void
  toggleBarLock: (variantId: string, barIndex: number) => void
  updateNote: (variantId: string, noteId: string, patch: Partial<MelodyNote>) => void
  deleteNote: (variantId: string, noteId: string) => void
  regenerateRange: (
    variantId: string,
    startBeat: number,
    endBeat: number,
    locks?: Partial<RangeRegenerationLocks>,
  ) => void

  applySeedOperation: (
    sourceVariantId: string,
    op: SeedOperation,
    seedNoteIds: string[],
    opts?: { continuationBars?: number; expandToBars?: number },
  ) => void

  undo: () => void
  redo: () => void
}

function resolveRange(settings: GenerationSettings): RangeSetting {
  return settings.rangePreset === "custom" ? settings.customRange : RANGE_PRESETS[settings.rangePreset]
}

function phraseGenerationInput(
  project: ComposerProject,
  sectionId: string,
  settings: GenerationSettings,
  seed: number,
  lengthBars?: PhraseLengthBars,
): GeneratePhrasesInput | null {
  const section = project.sections.find((candidate) => candidate.id === sectionId)
  if (!section) return null
  const timeSignature = parseTimeSignature(project.song.timeSignature)
  const totalBeats = section.lengthBars * timeSignature.beatsPerBar
  const chords = project.chords
    .filter((chord) => chord.sectionId === sectionId)
    .sort((a, b) => a.startBeat - b.startBeat)
  if (
    chords.length === 0 ||
    section.lengthBars < 2 ||
    diagnoseChordInput(chords, totalBeats).hasError
  ) {
    return null
  }
  return {
    chords,
    sectionId,
    sectionRole: section.role,
    songProfile: effectiveSongProfile(project, sectionId),
    density: settings.density,
    drama: settings.drama,
    range: resolveRange(settings),
    key: project.song.key,
    beatsPerBar: timeSignature.beatsPerBar,
    totalBeats,
    seed,
    lengthBars,
  }
}

function snapshot(project: ComposerProject): ComposerProject {
  return JSON.parse(JSON.stringify(project))
}

/** 採用済みメロディーを別セクションへ複製し、編集可能な独立Variantにする。 */
function duplicateVariantForSection(source: MelodyVariant, sectionId: string): MelodyVariant {
  const copy = structuredClone(replaceVariantNotes(source, source.notes))
  const noteIds = new Map<string, string>()
  const duplicateNote = (note: MelodyNote): MelodyNote => {
    let id = noteIds.get(note.id)
    if (!id) {
      id = crypto.randomUUID()
      noteIds.set(note.id, id)
    }
    return { ...note, id }
  }

  return {
    ...copy,
    id: crypto.randomUUID(),
    name: `${source.name} copy`,
    sectionId,
    parentMelodyId: source.id,
    batchId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reviewState: null,
    notes: copy.notes.map(duplicateNote),
    layers: copy.layers?.map((layer) => ({
      ...layer,
      id: crypto.randomUUID(),
      notes: layer.notes.map(duplicateNote),
    })),
  }
}

function timingNoticeFrom(result: ReturnType<typeof resolveProjectTiming>): TimingNotice | null {
  if (result.status === "auto-converted") {
    return { kind: "auto-converted", factor: result.factor ?? 1, timeSignature: result.project.song.timeSignature }
  }
  if (result.status === "ambiguous" && result.ambiguity) {
    return { kind: "ambiguous", timeSignature: result.ambiguity.timeSignature, reason: result.ambiguity.reason }
  }
  return null
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createEmptyProject("New Song"),
  selectedSectionId: null,
  activeBatchId: null,
  activeCandidateIndex: 0,
  activePhraseBatchId: null,
  activePhraseCandidateIndex: 0,
  generationSettings: {
    density: "balanced",
    rangePreset: "middle",
    customRange: RANGE_PRESETS.middle,
    drama: "growing",
    selectedGeneratorProfiles: ["standard"],
  },
  history: [],
  future: [],
  hydrated: false,
  workflowNotice: null,
  timingNotice: null,

  hydrate: async () => {
    const last = await loadLastOpenedProject()
    if (last) {
      // JSON Import/loadProjectByIdと同じ唯一の移行経路(resolveProjectTiming)を通す。
      // normalizeProjectも内部で必ず通るため、旧schemaVersion(1.0)のデータが
      // songProfile等を欠いたままUIへ渡ってクラッシュすることもない(16章/Issue #16)
      const result = resolveProjectTiming(last)
      if (result.status !== "no-op") void backupProjectTimingSnapshot(last)
      set({
        project: result.project,
        selectedSectionId: result.project.sections[0]?.id ?? null,
        hydrated: true,
        timingNotice: timingNoticeFrom(result),
      })
      if (result.status === "auto-converted") get().persist()
    } else {
      set({ hydrated: true })
    }
  },

  newProject: () => {
    const project = createEmptyProject("New Song")
    set({
      project,
      selectedSectionId: null,
      activeBatchId: null,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
      history: [],
      future: [],
      timingNotice: null,
      workflowNotice: null,
    })
    get().persist()
  },

  loadProject: (raw) => {
    const result = resolveProjectTiming(raw)
    if (result.status !== "no-op") void backupProjectTimingSnapshot(raw)
    set({
      project: result.project,
      selectedSectionId: result.project.sections[0]?.id ?? null,
      activeBatchId: null,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
      history: [],
      future: [],
      timingNotice: timingNoticeFrom(result),
      workflowNotice: null,
    })
    get().persist()
  },

  confirmTimingConversion: (convert) => {
    const prev = get().project
    const resolved = resolveAmbiguousTiming(prev, convert)
    set({ project: resolved, timingNotice: null })
    get().persist()
  },

  dismissTimingNotice: () => set({ timingNotice: null }),

  loadProjectById: async (id) => {
    const p = await loadProjectById(id)
    if (p) get().loadProject(p)
  },

  duplicateStoredProject: async (projectId) => {
    const copy = await duplicateStoredProjectRepo(projectId)
    return copy?.projectId ?? null
  },

  renameStoredProject: async (projectId, title) => {
    await renameStoredProjectRepo(projectId, title)
    // 開いているプロジェクトを改名した場合は現在の表示も更新する(自動保存で永続化)
    if (get().project.projectId === projectId) {
      set({ project: { ...get().project, title } })
      get().persist()
    }
  },

  deleteStoredProject: async (projectId) => {
    await deleteStoredProjectRepo(projectId)
    // 開いているプロジェクトを削除した場合は、直前状態(lastOpened)を復元、無ければ新規へ
    if (get().project.projectId === projectId) {
      const last = await loadLastOpenedProject()
      if (last) get().loadProject(last)
      else get().newProject()
    }
  },

  persist: () => {
    void saveProject(get().project)
  },

  updateSongField: (key, value) => {
    const prev = get().project
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, song: { ...prev.song, [key]: value } },
    })
    get().persist()
  },

  setSectionProfileOverride: (sectionId, profile) => {
    const prev = get().project
    const overrides = prev.song.sectionProfileOverrides.filter((o) => o.sectionId !== sectionId)
    if (profile) overrides.push({ sectionId, songProfile: profile })
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, song: { ...prev.song, sectionProfileOverrides: overrides } },
    })
    get().persist()
  },

  addSection: (name, role, lengthBars) => {
    const prev = get().project
    const section: Section = {
      id: crypto.randomUUID(),
      name,
      role,
      startBar: 1,
      lengthBars,
      // Issue #41: 新規セクションも2軸モデルを明示的に持たせる(既定は従来と同じMelody+Chords)
      content: { ...DEFAULT_SECTION_CONTENT },
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections: normalizeSectionTimeline([...prev.sections, section]) },
      selectedSectionId: section.id,
    })
    get().persist()
  },

  /**
   * Issue #41: セクションのリード内容/伴奏/entryOffset/pickupを更新する。
   * entryOffsetはセクション長を超えないよう丸める(完全無音は entryOffset = セクション長)。
   */
  setSectionContent: (sectionId, patch) => {
    const prev = get().project
    const beatsPerBar = parseTimeSignature(prev.song.timeSignature).beatsPerBar
    const sections = prev.sections.map((section) => {
      if (section.id !== sectionId) return section
      const current = section.content ?? DEFAULT_SECTION_CONTENT
      const next = { ...current, ...patch }
      const sectionBeats = section.lengthBars * beatsPerBar
      return {
        ...section,
        content: {
          ...next,
          entryOffsetBeats: Math.max(0, Math.min(sectionBeats, next.entryOffsetBeats)),
        },
      }
    })
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections },
    })
    get().persist()
  },

  setSectionAccompanimentPattern: (sectionId, patternId) => {
    const prev = get().project
    if (!prev.sections.some((section) => section.id === sectionId)) return
    if (patternId && !prev.accompanimentPatterns.some((pattern) => pattern.id === patternId)) return
    const assignments = { ...prev.sectionAccompanimentPatternAssignments }
    if (patternId) assignments[sectionId] = patternId
    else delete assignments[sectionId]
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sectionAccompanimentPatternAssignments: assignments },
    })
    get().persist()
  },

  updateSection: (sectionId, patch) => {
    const prev = get().project
    const sections = prev.sections.map((s) =>
      s.id === sectionId
        ? { ...s, ...patch, lengthBars: patch.lengthBars === undefined ? s.lengthBars : Math.max(1, patch.lengthBars) }
        : s,
    )
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections: normalizeSectionTimeline(sections) },
    })
    get().persist()
  },

  removeSection: (sectionId) => {
    const prev = get().project
    const { [sectionId]: _removedAssignment, ...sectionMelodyAssignments } = prev.sectionMelodyAssignments
    const {
      [sectionId]: _removedPatternAssignment,
      ...sectionAccompanimentPatternAssignments
    } = prev.sectionAccompanimentPatternAssignments
    void _removedAssignment
    void _removedPatternAssignment
    const removedVariantIds = new Set(
      prev.melodyVariants.filter((variant) => variant.sectionId === sectionId).map((variant) => variant.id),
    )
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        sections: normalizeSectionTimeline(prev.sections.filter((s) => s.id !== sectionId)),
        chords: prev.chords.filter((c) => c.sectionId !== sectionId),
        melodyVariants: prev.melodyVariants.filter((v) => v.sectionId !== sectionId),
        phraseCandidates: prev.phraseCandidates.filter((candidate) => candidate.sectionId !== sectionId),
        sectionMelodyAssignments,
        sectionAccompanimentPatternAssignments,
        activeMelodyId:
          prev.activeMelodyId && removedVariantIds.has(prev.activeMelodyId) ? null : prev.activeMelodyId,
      },
      selectedSectionId: prev.sections.find((s) => s.id !== sectionId)?.id ?? null,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
    })
    get().persist()
  },

  duplicateSection: (sectionId) => {
    const prev = get().project
    const src = prev.sections.find((s) => s.id === sectionId)
    if (!src) return
    const newId = crypto.randomUUID()
    const copy: Section = { ...src, id: newId, name: `${src.name} copy`, startBar: 1 }
    const chordCopies = prev.chords.filter((c) => c.sectionId === sectionId).map((c) => ({ ...c, id: crypto.randomUUID(), sectionId: newId }))
    const assignedVariantId = prev.sectionMelodyAssignments[sectionId]
    const assignedVariant = assignedVariantId
      ? prev.melodyVariants.find((variant) => variant.id === assignedVariantId && variant.sectionId === sectionId)
      : undefined
    const variantCopy = assignedVariant ? duplicateVariantForSection(assignedVariant, newId) : undefined
    const sourcePatternId = prev.sectionAccompanimentPatternAssignments[sectionId]
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        sections: normalizeSectionTimeline([...prev.sections, copy]),
        chords: [...prev.chords, ...chordCopies],
        melodyVariants: variantCopy ? [...prev.melodyVariants, variantCopy] : prev.melodyVariants,
        sectionMelodyAssignments: variantCopy
          ? { ...prev.sectionMelodyAssignments, [newId]: variantCopy.id }
          : prev.sectionMelodyAssignments,
        sectionAccompanimentPatternAssignments: sourcePatternId
          ? { ...prev.sectionAccompanimentPatternAssignments, [newId]: sourcePatternId }
          : prev.sectionAccompanimentPatternAssignments,
        activeMelodyId: variantCopy?.id ?? prev.activeMelodyId,
      },
      selectedSectionId: newId,
      activeBatchId: null,
      activeCandidateIndex: 0,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
    })
    get().persist()
  },

  moveSection: (sectionId, targetIndex) => {
    const prev = get().project
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections: moveSectionInTimeline(prev.sections, sectionId, targetIndex) },
    })
    get().persist()
  },

  selectSection: (sectionId) =>
    set({
      selectedSectionId: sectionId,
      activeBatchId: null,
      activePhraseBatchId: null,
      activePhraseCandidateIndex: 0,
    }),

  setChordText: (sectionId, text) => {
    const prev = get().project
    const ts = parseTimeSignature(prev.song.timeSignature)
    const events = parseChordInputText(text, sectionId, ts.beatsPerBar, sectionId)
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, chords: [...prev.chords.filter((c) => c.sectionId !== sectionId), ...events] },
    })
    get().persist()
  },

  repeatSectionChords: (sectionId) => {
    const prev = get().project
    const section = prev.sections.find((s) => s.id === sectionId)
    const existing = prev.chords.filter((c) => c.sectionId === sectionId).sort((a, b) => a.startBeat - b.startBeat)
    if (!section || existing.length === 0) return

    const ts = parseTimeSignature(prev.song.timeSignature)
    const coveredBeats = Math.max(...existing.map((c) => c.startBeat + c.durationBeats))
    const copies = existing.map((c) => ({ ...c, id: crypto.randomUUID(), startBeat: c.startBeat + coveredBeats }))
    const newLengthBars = Math.max(section.lengthBars, Math.ceil((coveredBeats * 2) / ts.beatsPerBar))

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        chords: [...prev.chords, ...copies],
        sections: normalizeSectionTimeline(
          prev.sections.map((s) => (s.id === sectionId ? { ...s, lengthBars: newLengthBars } : s)),
        ),
      },
    })
    get().persist()
  },

  extendLastChordToFill: (sectionId) => {
    const prev = get().project
    const section = prev.sections.find((s) => s.id === sectionId)
    const existing = prev.chords.filter((c) => c.sectionId === sectionId).sort((a, b) => a.startBeat - b.startBeat)
    if (!section || existing.length === 0) return
    const ts = parseTimeSignature(prev.song.timeSignature)
    const sectionBeats = section.lengthBars * ts.beatsPerBar
    const last = existing[existing.length - 1]
    const covered = last.startBeat + last.durationBeats
    const gap = sectionBeats - covered
    if (gap <= 1e-6) return // 既に充足/超過している場合は何もしない
    const extendedLast = { ...last, durationBeats: Math.round((last.durationBeats + gap) * 1000) / 1000 }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        chords: prev.chords.map((c) => (c.id === last.id ? extendedLast : c)),
      },
    })
    get().persist()
  },

  setGenerationSettings: (patch) => set({ generationSettings: { ...get().generationSettings, ...patch } }),

  toggleGeneratorProfile: (profile) => {
    const current = get().generationSettings.selectedGeneratorProfiles
    const has = current.includes(profile)
    const next = has ? current.filter((p) => p !== profile) : [...current, profile]
    set({ generationSettings: { ...get().generationSettings, selectedGeneratorProfiles: next.length > 0 ? next : ["standard"] } })
  },

  extractMotifDNAFromVariant: (variantId) => {
    const prev = get().project
    const variant = prev.melodyVariants.find((v) => v.id === variantId)
    if (!variant) return
    const chords = prev.chords.filter((c) => c.sectionId === variant.sectionId)
    const harmonicMap = buildHarmonicMap(chords)
    const dna = extractMotifDNA(variant.notes, harmonicMap)
    if (!dna) return
    set({ project: { ...prev, songMotifDNA: dna } })
    get().persist()
  },

  generateForSection: (sectionId) => {
    const prev = get().project
    const section = prev.sections.find((s) => s.id === sectionId)
    if (!section) return
    const ts = parseTimeSignature(prev.song.timeSignature)
    const chords = prev.chords.filter((c) => c.sectionId === sectionId).sort((a, b) => a.startBeat - b.startBeat)
    if (chords.length === 0) return

    const totalBeats = section.lengthBars * ts.beatsPerBar
    // Issue #12: 解析エラーのあるコードは、buildHarmonicMapが黙ってC majorへフォールバックする前に
    // ここで止める(UIのGenerateボタン無効化と合わせた二重の防御)。
    if (diagnoseChordInput(chords, totalBeats).hasError) return
    const profile = effectiveSongProfile(prev, sectionId)
    const settings = get().generationSettings
    const range = resolveRange(settings)
    const sectionContent = section.content ?? DEFAULT_SECTION_CONTENT

    // Issue #41: melody以外のリード内容は、通常のMelody Engineではなく
    // content専用の経路(計画→専用Generator→構造検証)を通す。
    if (usesContentPipeline(sectionContent.lead)) {
      const { candidates: contentCandidates, unresolvedCandidates } = generateSectionContent({
        chords,
        sectionId,
        sectionRole: section.role,
        songProfile: profile,
        content: sectionContent,
        range,
        totalBeats,
        beatsPerBar: ts.beatsPerBar,
        seed: createSeed(),
        key: prev.song.key,
        density: settings.density,
        drama: settings.drama,
        // Issue #41: サビが未生成ならundefinedのまま渡し、生成側で予約値へフォールバックさせる
        chorusPeakMidi: chorusPeakMidi(prev),
      })
      const contentBatchId = crypto.randomUUID()
      const contentVariants = contentCandidates.map((candidate) =>
        toMelodyVariantFromContent(sectionId, profile, candidate, contentBatchId),
      )
      set({
        history: [...get().history, snapshot(prev)],
        future: [],
        project: { ...prev, melodyVariants: [...prev.melodyVariants, ...contentVariants] },
        activeBatchId: contentBatchId,
        activeCandidateIndex: 0,
        // 作り直しの上限まで構造検証を満たせなかった場合は理由を伝える
        workflowNotice:
          unresolvedCandidates.length > 0
            ? `一部の候補が${LEAD_CONTENT_LABELS[unresolvedCandidates[0].content]}として成立していません(${unresolvedCandidates[0].problems[0]})。リード開始位置やセクション長を見直してください。`
            : null,
      })
      get().persist()
      return
    }

    const selectedProfiles: MelodyGeneratorProfile[] =
      settings.selectedGeneratorProfiles.length > 0 ? settings.selectedGeneratorProfiles : ["standard"]

    // Issue #41 / PR#43: Melodyでも entryOffset / pickup は同じ2軸設定として効かせる。
    // 窓の内側だけを生成対象にし(コードをずらして渡す)、生成後にセクション相対へ戻す。
    const window = leadWindowOf(sectionContent, totalBeats)
    const fullSection = isFullSectionWindow(window, totalBeats)
    const windowChords = fullSection ? chords : chordsForWindow(chords, window)
    const windowBeats = windowLengthBeats(window)
    if (windowChords.length === 0 || windowBeats <= 0) {
      set({ workflowNotice: "リード開始位置がセクション終端に達しているため、Melodyを生成できません。" })
      return
    }

    const { candidates } = generateFromChordsWithProfiles({
      chords: windowChords,
      sectionId,
      sectionRole: section.role,
      songProfile: profile,
      density: settings.density,
      range,
      drama: settings.drama,
      totalBeats: windowBeats,
      seed: createSeed(),
      profiles: selectedProfiles,
      motifDNA: prev.songMotifDNA,
      key: prev.song.key,
    })

    const harmonicMap = buildHarmonicMap(chords)
    const batchId = crypto.randomUUID()
    const variants: MelodyVariant[] = candidates.map((c) => {
      const v = toMelodyVariantFromProfile(sectionId, profile, c, batchId)
      if (!fullSection) {
        // 窓相対で作った実音をセクション相対へ戻し、Layer/notesを一致させる
        v.notes = shiftNotesToSection(v.notes, window)
        // restBeats も絶対拍位置なのでまとめてずらす
        // (ずらし忘れると計画が実音とずれ、時間単位移行でも誤った値をスケールしてしまう)
        v.phrasePlans = v.phrasePlans.map((plan) => ({
          ...plan,
          phraseStartBeat: plan.phraseStartBeat + window.startBeat,
          climaxBeat: plan.climaxBeat + window.startBeat,
          restBeats: plan.restBeats.map((beat) => beat + window.startBeat),
        }))
      }
      v.leadContent = "melody"
      const primaryNotes = v.notes
      v.layers = [
        {
          id: `${v.id}:primary`,
          partRole: "lead",
          content: "melody",
          plan: fallbackPlanFor("melody", primaryNotes),
          notes: primaryNotes,
          kind: "primary",
        },
      ]
      // pickupが有効なら、窓の外(セクション末尾)へ弱起を別Layerとして足す
      const pickupNotes = generateMelodyPickupNotes(v.seed, {
        chords,
        sectionId,
        sectionRole: section.role,
        songProfile: profile,
        content: sectionContent,
        range,
        totalBeats,
        beatsPerBar: ts.beatsPerBar,
        seed: v.seed,
        key: prev.song.key,
        chorusPeakMidi: chorusPeakMidi(prev),
      })
      if (pickupNotes.length > 0) {
        v.layers.push({
          id: `${v.id}:pickup`,
          partRole: "lead",
          content: "melody",
          plan: fallbackPlanFor("melody", pickupNotes),
          notes: pickupNotes,
          kind: "pickup",
        })
        v.notes = flattenLayerNotes(v.layers)
      }
      v.features = computeMelodyFeatures(v.notes, harmonicMap, 0, totalBeats)
      return v
    })

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, melodyVariants: [...prev.melodyVariants, ...variants] },
      activeBatchId: batchId,
      activeCandidateIndex: 0,
      workflowNotice: null,
    })
    get().persist()
  },

  setActiveCandidateIndex: (index) => set({ activeCandidateIndex: index }),

  generatePhrasesForSection: (sectionId, lengthBars) => {
    const prev = get().project
    const input = phraseGenerationInput(prev, sectionId, get().generationSettings, createSeed(), lengthBars)
    if (!input) {
      set({ workflowNotice: "フレーズ生成には、2小節以上のセクションと有効なコード進行が必要です。" })
      return
    }
    const generated = generatePhraseCandidates(input)
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const candidates: PhraseCandidate[] = generated.map((candidate, index) => ({
      ...candidate,
      id: crypto.randomUUID(),
      batchId,
      name: `Phrase ${index + 1}`,
      createdAt,
    }))
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, phraseCandidates: [...prev.phraseCandidates, ...candidates] },
      activePhraseBatchId: batchId,
      activePhraseCandidateIndex: 0,
      workflowNotice: null,
    })
    get().persist()
  },

  setActivePhraseCandidateIndex: (index) => set({ activePhraseCandidateIndex: Math.max(0, index) }),

  regeneratePhrase: (candidateId) => {
    const prev = get().project
    const current = prev.phraseCandidates.find((candidate) => candidate.id === candidateId)
    if (!current) return
    const input = phraseGenerationInput(
      prev,
      current.sectionId,
      get().generationSettings,
      current.seed + 104729,
      current.intent.lengthBars,
    )
    if (!input) return
    const siblings = prev.phraseCandidates.filter(
      (candidate) => candidate.batchId === current.batchId && candidate.id !== current.id,
    )
    const regenerated = buildRegeneratedPhrase(input, current.seed, siblings)
    const replacement: PhraseCandidate = {
      ...regenerated,
      id: crypto.randomUUID(),
      batchId: current.batchId,
      name: current.name,
      createdAt: new Date().toISOString(),
    }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        phraseCandidates: prev.phraseCandidates.map((candidate) =>
          candidate.id === candidateId ? replacement : candidate,
        ),
      },
      workflowNotice: null,
    })
    get().persist()
  },

  setActiveMelody: (variantId) => {
    const prev = get().project
    const variant = prev.melodyVariants.find((candidate) => candidate.id === variantId)
    if (!variant) return
    set({
      project: {
        ...prev,
        activeMelodyId: variantId,
        sectionMelodyAssignments: {
          ...prev.sectionMelodyAssignments,
          [variant.sectionId]: variantId,
        },
      },
    })
    get().persist()
  },

  assignVariantToSection: (sectionId, variantId) => {
    const prev = get().project
    if (
      variantId &&
      !prev.melodyVariants.some((variant) => variant.id === variantId && variant.sectionId === sectionId)
    ) {
      return
    }
    const assignments = { ...prev.sectionMelodyAssignments }
    if (variantId) assignments[sectionId] = variantId
    else delete assignments[sectionId]
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        activeMelodyId: variantId ?? prev.activeMelodyId,
        sectionMelodyAssignments: assignments,
      },
    })
    get().persist()
  },

  setVariantReviewState: (variantId, reviewState) => {
    const prev = get().project
    set({
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((variant) =>
          variant.id === variantId ? { ...variant, reviewState } : variant,
        ),
      },
    })
    get().persist()
  },

  selectVariantFromHistory: (variantId) => {
    const prev = get().project
    const variant = prev.melodyVariants.find((candidate) => candidate.id === variantId)
    if (!variant) return
    set({
      project: {
        ...prev,
        activeMelodyId: variantId,
        sectionMelodyAssignments: {
          ...prev.sectionMelodyAssignments,
          [variant.sectionId]: variantId,
        },
      },
      activeBatchId: null,
      activeCandidateIndex: 0,
    })
    get().persist()
  },

  renameVariant: (variantId, name) => {
    const prev = get().project
    set({ project: { ...prev, melodyVariants: prev.melodyVariants.map((v) => (v.id === variantId ? { ...v, name } : v)) } })
    get().persist()
  },

  deleteVariant: (variantId) => {
    const prev = get().project
    const sectionMelodyAssignments = Object.fromEntries(
      Object.entries(prev.sectionMelodyAssignments).filter(([, assignedId]) => assignedId !== variantId),
    )
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.filter((v) => v.id !== variantId),
        activeMelodyId: prev.activeMelodyId === variantId ? null : prev.activeMelodyId,
        sectionMelodyAssignments,
      },
    })
    get().persist()
  },

  toggleNoteLock: (variantId, noteId, lock) => {
    const prev = get().project
    set({
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((v) => {
          if (v.id !== variantId) return v
          return replaceVariantNotes(
            v,
            v.notes.map((n) => {
              if (n.id !== noteId) return n
              const has = n.locks.includes(lock)
              return { ...n, locks: has ? n.locks.filter((l) => l !== lock) : [...n.locks, lock] }
            }),
          )
        }),
      },
    })
    get().persist()
  },

  toggleBarLock: (variantId, barIndex) => {
    const prev = get().project
    set({
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((v) => {
          if (v.id !== variantId) return v
          const has = v.lockedBars.includes(barIndex)
          return { ...v, lockedBars: has ? v.lockedBars.filter((b) => b !== barIndex) : [...v.lockedBars, barIndex] }
        }),
      },
    })
    get().persist()
  },

  updateNote: (variantId, noteId, patch) => {
    const prev = get().project
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((v) =>
          v.id === variantId
            ? replaceVariantNotes(v, v.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)))
            : v,
        ),
      },
    })
    get().persist()
  },

  deleteNote: (variantId, noteId) => {
    const prev = get().project
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((v) =>
          v.id === variantId ? replaceVariantNotes(v, v.notes.filter((n) => n.id !== noteId)) : v,
        ),
      },
    })
    get().persist()
  },

  regenerateRange: (variantId, startBeat, endBeat, lockPatch = {}) => {
    const prev = get().project
    const variant = prev.melodyVariants.find((v) => v.id === variantId)
    const section = variant && prev.sections.find((s) => s.id === variant.sectionId)
    if (!variant || !section) return
    // Issue #41: 部分再生成は歌唱メロディ専用の処理。melody以外のcontent候補へ通すと
    // 生成結果がMelody Engineの出力に置き換わり、leadContent/layersが失われてしまう。
    if (resolvedLeadContent(variant) !== "melody") {
      set({ workflowNotice: "この候補はメロディ以外の内容(Motif/Ostinato/Drone等)のため、範囲の部分再生成は使えません。Generateで作り直してください。" })
      return
    }
    const chords = prev.chords.filter((c) => c.sectionId === variant.sectionId)
    const harmonicMap = buildHarmonicMap(chords)
    const profile = effectiveSongProfile(prev, variant.sectionId)
    const settings = get().generationSettings
    const range = resolveRange(settings)
    const baseParams = resolveGenerationParams(profile, section.role, settings.density, settings.drama, prev.song.key)
    const generatorProfile = variant.generatorProfile ?? "standard"
    const params = applyProfileOverride(
      baseParams,
      generatorProfile,
      generatorProfileIntensity(generatorProfile, section.role),
    )

    const totalBeats = section.lengthBars * parseTimeSignature(prev.song.timeSignature).beatsPerBar
    const locks: RangeRegenerationLocks = {
      pitch: false,
      rhythm: false,
      motif: false,
      opening: false,
      ending: false,
      ...lockPatch,
    }
    const baseSeed = createSeed()
    const result = generateRangeRegenerationCandidates({
      sourceNotes: variant.notes,
      phrasePlans: variant.phrasePlans,
      lockedBars: variant.lockedBars,
      timeSignature: prev.song.timeSignature,
      startBeat,
      endBeat,
      totalBeats,
      harmonicMap,
      range,
      params,
      density: settings.density,
      profile: generatorProfile,
      locks,
      seed: baseSeed,
    })
    if (result.candidates.length === 0) {
      set({
        workflowNotice:
          "品質下限を維持した候補を作れませんでした。範囲または保持条件を緩めてください。",
      })
      return
    }
    const batchId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const variants: MelodyVariant[] = result.candidates.map((candidate, index) =>
      replaceVariantNotes(
        {
          ...variant,
          id: crypto.randomUUID(),
          name: `${variant.name} – Range ${index + 1}`,
          sourceMode: "regenerate-range",
          phrasePlans: candidate.plans,
          features: computeMelodyFeatures(candidate.notes, harmonicMap, 0, totalBeats),
          seed: candidate.seed,
          parentMelodyId: variant.id,
          batchId,
          createdAt,
          patternIndex: (index + 1) as 1 | 2 | 3,
          reviewState: null,
          generationDiagnostics: undefined,
          openingIntent:
            locks.opening || startBeat >= (variant.phrasePlans[0]?.phraseLengthBeats ?? 8)
              ? variant.openingIntent
              : undefined,
          candidateMelodyDNA: locks.motif ? variant.candidateMelodyDNA : undefined,
          elegiacPlan: locks.motif && locks.ending ? variant.elegiacPlan : undefined,
          profileExpressionPlan: undefined,
          prosodyPlan: locks.rhythm ? variant.prosodyPlan : undefined,
          rangeRegeneration: {
            range: { startBeat, endBeat },
            locks,
            candidatePoolIndex: candidate.candidatePoolIndex,
            qualityScore: candidate.qualityScore,
          },
        },
        candidate.notes,
      ),
    )

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        melodyVariants: [...prev.melodyVariants, ...variants],
      },
      activeBatchId: batchId,
      activeCandidateIndex: 0,
      workflowNotice: result.overConstrained
        ? "Pitch/MotifとRhythmを保持したため実音は固定されています。Lockは解除していません。"
        : result.candidates.length < 3
          ? `品質下限を維持できた${result.candidates.length}候補だけを返しました。`
          : null,
    })
    get().persist()
  },

  applySeedOperation: (sourceVariantId, op, seedNoteIds, opts) => {
    const prev = get().project
    const source = prev.melodyVariants.find((v) => v.id === sourceVariantId)
    const section = source && prev.sections.find((s) => s.id === source.sectionId)
    if (!source || !section) return
    // Issue #41: Seed発展操作も歌唱メロディ専用。melody以外のcontent候補へは適用しない
    // (適用するとMelody Engineの出力へ置き換わり、Content Modeが失われる)。
    if (resolvedLeadContent(source) !== "melody") {
      set({ workflowNotice: "この候補はメロディ以外の内容(Motif/Ostinato/Drone等)のため、Seedの発展操作は使えません。" })
      return
    }
    const seedNotes = source.notes.filter((n) => seedNoteIds.includes(n.id))
    if (seedNotes.length === 0) return

    const chords = prev.chords.filter((c) => c.sectionId === source.sectionId)
    const harmonicMap = buildHarmonicMap(chords)
    const profile = effectiveSongProfile(prev, source.sectionId)
    const settings = get().generationSettings
    const range = resolveRange(settings)
    const params = resolveGenerationParams(profile, section.role, settings.density, settings.drama, prev.song.key)
    const seedValue = createSeed()

    let notes: MelodyNote[]
    switch (op) {
      case "continue":
        notes = seedContinue(seedNotes, (opts?.continuationBars ?? 2) * parseTimeSignature(prev.song.timeSignature).beatsPerBar, harmonicMap, range, params, seedValue)
        break
      case "expand":
        notes = seedExpand(seedNotes, (opts?.expandToBars ?? 4) * parseTimeSignature(prev.song.timeSignature).beatsPerBar, harmonicMap, range, params, seedValue)
        break
      case "answer-phrase":
        notes = seedAnswerPhrase(seedNotes, harmonicMap, range, params, seedValue)
        break
      case "variation-rhythm":
        notes = seedVariation(seedNotes, "rhythm", harmonicMap, range, params, seedValue)
        break
      case "variation-pitch":
        notes = seedVariation(seedNotes, "pitch", harmonicMap, range, params, seedValue)
        break
      case "lift":
        notes = seedLift(seedNotes, harmonicMap, range)
        break
      case "restrain":
        notes = seedRestrain(seedNotes, harmonicMap, range)
        break
      default:
        notes = seedNotes
    }

    const totalBeats = section.lengthBars * parseTimeSignature(prev.song.timeSignature).beatsPerBar
    const features = computeMelodyFeatures(notes, harmonicMap, 0, totalBeats)
    const batchId = crypto.randomUUID()
    const newVariant: MelodyVariant = {
      id: crypto.randomUUID(),
      name: `${source.name} - ${op}`,
      sectionId: source.sectionId,
      sourceMode: "develop-seed",
      notes,
      phrasePlans: [],
      lockedBars: [],
      motifLocked: false,
      features,
      generatorVersion: "1.0",
      seed: seedValue,
      songProfile: profile,
      parentMelodyId: source.id,
      batchId,
      createdAt: new Date().toISOString(),
    }

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, melodyVariants: [...prev.melodyVariants, newVariant] },
      activeBatchId: batchId,
      activeCandidateIndex: 0,
    })
    get().persist()
  },

  undo: () => {
    const { history, project, future } = get()
    if (history.length === 0) return
    const prevState = history[history.length - 1]
    set({ project: prevState, history: history.slice(0, -1), future: [snapshot(project), ...future] })
    get().persist()
  },

  redo: () => {
    const { future, project, history } = get()
    if (future.length === 0) return
    const nextState = future[0]
    set({ project: nextState, future: future.slice(1), history: [...history, snapshot(project)] })
    get().persist()
  },
}))
