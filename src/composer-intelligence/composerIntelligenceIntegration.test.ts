import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import { SeededRandom } from "@/core/rng"
import {
  candidateTechniqueFitScore,
  planCandidateMelodyDNA,
} from "@/melody-engine/candidateMelodyDNA"
import { generateCounterCandidates } from "@/melody-engine/counterGenerator"
import { generateFromChordsWithProfiles } from "@/melody-engine/generateFromChords"
import {
  DEFAULT_DECORATION_SETTINGS,
  generateDecorationCandidates,
} from "@/melody-engine/decorationGenerator"
import {
  planPhraseIntent,
  type GeneratePhrasesInput,
} from "@/phrase-engine/generatePhrases"
import {
  TECHNIQUE_EXPERIMENT_PRESETS,
  resolveComposerRules,
  resolvePublicComposerRules,
  techniqueExperimentPreset,
  techniqueExperimentRules,
  type ComposerGeneratorTarget,
  type ComposerRule,
} from "."

function rulesFor(
  generatorTarget: ComposerGeneratorTarget,
  prefer: ComposerRule["prefer"],
) {
  return resolveComposerRules(
    [
      {
        id: `technique-${generatorTarget}`,
        origin: "technique",
        status: "validated",
        priority: 50,
        confidence: 1,
        when: { generatorTargets: [generatorTarget] },
        prefer,
      },
    ],
    {
      generatorTarget,
      sectionRole: "verse",
    },
  )
}

function note(
  id: string,
  startBeat: number,
  durationBeats: number,
  pitch: number,
): MelodyNote {
  return {
    id,
    startBeat,
    durationBeats,
    pitch,
    velocity: 80,
    locks: [],
  }
}

