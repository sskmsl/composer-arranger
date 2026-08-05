import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote, MelodyVariant } from "@/core/melody"
import {
  evaluateCounterpointFit,
  generateCounterCandidates,
  regenerateCounterCandidate,
} from "./counterGenerator"
import {
  analyzeCounterContext,
  unresolvedReactiveToneNoteIds,
} from "./reactiveLayerAnalysis"

function note(id: string, startBeat: number, durationBeats: number, pitch: number): MelodyNote {
  return { id, startBeat, durationBeats, pitch, velocity: 80, locks: [] }
}

function melody(): MelodyVariant {
  return {
    id: "melody-a",
    name: "Active Melody",
    sectionId: "s1",
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
    batchId: "melody-batch",
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

const input = {
  sectionId: "s1",
  sectionRole: "verse" as const,
  songProfile: "dark-romantic" as const,
  key: "Am",
  chords: parseChordInputText("Am | F | C | G", "s1", 4, "c"),
  melody: melody(),
  totalBeats: 16,
  seed: 42,
}

describe("Issue #70 / Counter Generator MVP", () => {
  it("120件の候補プールから品質と多様性を考慮した独立10候補を選ぶ", () => {
    const candidates = generateCounterCandidates(input)
    expect(
      candidates,
      JSON.stringify(
        candidates.map((candidate) => ({
          style: candidate.generatorStyle,
          quality: candidate.quality,
          collisions: candidate.collisions,
          notes: candidate.notes.map((item) => [
            item.startBeat,
            item.durationBeats,
            item.pitch,
          ]),
        })),
      ),
    ).toHaveLength(10)
    expect(new Set(candidates.map((candidate) => candidate.generatorStyle)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(candidates.map((candidate) => candidate.role)).size).toBeGreaterThanOrEqual(4)
    expect(
      new Set(
        candidates.map((candidate) =>
          candidate.notes
            .map(
              (item) =>
                `${item.startBeat}:${item.durationBeats}:${item.pitch}`,
            )
            .join("|"),
        ),
      ).size,
    ).toBe(10)
    expect(candidates[0].selectionReason).toBe("highest-quality")
    expect(candidates.slice(1).every((candidate) => candidate.selectionReason === "quality-diversity-balance")).toBe(true)
    expect(candidates.every((candidate) => candidate.notes.length > 0)).toBe(true)
    expect(candidates.every((candidate) => unresolvedReactiveToneNoteIds(candidate.notes).length === 0)).toBe(true)
    expect(candidates.every((candidate) => candidate.notes.length >= 3)).toBe(true)
    expect(
      candidates.every((candidate) => {
        const first = candidate.notes[0]
        const last = candidate.notes.at(-1)!
        return last.startBeat + last.durationBeats - first.startBeat >= 1
      }),
    ).toBe(true)
    const hasStepwiseCandidate = candidates.some(
        (candidate) =>
          candidate.notes.length >= 2 &&
          candidate.notes.slice(1).every((item, index) => {
            const interval = Math.abs(item.pitch - candidate.notes[index].pitch)
            return interval > 0 && interval <= 3
          }),
      )
    expect(
      hasStepwiseCandidate,
      JSON.stringify(
        candidates.map((candidate) => ({
          style: candidate.generatorStyle,
          quality: candidate.quality,
          pitches: candidate.notes.map((item) => item.pitch),
        })),
      ),
    ).toBe(true)
    expect(candidates.every((candidate) => candidate.quality.overallQuality >= 68)).toBe(true)
    expect(candidates.every((candidate) => candidate.counterPlan)).toBe(true)
    expect(candidates.every((candidate) => candidate.counterQuality)).toBe(true)
    expect(
      candidates.every(
        (candidate) =>
          candidate.counterQuality!.overall >= 62 &&
          candidate.counterQuality!.controlledRisk >= 72 &&
          candidate.counterQuality!.emotionalNecessity >= 68,
      ),
    ).toBe(true)
  })

  it("10案をFocusedへ収束させず、異なる対話・リズム・輪郭・Endingとして選ぶ", () => {
    for (const seed of [42, 701, 2197]) {
      const candidates = generateCounterCandidates({ ...input, seed })
      const plans = candidates.map((candidate) => candidate.counterPlan!)
      const risks = plans.map((plan) => plan.creativeRisk)
      expect(risks.filter((risk) => risk === "radical").length).toBeGreaterThanOrEqual(2)
      expect(risks.filter((risk) => risk === "bold").length).toBeGreaterThanOrEqual(3)
      expect(new Set(risks)).toEqual(new Set(["focused", "bold", "radical"]))
      expect(new Set(plans.map((plan) => plan.dialogueIntent)).size).toBeGreaterThanOrEqual(4)
      expect(new Set(plans.map((plan) => plan.rhythmGrammar)).size).toBeGreaterThanOrEqual(4)
      expect(new Set(plans.map((plan) => plan.contour)).size).toBeGreaterThanOrEqual(4)
      expect(new Set(plans.map((plan) => plan.ending)).size).toBeGreaterThanOrEqual(3)
    }
  })

  it("RadicalはFocusedより大胆だが、実休符・16分グリッド・非重複・解決を守る", () => {
    const candidates = generateCounterCandidates({ ...input, seed: 9017 })
    const radical = candidates.filter(
      (candidate) => candidate.counterPlan?.creativeRisk === "radical",
    )
    const focused = candidates.filter(
      (candidate) => candidate.counterPlan?.creativeRisk === "focused",
    )
    const average = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
    expect(
      average(radical.map((candidate) => candidate.counterQuality!.audacity)),
    ).toBeGreaterThan(
      average(focused.map((candidate) => candidate.counterQuality!.audacity)),
    )
    for (const candidate of candidates) {
      const ordered = [...candidate.notes].sort(
        (left, right) => left.startBeat - right.startBeat,
      )
      expect(
        ordered.every(
          (counterNote) =>
            Math.floor(counterNote.startBeat) % 2 === 1 &&
            Number.isInteger(counterNote.startBeat * 4) &&
            Number.isInteger(counterNote.durationBeats * 4),
        ),
      ).toBe(true)
      expect(
        ordered.slice(1).every(
          (counterNote, index) =>
            ordered[index].startBeat + ordered[index].durationBeats <=
            counterNote.startBeat + 0.001,
        ),
      ).toBe(true)
      expect(unresolvedReactiveToneNoteIds(ordered)).toHaveLength(0)
      expect(candidate.collisions.hasBlockingCollision).toBe(false)
    }
  })

  it("階段・折り返し・跳躍回収を固定カテゴリではなく同じ候補セットへ共存させる", () => {
    const candidates = generateCounterCandidates({ ...input, seed: 38117 })
    const plans = candidates.map((candidate) => candidate.counterPlan!)
    expect(
      plans.some((plan) => plan.contour.includes("staircase")),
    ).toBe(true)
    expect(
      plans.some((plan) => plan.contour === "arch" || plan.contour === "inverted-arch"),
    ).toBe(true)
    expect(plans.some((plan) => plan.contour === "leap-recovery")).toBe(true)
    expect(
      candidates.some(
        (candidate) =>
          candidate.counterPlan?.creativeRisk !== "focused" &&
          new Set(
            candidate.notes.map((counterNote) => Math.floor(counterNote.startBeat / 2)),
          ).size >= 2,
      ),
    ).toBe(true)
  })

  it("主旋律の休符へ配置し、Blocking Collisionを作らない", () => {
    const candidates = generateCounterCandidates(input)
    for (const candidate of candidates) {
      expect(candidate.quality.gapUsage).toBeGreaterThanOrEqual(99.9)
      expect(candidate.collisions.hasBlockingCollision).toBe(false)
      expect(Math.floor(candidate.notes[0].startBeat) % 2).toBe(1)
    }
  })

  it("同じseedと入力なら音程・リズム・Styleを再現する", () => {
    const first = generateCounterCandidates(input)
    const second = generateCounterCandidates(input)
    const signature = (candidate: (typeof first)[number]) => ({
      style: candidate.generatorStyle,
      role: candidate.role,
      plan: candidate.counterPlan,
      notes: candidate.notes.map((item) => [
        item.startBeat,
        item.durationBeats,
        item.pitch,
        item.velocity,
      ]),
    })
    expect(second.map(signature)).toEqual(first.map(signature))
  })

  it("個別再生成はStyleだけでなく作曲計画を最低3軸変更する", () => {
    const candidates = generateCounterCandidates(input)
    const current = candidates[0]
    const regenerated = regenerateCounterCandidate(
      input,
      current,
      candidates.slice(1),
    )
    expect(regenerated).not.toBeNull()
    const changedAxes = [
      regenerated!.counterPlan!.dialogueIntent !== current.counterPlan!.dialogueIntent,
      regenerated!.counterPlan!.rhythmGrammar !== current.counterPlan!.rhythmGrammar,
      regenerated!.counterPlan!.contour !== current.counterPlan!.contour,
      regenerated!.counterPlan!.development !== current.counterPlan!.development,
      regenerated!.counterPlan!.ending !== current.counterPlan!.ending,
      regenerated!.counterPlan!.creativeRisk !== current.counterPlan!.creativeRisk,
    ].filter(Boolean).length
    expect(regenerated!.generatorStyle).not.toBe(current.generatorStyle)
    expect(changedAxes).toBeGreaterThanOrEqual(3)
    expect(regenerated!.collisions.hasBlockingCollision).toBe(false)
    expect(regenerated!.counterQuality!.controlledRisk).toBeGreaterThanOrEqual(72)
  })

  it("異なるseedでも単音候補へ退行しない", () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      const candidates = generateCounterCandidates({ ...input, seed })
      expect(candidates).toHaveLength(10)
      expect(candidates.every((candidate) => candidate.notes.length >= 3)).toBe(true)
    }
  })

  it("Bell Response/String Answerは一直線の音階だけでなくアーチ型(折り返し)の輪郭も生成する", () => {
    // 回帰: bell-response/string-answer/synth-whisperは常にinverseDirection一本の
    // 単調な音階(常に上行 or 常に下行)しか生成できず、折り返しのある輪郭が
    // 一切現れなかった。折り返しを許容してもフレーズ末尾の和声着地は保たれることを
    // 併せて確認する。
    const shapesByStyle: Record<string, Set<string>> = {
      "bell-response": new Set(),
      "string-answer": new Set(),
    }
    for (let seed = 1; seed <= 150; seed++) {
      const candidates = generateCounterCandidates({
        ...input,
        seed,
        poolSize: 40,
        finalCount: 3,
      })
      for (const candidate of candidates) {
        const style = candidate.generatorStyle!
        if (!(style in shapesByStyle)) continue
        const signs = candidate.notes
          .slice(1)
          .map((note, index) => Math.sign(note.pitch - candidate.notes[index].pitch))
        const hasUp = signs.includes(1)
        const hasDown = signs.includes(-1)
        shapesByStyle[style].add(hasUp && hasDown ? "arc" : hasUp ? "up-only" : "down-only")
      }
    }
    expect(shapesByStyle["bell-response"].has("arc")).toBe(true)
    expect(shapesByStyle["string-answer"].has("arc")).toBe(true)
    expect(
      generateCounterCandidates(input).every(
        (candidate) => unresolvedReactiveToneNoteIds(candidate.notes).length === 0,
      ),
    ).toBe(true)
  })

  it("十分な休符がない場合は空候補となり、主旋律へ無理に重ねない", () => {
    const continuous = {
      ...input,
      melody: {
        ...input.melody,
        notes: [note("held", 0, 16, 64)],
      },
    }
    expect(generateCounterCandidates(continuous)).toHaveLength(0)
  })

  it("最高音ではないロングトーンの後半をCounter Windowとして利用する", () => {
    const sustained = {
      ...input,
      melody: {
        ...input.melody,
        notes: [
          note("opening-high", 0, 1, 72),
          note("sustain", 1, 3, 64),
          note("closing-high", 4, 12, 72),
        ],
      },
    }
    const candidates = generateCounterCandidates(sustained)
    expect(candidates.length).toBeGreaterThan(0)
    expect(
      candidates.some((candidate) =>
        candidate.notes.some(
          (counterNote) =>
            counterNote.startBeat >= 1.75 && counterNote.startBeat < 3.75,
        ),
      ),
    ).toBe(true)
    expect(candidates.every((candidate) => candidate.notes.length >= 3)).toBe(true)
  })

  it("主旋律との協和と反行・斜行を持つCounterを高く評価する", () => {
    const lead = [
      note("lead-1", 0, 2, 72),
      note("lead-2", 2, 2, 74),
      note("lead-3", 4, 2, 76),
    ]
    const independent = [
      note("independent-1", 0, 1, 64),
      note("independent-2", 2, 1, 62),
      note("independent-3", 4, 1, 60),
    ]
    const colliding = [
      note("colliding-1", 0, 1, 71),
      note("colliding-2", 2, 1, 73),
      note("colliding-3", 4, 1, 75),
    ]
    const chords = parseChordInputText("C | Dm", "s1", 4, "c")
    expect(
      evaluateCounterpointFit(lead, independent, chords),
    ).toBeGreaterThan(evaluateCounterpointFit(lead, colliding, chords))
  })

  it("コードとActive Melodyを統合解析し、Counterを置く理由とtarget toneを先に計画する", () => {
    const analysis = analyzeCounterContext(
      input.melody.notes,
      input.chords,
      input.totalBeats,
    )
    expect(analysis.harmonicRegions).toHaveLength(4)
    expect(analysis.melodyPhrases.length).toBeGreaterThan(0)
    expect(analysis.opportunities.length).toBeGreaterThan(0)
    expect(analysis.counterNeedScore).toBeGreaterThanOrEqual(60)
    expect(analysis.silenceRecommended).toBe(false)
    expect(
      analysis.opportunities.every(
        (opportunity) =>
          opportunity.rationale.length > 0 &&
          opportunity.targetTonePitchClasses.length > 0,
      ),
    ).toBe(true)

    const candidates = generateCounterCandidates(input)
    expect(candidates.every((candidate) => candidate.counterPlan?.sourceDriven)).toBe(true)
    expect(
      candidates.every(
        (candidate) =>
          candidate.counterPlan!.opportunityKinds.length > 0 &&
          candidate.counterPlan!.targetTonePitchClasses.length > 0 &&
          candidate.counterPlan!.counterNeedScore >= 60,
      ),
    ).toBe(true)
  })

  it("同じメロディでもコード進行が変わればtarget tone pathと生成音が変わる", () => {
    const alternateChords = parseChordInputText(
      "Dm7 | Bbmaj7 | Gm7 | A7",
      "s1",
      4,
      "alternate",
    )
    const original = generateCounterCandidates({
      ...input,
      seed: 711,
      poolSize: 40,
      finalCount: 3,
    })
    const alternate = generateCounterCandidates({
      ...input,
      chords: alternateChords,
      seed: 711,
      poolSize: 40,
      finalCount: 3,
    })
    const targets = (candidates: typeof original) =>
      candidates.map((candidate) => candidate.counterPlan!.targetTonePitchClasses)
    const pitches = (candidates: typeof original) =>
      candidates.map((candidate) => candidate.notes.map((item) => item.pitch))
    expect(targets(alternate)).not.toEqual(targets(original))
    expect(pitches(alternate)).not.toEqual(pitches(original))
  })

  it("同じコードでもメロディのフレーズ構造が変わればOpportunityと応答リズムが変わる", () => {
    const alternateMelody: MelodyVariant = {
      ...input.melody,
      id: "melody-b",
      notes: [
        note("b1", 0, 0.5, 69),
        note("b2", 0.75, 0.5, 71),
        note("b3", 1.5, 2.5, 72),
        note("b4", 4.5, 0.5, 67),
        note("b5", 5.25, 0.5, 65),
        note("b6", 6, 2, 64),
        note("b7", 9, 3, 62),
        note("b8", 13, 2, 64),
      ],
    }
    const originalAnalysis = analyzeCounterContext(
      input.melody.notes,
      input.chords,
      input.totalBeats,
    )
    const alternateAnalysis = analyzeCounterContext(
      alternateMelody.notes,
      input.chords,
      input.totalBeats,
    )
    expect(
      alternateAnalysis.opportunities.map((opportunity) => [
        opportunity.startBeat,
        opportunity.endBeat,
        opportunity.kind,
      ]),
    ).not.toEqual(
      originalAnalysis.opportunities.map((opportunity) => [
        opportunity.startBeat,
        opportunity.endBeat,
        opportunity.kind,
      ]),
    )

    const original = generateCounterCandidates({
      ...input,
      seed: 912,
      poolSize: 40,
      finalCount: 3,
    })
    const alternate = generateCounterCandidates({
      ...input,
      melody: alternateMelody,
      seed: 912,
      poolSize: 40,
      finalCount: 3,
    })
    expect(
      alternate.map((candidate) =>
        candidate.notes.map((item) => item.startBeat),
      ),
    ).not.toEqual(
      original.map((candidate) =>
        candidate.notes.map((item) => item.startBeat),
      ),
    )
  })
})
