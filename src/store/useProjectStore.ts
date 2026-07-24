import { create } from "zustand"
import {
  createEmptyProject,
  effectiveSongProfile,
  type ComposerProject,
  type SongProfileId,
} from "@/core/project"
import type { Section, SectionRole } from "@/core/section"
import { parseTimeSignature } from "@/core/section"
import type { LockKind, MelodyGeneratorProfile, MelodyNote, MelodyVariant } from "@/core/melody"
import { parseChordInputText } from "@/core/chordInput"
import { buildHarmonicMap } from "@/melody-engine/harmonicMap"
import { generateFromChordsWithProfiles, toMelodyVariantFromProfile } from "@/melody-engine/generateFromChords"
import { resolveGenerationParams, RANGE_PRESETS, type Density, type Drama, type RangeSetting } from "@/melody-engine/generationParams"
import { computeMelodyFeatures } from "@/melody-engine/features"
import { extractMotifDNA } from "@/melody-engine/motifDNA"
import { regenerateSelection } from "@/melody-engine/regenerateSelection"
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
import { saveProject, loadLastOpenedProject, loadProject as loadProjectById, backupProjectTimingSnapshot } from "@/storage/projectRepository"
import { resolveProjectTiming, resolveAmbiguousTiming } from "@/core/timingMigration"

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
  generationSettings: GenerationSettings
  history: ComposerProject[]
  future: ComposerProject[]
  hydrated: boolean
  /** Issue #16: 時間単位の自動変換通知/確認待ち(判定できなかった場合) */
  timingNotice: TimingNotice | null

  hydrate: () => Promise<void>
  newProject: () => void
  loadProject: (project: unknown) => void
  loadProjectById: (id: string) => Promise<void>
  persist: () => void
  /** timingNoticeがambiguousの場合にユーザーの選択を適用する。auto-convertedの通知は単に閉じる */
  confirmTimingConversion: (convert: boolean) => void
  dismissTimingNotice: () => void

  updateSongField: <K extends keyof ComposerProject["song"]>(key: K, value: ComposerProject["song"][K]) => void
  setSectionProfileOverride: (sectionId: string, profile: SongProfileId | null) => void

  addSection: (name: string, role: SectionRole, lengthBars: number) => void
  updateSection: (sectionId: string, patch: Partial<Section>) => void
  removeSection: (sectionId: string) => void
  duplicateSection: (sectionId: string) => void
  selectSection: (sectionId: string | null) => void

  setChordText: (sectionId: string, text: string) => void
  /** 現在のコード進行をそのまま複製して後ろへ繋げ、小節数を2倍にする */
  repeatSectionChords: (sectionId: string) => void
  setGenerationSettings: (patch: Partial<GenerationSettings>) => void
  toggleGeneratorProfile: (profile: MelodyGeneratorProfile) => void
  /** Song Motif DNA(将来のセクション間一貫性チェックの土台): 指定Variantから抽出して保存する */
  extractMotifDNAFromVariant: (variantId: string) => void

  generateForSection: (sectionId: string) => void
  setActiveCandidateIndex: (index: number) => void
  setActiveMelody: (variantId: string) => void
  /** 生成履歴からVariantを選ぶ: Active Melodyにするだけでなく、現在の候補バッチ表示も解除する */
  selectVariantFromHistory: (variantId: string) => void
  renameVariant: (variantId: string, name: string) => void
  deleteVariant: (variantId: string) => void

  toggleNoteLock: (variantId: string, noteId: string, lock: LockKind) => void
  toggleBarLock: (variantId: string, barIndex: number) => void
  updateNote: (variantId: string, noteId: string, patch: Partial<MelodyNote>) => void
  deleteNote: (variantId: string, noteId: string) => void
  regenerateRange: (variantId: string, startBeat: number, endBeat: number) => void

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

