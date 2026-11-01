import { arrangementReviewSong } from "../../src/store/arrangementReviewFixtures"
import { useProjectStore } from "../../src/store/useProjectStore"
import { parseTimeSignature } from "../../src/core/section"
import { generateFullSongArrangement } from "../../src/melody-engine/arrangementGenerator"

// 比較検証専用の入力。製品の画面・モード・プリセットには追加しない。
export const listeningCases = [
  { id: "minor-44", label: "余白のある4/4・短調", song: "A", meter: "4/4", tempo: 76, long: false },
  { id: "major-44", label: "速い4/4・長調", song: "B", meter: "4/4", tempo: 118, long: false },
  { id: "minor-34", label: "3拍子・短調", song: "A", meter: "3/4", tempo: 84, long: false },
  { id: "major-68", label: "6/8・長調", song: "B", meter: "6/8", tempo: 90, long: false },
  { id: "long-44", label: "長い構成・4/4", song: "A", meter: "4/4", tempo: 96, long: true },
] as const

export function createListeningCase(id: string, seed: number) {
  const settings = listeningCases.find(item => item.id === id)
  if (!settings) throw new Error(`Unknown listening case: ${id}`)
  let random = seed >>> 0
  let uuid = 0
  const originalRandom = Math.random, originalUUID = crypto.randomUUID
  Math.random = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296 }
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`
  const originalPersist = useProjectStore.getState().persist
  try {
    const project = arrangementReviewSong(settings.song)
    project.projectId = `listening-${id}-${seed}`
    project.title = `${settings.label} / seed ${seed}`
    if (settings.long) {
      let startBar = 1
      project.chords = project.sections.flatMap(section => {
        const originalBars = section.lengthBars
        const source = project.chords.filter(chord => chord.sectionId === section.id)
        const repeated = Array.from({ length: 16 / originalBars }, (_, repeat) => source.map(chord => ({ ...chord,
          id: `${chord.id}:${repeat}`, startBeat: chord.startBeat + repeat * originalBars * 4,
        }))).flat()
        section.startBar = startBar; section.lengthBars = 16; startBar += 16
        return repeated
      })
    }
    const factor = parseTimeSignature(settings.meter).beatsPerBar / 4
    project.song.timeSignature = settings.meter; project.song.tempo = settings.tempo
    project.chords = project.chords.map(chord => ({ ...chord, startBeat: chord.startBeat * factor, durationBeats: chord.durationBeats * factor }))
    useProjectStore.setState({ project, persist: () => {}, history: [], future: [],
      generationSettings: { density: "balanced", rangePreset: "middle", customRange: { low: 60, high: 77 }, drama: "growing", selectedGeneratorProfiles: ["standard"], techniqueExperimentPresetId: null },
    })
    for (const section of project.sections) {
      useProjectStore.getState().generateForSection(section.id)
      const state = useProjectStore.getState()
      const adopted = state.project.melodyVariants.find(variant => variant.sectionId === section.id && variant.batchId === state.activeBatchId)
      if (!adopted) throw new Error(`${id}/${seed}/${section.name}: no melody candidate met the current generation rules`)
      state.assignVariantToSection(section.id, adopted.id)
    }
    const prepared = structuredClone(useProjectStore.getState().project)
    const arrangement = generateFullSongArrangement(prepared, { seed })
    prepared.fullSongArrangement = arrangement
    return { project: prepared, arrangement }
  } finally {
    Math.random = originalRandom; crypto.randomUUID = originalUUID
    useProjectStore.setState({ persist: originalPersist })
  }
}