function melody(): MelodyVariant {
  return {
    id: "melody-a",
    name: "Active Melody",
    sectionId: "verse",
    sourceMode: "generate",
    notes: [
      note("m1", 0, 1, 64),
      note("m2", 2, 1, 67),
      note("m3", 4, 1, 69),
      note("m4", 6, 1, 72),
      note("m5", 8, 1, 71),
      note("m6", 10, 1, 69),
      note("m7", 12, 1, 67),
      note("m8", 14, 1, 64),
    ],
    phrasePlans: [],
    lockedBars: [],
    motifLocked: false,
    features: null,
    generatorVersion: "test",
    seed: 1,
    songProfile: "original-custom",
    parentMelodyId: null,
    batchId: "batch",
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("Composer Intelligence / Generator execution boundary", () => {
  it("Decoration Autoが解決済みTechnique Ruleを利用する", () => {
    const candidates = generateDecorationCandidates({
      sectionId: "verse",
      sectionRole: "verse",
      songProfile: "dark-romantic",
      chords: parseChordInputText("Am | F | C | G", "verse", 4, "c"),
      totalBeats: 16,
      beatsPerBar: 4,
      key: "Am",
      seed: 42,
      settings: {
        ...DEFAULT_DECORATION_SETTINGS,
        type: "decorative-fill",
        character: "strings",
      },
      isLastSection: false,
      composerRules: rulesFor("decoration", {
        decorationGestureRole: [{ value: "response", weight: 1 }],
        melodicDirection: [{ value: "descending", weight: 1 }],
        register: [{ value: "low", weight: 1 }],
        phraseDensity: [{ value: "sparse", weight: 1 }],
      }),
    })
    expect(candidates.length).toBeGreaterThan(0)
    expect(
      candidates.some(
        (candidate) =>
          candidate.decorationPlan?.gestureRole === "response",
      ),
    ).toBe(true)
    expect(
      candidates.some(
        (candidate) => candidate.decorationPlan?.direction === "falling",
      ),
    ).toBe(true)
    expect(
      candidates.some(
        (candidate) => candidate.decorationPlan?.register === "low",
      ),
    ).toBe(true)
    expect(
      candidates.some(
        (candidate) => candidate.decorationPlan?.density === "sparse",
      ),
    ).toBe(true)
  })

  it("Phrase AutoがContour・Rhythm・Harmony・Cadence Ruleを利用する", () => {
    const phraseInput: GeneratePhrasesInput = {
      chords: parseChordInputText("Am | F | C | G", "verse", 4, "c"),
      sectionId: "verse",
      sectionRole: "verse",
      songProfile: "dark-romantic",
      density: "balanced",
      drama: "growing",
      range: { low: 55, high: 79 },
      key: "Am",
      beatsPerBar: 4,
      totalBeats: 16,
      seed: 42,
      composerRules: rulesFor("phrase", {
        phraseContour: [{ value: "descending", weight: 1 }],
        rhythmCharacter: [{ value: "breathing", weight: 1 }],
        harmonicApproach: [{ value: "common-tone", weight: 1 }],
        cadenceType: [{ value: "open", weight: 1 }],
      }),
    }
    const intents = Array.from({ length: 12 }, (_, index) =>
      planPhraseIntent(
        phraseInput,
        42 + index * 7919,
        index,
      ),
    )
    expect(
      intents.filter((intent) => intent.contour === "descending").length,
    ).toBeGreaterThanOrEqual(4)
    expect(
      intents.filter(
        (intent) => intent.rhythmCharacter === "breathing",
      ).length,
    ).toBeGreaterThanOrEqual(4)
    expect(
      intents.filter(
        (intent) => intent.harmonicApproach === "common-tone",
      ).length,
    ).toBeGreaterThanOrEqual(4)
    expect(
      intents.filter((intent) => intent.cadence === "open").length,
    ).toBeGreaterThanOrEqual(4)
  })

  it("Counter候補プールがPart RoleとRegister Relationを優先する", () => {
    const candidates = generateCounterCandidates({
      sectionId: "verse",
      sectionRole: "verse",
      songProfile: "dark-romantic",
      key: "Am",
      chords: parseChordInputText("Am | F | C | G", "verse", 4, "c"),
      melody: melody(),
      totalBeats: 16,
      seed: 42,
      composerRules: rulesFor("counter", {
        partRole: [{ value: "suspension-layer", weight: 1 }],
        registerRelation: [{ value: "above", weight: 1 }],
      }),
    })
    expect(
      candidates.some(
        (candidate) =>
          candidate.role === "suspension-layer" &&
          candidate.generatorStyle === "synth-whisper",
      ),
    ).toBe(true)
  })

  it("Melody DNA候補をTechnique Ruleへ寄せつつ複数Prototypeを維持する", () => {
    const composerRules = rulesFor("melody", {
      motifIdentity: [{ value: "repeated-cell", weight: 1 }],
      rhythmGrammar: [{ value: "cyclic", weight: 1 }],
    })
    const candidates = Array.from({ length: 9 }, (_, index) =>
      planCandidateMelodyDNA(
        new SeededRandom(42),
        "standard",
        index,
        0.5,
        composerRules,
      ),
    )
    expect(
      candidates.filter(
        (candidate) => candidate.motifIdentity === "repeated-cell",
      ).length,
    ).toBeGreaterThanOrEqual(3)
    expect(new Set(candidates.map((candidate) => candidate.motifIdentity)).size)
      .toBeGreaterThanOrEqual(2)
  })

  it("生成後のMelody DNAをTechnique Ruleとの適合度として採点する", () => {
    const composerRules = rulesFor("melody", {
      motifIdentity: [{ value: "repeated-cell", weight: 1 }],
      rhythmGrammar: [{ value: "cyclic", weight: 1 }],
    })
    const matching = {
      ...planCandidateMelodyDNA(
        new SeededRandom(42),
        "incantatory",
        0,
        0.5,
      ),
      motifIdentity: "repeated-cell" as const,
      rhythmGrammar: "cyclic" as const,
    }
    const mismatching = {
      ...matching,
      motifIdentity: "stepwise-cell" as const,
      rhythmGrammar: "balanced" as const,
    }
    expect(candidateTechniqueFitScore(matching, composerRules)).toBe(1)
    expect(candidateTechniqueFitScore(mismatching, composerRules)).toBe(0)
    expect(candidateTechniqueFitScore(matching, undefined)).toBeUndefined()
  })

  it("Technique適合度を候補診断へ残し、固定seedで選抜を再現する", () => {
    const composerRules = rulesFor("melody", {
      motifIdentity: [{ value: "repeated-cell", weight: 1 }],
      rhythmGrammar: [{ value: "cyclic", weight: 1 }],
    })
    const generate = () =>
      generateFromChordsWithProfiles({
        chords: parseChordInputText("Am | F | C | G", "verse", 4, "c"),
        sectionId: "verse",
        sectionRole: "verse",
        songProfile: "dark-romantic",
        density: "balanced",
        drama: "growing",
        range: { low: 55, high: 79 },
        totalBeats: 16,
        seed: 42,
        profiles: ["standard"],
        composerRules,
      })
    const first = generate()
    const repeated = generate()
    expect(
      first.diagnostics.every(
        (diagnostic) =>
          diagnostic.techniqueFitScore !== undefined &&
          diagnostic.techniqueFitScore >= 0 &&
          diagnostic.techniqueFitScore <= 1,
      ),
    ).toBe(true)
    expect(
      first.candidates.map(
        (candidate) =>
          candidate.generationDiagnostics?.candidatePoolIndex,
      ),
    ).toEqual(
      repeated.candidates.map(
        (candidate) =>
          candidate.generationDiagnostics?.candidatePoolIndex,
      ),
    )
  })

  it("Draft実験PresetをLifecycle昇格なしの一時Ruleとしてだけ解決する", () => {
    const context = {
      generatorTarget: "melody" as const,
      sectionRole: "verse" as const,
    }
    const withoutExperiment = resolvePublicComposerRules(context)
    const rules = techniqueExperimentRules(
      "space-microvariation",
      context,
    )
    const withExperiment = resolvePublicComposerRules(
      context,
      rules,
    )
    expect(withoutExperiment.appliedRuleIds).toHaveLength(0)
    expect(withExperiment.appliedRuleIds.length).toBeGreaterThan(0)
    expect(rules.every((rule) => rule.origin === "experimental")).toBe(
      true,
    )
    expect(
      JSON.stringify(rules).includes("genreSource"),
    ).toBe(false)
    expect(TECHNIQUE_EXPERIMENT_PRESETS).toHaveLength(4)
    expect(
      techniqueExperimentPreset("slow-burn-escalation"),
    ).toMatchObject({
      validationLevel: "confirmed",
      recommendedProfiles: ["elegiac-cantabile"],
    })
    expect(
      techniqueExperimentPreset("negative-space-groove"),
    ).toMatchObject({
      targetValidationLevels: {
        phrase: "confirmed",
        counter: "confirmed",
        decoration: "confirmed",
      },
      recommendedSectionRolesByTarget: {
        phrase: ["pre-chorus", "chorus", "outro"],
        counter: ["intro", "verse"],
        decoration: [
          "intro",
          "verse",
          "pre-chorus",
          "chorus",
          "bridge",
          "outro",
        ],
      },
    })
    expect(
      techniqueExperimentPreset(
        "stable-loop-local-mutation",
      ),
    ).toMatchObject({
      targetValidationLevels: { decoration: "confirmed" },
      recommendedSectionRolesByTarget: {
        decoration: [
          "intro",
          "verse",
          "pre-chorus",
          "chorus",
          "bridge",
          "outro",
        ],
      },
    })
    expect(
      techniqueExperimentRules(
        "negative-space-groove",
        context,
      ),
    ).toHaveLength(1)
    const phraseRules = techniqueExperimentRules(
      "stable-loop-local-mutation",
      {
        generatorTarget: "phrase",
        sectionRole: "verse",
      },
    )
    expect(phraseRules).toHaveLength(1)
    expect(
      phraseRules[0].prefer.developmentStrategy,
    ).toBeDefined()
    expect(phraseRules[0].when.generatorTargets).toEqual([
      "phrase",
    ])
    const counterRules = techniqueExperimentRules(
      "stable-loop-local-mutation",
      {
        generatorTarget: "counter",
        sectionRole: "verse",
      },
    )
    expect(counterRules).toHaveLength(1)
    expect(counterRules[0].prefer.partRole).toBeDefined()
    const decorationRules = techniqueExperimentRules(
      "negative-space-groove",
      {
        generatorTarget: "decoration",
        sectionRole: "outro",
      },
    )
    expect(decorationRules).toHaveLength(1)
    expect(
      decorationRules[0].prefer.decorationGestureRole,
    ).toBeDefined()
  })
})