function snapshot(project: ComposerProject): ComposerProject {
  return JSON.parse(JSON.stringify(project))
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
    set({ project, selectedSectionId: null, activeBatchId: null, history: [], future: [], timingNotice: null })
    get().persist()
  },

  loadProject: (raw) => {
    const result = resolveProjectTiming(raw)
    if (result.status !== "no-op") void backupProjectTimingSnapshot(raw)
    set({
      project: result.project,
      selectedSectionId: result.project.sections[0]?.id ?? null,
      activeBatchId: null,
      history: [],
      future: [],
      timingNotice: timingNoticeFrom(result),
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
    const lastEnd = prev.sections.reduce((m, s) => Math.max(m, s.startBar + s.lengthBars), 1)
    const section: Section = { id: crypto.randomUUID(), name, role, startBar: lastEnd, lengthBars }
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections: [...prev.sections, section] },
      selectedSectionId: section.id,
    })
    get().persist()
  },

  updateSection: (sectionId, patch) => {
    const prev = get().project
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)) },
    })
    get().persist()
  },

  removeSection: (sectionId) => {
    const prev = get().project
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        sections: prev.sections.filter((s) => s.id !== sectionId),
        chords: prev.chords.filter((c) => c.sectionId !== sectionId),
        melodyVariants: prev.melodyVariants.filter((v) => v.sectionId !== sectionId),
      },
      selectedSectionId: prev.sections.find((s) => s.id !== sectionId)?.id ?? null,
    })
    get().persist()
  },

  duplicateSection: (sectionId) => {
    const prev = get().project
    const src = prev.sections.find((s) => s.id === sectionId)
    if (!src) return
    const newId = crypto.randomUUID()
    const lastEnd = prev.sections.reduce((m, s) => Math.max(m, s.startBar + s.lengthBars), 1)
    const copy: Section = { ...src, id: newId, name: `${src.name} copy`, startBar: lastEnd }
    const chordCopies = prev.chords.filter((c) => c.sectionId === sectionId).map((c) => ({ ...c, id: crypto.randomUUID(), sectionId: newId }))
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, sections: [...prev.sections, copy], chords: [...prev.chords, ...chordCopies] },
      selectedSectionId: newId,
    })
    get().persist()
  },

  selectSection: (sectionId) => set({ selectedSectionId: sectionId, activeBatchId: null }),

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
        sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, lengthBars: newLengthBars } : s)),
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
    const profile = effectiveSongProfile(prev, sectionId)
    const settings = get().generationSettings
    const range = resolveRange(settings)
    const selectedProfiles: MelodyGeneratorProfile[] =
      settings.selectedGeneratorProfiles.length > 0 ? settings.selectedGeneratorProfiles : ["standard"]

    const { candidates } = generateFromChordsWithProfiles({
      chords,
      sectionId,
      sectionRole: section.role,
      songProfile: profile,
      density: settings.density,
      range,
      drama: settings.drama,
      totalBeats,
      seed: createSeed(),
      profiles: selectedProfiles,
      motifDNA: prev.songMotifDNA,
      key: prev.song.key,
    })

    const harmonicMap = buildHarmonicMap(chords)
    const batchId = crypto.randomUUID()
    const variants: MelodyVariant[] = candidates.map((c) => {
      const v = toMelodyVariantFromProfile(sectionId, profile, c, batchId)
      v.features = computeMelodyFeatures(v.notes, harmonicMap, 0, totalBeats)
      return v
    })

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, melodyVariants: [...prev.melodyVariants, ...variants] },
      activeBatchId: batchId,
      activeCandidateIndex: 0,
    })
    get().persist()
  },

  setActiveCandidateIndex: (index) => set({ activeCandidateIndex: index }),

  setActiveMelody: (variantId) => {
    const prev = get().project
    set({ project: { ...prev, activeMelodyId: variantId } })
    get().persist()
  },

  selectVariantFromHistory: (variantId) => {
    const prev = get().project
    set({ project: { ...prev, activeMelodyId: variantId }, activeBatchId: null, activeCandidateIndex: 0 })
    get().persist()
  },

  renameVariant: (variantId, name) => {
    const prev = get().project
    set({ project: { ...prev, melodyVariants: prev.melodyVariants.map((v) => (v.id === variantId ? { ...v, name } : v)) } })
    get().persist()
  },

  deleteVariant: (variantId) => {
    const prev = get().project
    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: { ...prev, melodyVariants: prev.melodyVariants.filter((v) => v.id !== variantId) },
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
          return {
            ...v,
            notes: v.notes.map((n) => {
              if (n.id !== noteId) return n
              const has = n.locks.includes(lock)
              return { ...n, locks: has ? n.locks.filter((l) => l !== lock) : [...n.locks, lock] }
            }),
          }
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
          v.id === variantId ? { ...v, notes: v.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)) } : v,
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
        melodyVariants: prev.melodyVariants.map((v) => (v.id === variantId ? { ...v, notes: v.notes.filter((n) => n.id !== noteId) } : v)),
      },
    })
    get().persist()
  },

  regenerateRange: (variantId, startBeat, endBeat) => {
    const prev = get().project
    const variant = prev.melodyVariants.find((v) => v.id === variantId)
    const section = variant && prev.sections.find((s) => s.id === variant.sectionId)
    if (!variant || !section) return
    const chords = prev.chords.filter((c) => c.sectionId === variant.sectionId)
    const harmonicMap = buildHarmonicMap(chords)
    const profile = effectiveSongProfile(prev, variant.sectionId)
    const settings = get().generationSettings
    const range = resolveRange(settings)
    const params = resolveGenerationParams(profile, section.role, settings.density, settings.drama, prev.song.key)

    const notes = regenerateSelection(
      variant.notes,
      variant.lockedBars,
      prev.song.timeSignature,
      startBeat,
      endBeat,
      harmonicMap,
      range,
      params,
      settings.density,
      createSeed(),
    )
    const totalBeats = section.lengthBars * parseTimeSignature(prev.song.timeSignature).beatsPerBar
    const features = computeMelodyFeatures(notes, harmonicMap, 0, totalBeats)

    set({
      history: [...get().history, snapshot(prev)],
      future: [],
      project: {
        ...prev,
        melodyVariants: prev.melodyVariants.map((v) => (v.id === variantId ? { ...v, notes, features } : v)),
      },
    })
    get().persist()
  },

  applySeedOperation: (sourceVariantId, op, seedNoteIds, opts) => {
    const prev = get().project
    const source = prev.melodyVariants.find((v) => v.id === sourceVariantId)
    const section = source && prev.sections.find((s) => s.id === source.sectionId)
    if (!source || !section) return
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
