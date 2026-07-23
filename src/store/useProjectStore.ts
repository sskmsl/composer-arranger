import { create } from "zustand"
import {
  createEmptyProject,
  effectiveSongProfile,
  normalizeProject,
  type ComposerProject,
  type SongProfileId,
} from "@/core/project"
import type { Section, SectionRole } from "@/core/section"
import { parseTimeSignature } from "@/core/section"
import type { LockKind, MelodyNote, MelodyVariant } from "@/core/melody"
import { parseChordInputText } from "@/core/chordInput"
import { buildHarmonicMap } from "@/melody-engine/harmonicMap"
import { generateFromChords, toMelodyVariant } from "@/melody-engine/generateFromChords"
import { resolveGenerationParams, RANGE_PRESETS, type Density, type Drama, type RangeSetting } from "@/melody-engine/generationParams"
import { computeMelodyFeatures } from "@/melody-engine/features"
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
import { saveProject, loadLastOpenedProject, loadProject as loadProjectById } from "@/storage/projectRepository"

export type RangePreset = "low" | "middle" | "high" | "custom"

interface GenerationSettings {
  density: Density
  rangePreset: RangePreset
  customRange: RangeSetting
  drama: Drama
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

  hydrate: () => Promise<void>
  newProject: () => void
  loadProject: (project: ComposerProject) => void
  loadProjectById: (id: string) => Promise<void>
  persist: () => void

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

  generateForSection: (sectionId: string) => void
  setActiveCandidateIndex: (index: number) => void
  setActiveMelody: (variantId: string) => void
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

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createEmptyProject("New Song"),
  selectedSectionId: null,
  activeBatchId: null,
  activeCandidateIndex: 0,
  generationSettings: { density: "balanced", rangePreset: "middle", customRange: RANGE_PRESETS.middle, drama: "growing" },
  history: [],
  future: [],
  hydrated: false,

  hydrate: async () => {
    const last = await loadLastOpenedProject()
    if (last) {
      set({ project: last, selectedSectionId: last.sections[0]?.id ?? null, hydrated: true })
    } else {
      set({ hydrated: true })
    }
  },

  newProject: () => {
    const project = createEmptyProject("New Song")
    set({ project, selectedSectionId: null, activeBatchId: null, history: [], future: [] })
    get().persist()
  },

  loadProject: (project) => {
    const normalized = normalizeProject(project)
    set({ project: normalized, selectedSectionId: normalized.sections[0]?.id ?? null, activeBatchId: null, history: [], future: [] })
    get().persist()
  },

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

    const { candidates } = generateFromChords({
      chords,
      sectionId,
      sectionRole: section.role,
      songProfile: profile,
      density: settings.density,
      range,
      drama: settings.drama,
      totalBeats,
      seed: createSeed(),
    })

    const harmonicMap = buildHarmonicMap(chords)
    const batchId = crypto.randomUUID()
    const params = resolveGenerationParams(profile, section.role, settings.density, settings.drama)
    const variants: MelodyVariant[] = candidates.map((c, i) => {
      const v = toMelodyVariant(sectionId, profile, c, i, batchId)
      v.features = computeMelodyFeatures(v.notes, harmonicMap, 0, totalBeats)
      return v
    })
    void params

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
    const params = resolveGenerationParams(profile, section.role, settings.density, settings.drama)

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
    const params = resolveGenerationParams(profile, section.role, settings.density, settings.drama)
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
