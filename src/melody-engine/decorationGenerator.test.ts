import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import {
  assessDecorationNeed,
  DEFAULT_DECORATION_SETTINGS,
  generateDecorationCandidates,
  type GenerateDecorationInput,
} from "./decorationGenerator"
import { unresolvedReactiveToneNoteIds } from "./reactiveLayerAnalysis"

function input(
  patch: Partial<GenerateDecorationInput> = {},
): GenerateDecorationInput {
  return {
    sectionId: "verse",
    sectionRole: "pre-chorus",
    songProfile: "dark-romantic",
    chords: parseChordInputText("Am | F | C | G", "verse", 4, "c"),
    totalBeats: 16,
    beatsPerBar: 4,
    key: "Am",
    seed: 42,
    settings: DEFAULT_DECORATION_SETTINGS,
    previousSectionRole: "verse",
    nextSectionRole: "chorus",
    nextSectionFirstChord: "Cmaj7",
    isLastSection: false,
    ...patch,
  }
}

function hasRoleAppropriateLength(
  candidate: ReturnType<typeof generateDecorationCandidates>[number],
): boolean {
  const role = candidate.decorationPlan?.gestureRole
  const minimum = role === "pedal" ? 1 : role === "swell" ? 2 : 3
  if (role === "response") return candidate.notes.length >= 2
  return candidate.notes.length >= minimum
}

describe("Issue #71 / Structure Driven Decoration Generator", () => {
  it("Active Melodyなしでも品質・多様性選抜した10候補を生成する", () => {
    const candidates = generateDecorationCandidates(input())
    expect(candidates).toHaveLength(10)
    expect(candidates.every((candidate) => candidate.kind === "decoration")).toBe(true)
    expect(candidates.every((candidate) => candidate.targetMelodyVariantId === null)).toBe(true)
    expect(
      new Set(
        candidates.map(
          (candidate) => candidate.decorationPlan?.shape,
        ),
      ).size,
      JSON.stringify(
        candidates.map((candidate) => ({
          role: candidate.decorationPlan?.gestureRole,
          shape: candidate.decorationPlan?.shape,
          rhythm: candidate.decorationPlan?.rhythmStyle,
          quality: candidate.quality,
        })),
      ),
    ).toBeGreaterThanOrEqual(4)
    expect(new Set(candidates.map((candidate) => candidate.decorationPlan?.rhythmStyle)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(candidates.map((candidate) => candidate.decorationPlan?.register)).size).toBeGreaterThanOrEqual(2)
    expect(
      new Set(
        candidates.map((candidate) => candidate.decorationPlan?.gestureRole),
      ).size,
    ).toBeGreaterThanOrEqual(4)
    expect(candidates.every((candidate) => unresolvedReactiveToneNoteIds(candidate.notes).length === 0)).toBe(true)
    expect(candidates.every((candidate) => candidate.quality.overallQuality >= 68)).toBe(true)
    expect(candidates.every((candidate) => candidate.quality.transitionValue >= 78)).toBe(true)
    expect(candidates.every(hasRoleAppropriateLength)).toBe(true)
    expect(
      new Set(
        candidates.map((candidate) =>
          candidate.notes
            .map(
              (note) =>
                `${note.startBeat}:${note.durationBeats}:${note.pitch}:${note.velocity}`,
            )
            .join("|"),
        ),
      ).size,
    ).toBe(candidates.length)
    expect(
      candidates.some((candidate) => {
        if (candidate.notes.length < 3) return false
        const intervals = candidate.notes
          .slice(1)
          .map((note, index) => note.pitch - candidate.notes[index].pitch)
        const direction = Math.sign(intervals[0])
        return (
          direction !== 0 &&
          intervals.every(
            (interval) =>
              Math.sign(interval) === direction &&
              Math.abs(interval) >= 1 &&
              Math.abs(interval) <= 3,
          )
        )
      }),
    ).toBe(true)
    expect(
      candidates.some((candidate) => {
        const intervals = candidate.notes
          .slice(1)
          .map(
            (note, index) =>
              Math.round(
                (note.startBeat - candidate.notes[index].startBeat) * 1000,
              ) / 1000,
          )
        return new Set(intervals).size >= 2
      }),
    ).toBe(true)
  })

  it("Autoは次SectionがあればTransitionを含み、次コードの構成音へ着地する", () => {
    const candidates = generateDecorationCandidates(input())
    const transitions = candidates.filter(
      (candidate) => candidate.decorationPlan?.type === "transition-fill",
    )
    expect(transitions.length).toBeGreaterThan(0)
    for (const candidate of transitions) {
      const last = candidate.notes.at(-1)!
      expect(((last.pitch % 12) + 12) % 12).toBe(candidate.decorationPlan?.targetPitchClass)
      expect(last.startBeat + last.durationBeats).toBeLessThanOrEqual(16.0001)
      expect(last.durationBeats).toBeGreaterThanOrEqual(0.75)
      expect(last.velocity).toBeGreaterThanOrEqual(candidate.notes[0].velocity)
      expect(Math.abs(last.pitch - candidate.notes.at(-2)!.pitch)).toBeLessThanOrEqual(2)
      expect(last.plannedToneRole).toBe("tension-hold")
    }
  })

  it("最終SectionのAutoはEnding Fillとして終止と余韻を作る", () => {
    const candidates = generateDecorationCandidates(
      input({
        sectionRole: "outro",
        nextSectionRole: undefined,
        nextSectionFirstChord: undefined,
        isLastSection: true,
      }),
    )
    expect(candidates.every((candidate) => candidate.decorationPlan?.type === "ending-fill")).toBe(true)
    expect(candidates.every((candidate) => candidate.role === "cadential-fill")).toBe(true)
    expect(
      candidates.every(
        (candidate) => candidate.notes.at(-1)!.durationBeats >= 1,
      ),
      JSON.stringify(
        candidates.map((candidate) => ({
          plan: candidate.decorationPlan,
          notes: candidate.notes.map((note) => [
            note.startBeat,
            note.durationBeats,
            note.pitch,
            note.velocity,
          ]),
        })),
      ),
    ).toBe(true)
    expect(
      candidates.every(
        (candidate) =>
          candidate.notes.at(-1)!.velocity <= candidate.notes[0].velocity,
      ),
    ).toBe(true)
  })

  it("Characterごとに演奏法として自然なShapeとRhythmを組み合わせる", () => {
    const strings = generateDecorationCandidates(
      input({
        settings: {
          ...DEFAULT_DECORATION_SETTINGS,
          character: "strings",
        },
      }),
    )
    expect(
      strings.every(
        (candidate) =>
          candidate.decorationPlan?.rhythmStyle !== "sixteenth" &&
          candidate.decorationPlan?.rhythmStyle !== "staccato",
      ),
    ).toBe(true)

    const bell = generateDecorationCandidates(
      input({
        settings: {
          ...DEFAULT_DECORATION_SETTINGS,
          character: "bell",
        },
      }),
    )
    expect(
      bell.every(
        (candidate) =>
          candidate.decorationPlan?.rhythmStyle !== "legato" &&
          candidate.decorationPlan?.shape !== "arpeggiated-fill",
      ),
    ).toBe(true)
  })

  it("短いMelody GapはResponseだけへ使い、長い色彩とTransitionを1拍へ潰さない", () => {
    const melodyNotes = [
      { id: "m1", startBeat: 0, durationBeats: 3, pitch: 64, velocity: 80, locks: [] },
      { id: "m2", startBeat: 4, durationBeats: 3, pitch: 67, velocity: 80, locks: [] },
      { id: "m3", startBeat: 8, durationBeats: 3, pitch: 69, velocity: 80, locks: [] },
      { id: "m4", startBeat: 12, durationBeats: 3, pitch: 72, velocity: 80, locks: [] },
    ]
    const candidates = generateDecorationCandidates(
      input({
        settings: {
          ...DEFAULT_DECORATION_SETTINGS,
          length: 4,
        },
        melodyNotes,
      }),
    )
    expect(candidates.length).toBeGreaterThan(0)
    const responses = candidates.filter(
      (candidate) =>
        candidate.decorationPlan?.gestureRole === "response",
    )
    const sustained = candidates.filter(
      (candidate) =>
        candidate.decorationPlan?.gestureRole === "pedal" ||
        candidate.decorationPlan?.gestureRole === "swell",
    )
    const directional = candidates.filter(
      (candidate) =>
        candidate.decorationPlan?.gestureRole === "transition" ||
        candidate.decorationPlan?.gestureRole === "pickup",
    )
    expect(responses.length).toBeGreaterThan(0)
    expect(
      responses.every(
        (candidate) =>
          (candidate.decorationPlan?.lengthBeats ?? 4) <= 1 &&
          candidate.notes.length <= 2,
      ),
    ).toBe(true)
    expect(
      sustained.some(
        (candidate) =>
          (candidate.decorationPlan?.lengthBeats ?? 0) >= 4,
      ),
    ).toBe(true)
    expect(
      directional.some(
        (candidate) =>
          (candidate.decorationPlan?.lengthBeats ?? 0) >= 2 &&
          candidate.notes.length >= 3,
      ),
    ).toBe(true)
    expect(
      new Set(
        candidates.map(
          (candidate) => candidate.decorationPlan?.lengthBeats,
        ),
      ).size,
    ).toBeGreaterThanOrEqual(3)
    expect(
      new Set(candidates.map((candidate) => candidate.notes.length))
        .size,
    ).toBeGreaterThanOrEqual(3)
    expect(
      candidates.some(
        (candidate) =>
          candidate.notes.length >= 3 &&
          candidate.notes
            .slice(1)
            .some(
              (note, index) =>
                note.pitch !== candidate.notes[index].pitch,
            ),
      ),
    ).toBe(true)
    expect(
      candidates.every(
        (candidate) => !candidate.collisions.hasBlockingCollision,
      ),
    ).toBe(true)
  })

  it("Active Melodyありでも各batchに異なる聴感Archetypeを維持する", () => {
    const melodyNotes = Array.from({ length: 8 }, (_, index) => ({
      id: `melody-${index}`,
      startBeat: index * 2,
      durationBeats: 1,
      pitch: [64, 67, 69, 72, 71, 69, 67, 64][index],
      velocity: 80,
      locks: [],
    }))
    for (const seed of [1, 42, 2026]) {
      const candidates = generateDecorationCandidates(
        input({ melodyNotes, seed }),
      )
      const audibleSignatures = new Set(
        candidates.map((candidate) => {
          const plan = candidate.decorationPlan!
          const intervals = candidate.notes
            .slice(1)
            .map(
              (note, index) =>
                note.pitch - candidate.notes[index].pitch,
            )
            .join(",")
          const relativeOnsets = candidate.notes
            .map((note) =>
              Number(
                (
                  note.startBeat - plan.placementBeat
                ).toFixed(3),
              ),
            )
            .join(",")
          return [
            plan.gestureRole,
            plan.lengthBeats,
            candidate.notes.length,
            intervals,
            relativeOnsets,
          ].join("|")
        }),
      )
      expect(candidates).toHaveLength(10)
      expect(
        new Set(
          candidates.map(
            (candidate) =>
              candidate.decorationPlan?.gestureRole,
          ),
        ).size,
      ).toBeGreaterThanOrEqual(4)
      expect(
        new Set(
          candidates.map(
            (candidate) =>
              candidate.decorationPlan?.lengthBeats,
          ),
        ).size,
      ).toBeGreaterThanOrEqual(3)
      expect(
        new Set(candidates.map((candidate) => candidate.notes.length))
          .size,
      ).toBeGreaterThanOrEqual(4)
      expect(audibleSignatures.size).toBeGreaterThanOrEqual(8)
      expect(
        candidates.every(
          (candidate) =>
            candidate.quality.overallQuality >= 68 &&
            !candidate.collisions.hasBlockingCollision,
        ),
      ).toBe(true)
    }
  })

  it("楽曲終端でも4種類以上のGesture Roleを維持する", () => {
    const candidates = generateDecorationCandidates(
      input({
        seed: 71,
        isLastSection: true,
      }),
    )

    expect(
      new Set(
        candidates.map(
          (candidate) => candidate.decorationPlan?.gestureRole,
        ),
      ).size,
    ).toBeGreaterThanOrEqual(4)
  })

  it("Type・Character・Length・Density・Direction指定を実音計画へ反映する", () => {
    const candidates = generateDecorationCandidates(
      input({
        settings: {
          type: "decorative-fill",
          character: "bell",
          length: 2,
          density: "sparse",
          direction: "falling",
        },
      }),
    )
    for (const candidate of candidates) {
      expect(candidate.decorationPlan).toMatchObject({
        type: "decorative-fill",
        character: "bell",
        lengthBeats: 2,
        density: "sparse",
        direction: "falling",
        register: "high",
      })
      expect(candidate.notes.length).toBeLessThanOrEqual(3)
    }
  })

  it("同じRandom Seedと構造では候補計画と実音を再現する", () => {
    const signature = () =>
      generateDecorationCandidates(input()).map((candidate) => ({
        plan: candidate.decorationPlan,
        notes: candidate.notes.map((note) => [
          note.startBeat,
          note.durationBeats,
          note.pitch,
          note.velocity,
        ]),
      }))
    expect(signature()).toEqual(signature())
  })

  it("異なるseedでも品質下限を満たす10 Gestureを維持する", () => {
    for (const seed of [1, 42, 2026]) {
      const candidates = generateDecorationCandidates(
        input({ seed }),
      )
      expect(candidates).toHaveLength(10)
      expect(
        candidates.every(
          (candidate) =>
            candidate.quality.overallQuality >= 68 &&
            candidate.quality.transitionValue >= 78 &&
            hasRoleAppropriateLength(candidate),
        ),
      ).toBe(true)
    }
  })

  it("Pre-chorus→ChorusのようにresolveTypeのpoolIndex剰余が重なる場面でも、Auto方向とレジスターが単一値へ潰れない", () => {
    // 回帰: resolveDirection/resolveRegisterがpoolIndex % 3を直接使っていたため、
    // resolveTypeのtransitionWeight=3(pre-chorus→chorus等)ではdecorative-fillが
    // 常に同じ剰余のスロットへ固定され、Auto方向が実質rising/falling固定、
    // decorative-fill(非bell)のレジスターがmiddle固定になっていた。
    const directions = new Set<string>()
    const decorativeRegisters = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const candidates = generateDecorationCandidates(input({ seed }))
      for (const candidate of candidates) {
        directions.add(candidate.decorationPlan!.direction)
        if (
          candidate.decorationPlan!.type === "decorative-fill" &&
          candidate.decorationPlan!.character !== "bell"
        ) {
          decorativeRegisters.add(candidate.decorationPlan!.register)
        }
      }
    }
    expect([...directions].sort()).toEqual(["falling", "mixed", "rising"])
    expect([...decorativeRegisters].sort()).toEqual(["high", "low", "middle"])
  })

  it("Normal設定でも余白のある候補を最低3案含める", () => {
    const candidates = generateDecorationCandidates(input())
    const breathingCandidates = candidates.filter((candidate) => {
      const role = candidate.decorationPlan?.gestureRole
      if (role === "pedal" || role === "swell") return true
      if (candidate.notes.length <= 2) return true
      const gaps = candidate.notes
        .slice(1)
        .map(
          (note, index) =>
            note.startBeat - candidate.notes[index].startBeat,
        )
      return (
        gaps.reduce((sum, gap) => sum + gap, 0) /
          Math.max(1, gaps.length) >=
        0.85
      )
    })
    expect(breathingCandidates.length).toBeGreaterThanOrEqual(3)
    expect(
      new Set(
        candidates.map(
          (candidate) => candidate.decorationPlan?.density,
        ),
      ).size,
    ).toBeGreaterThanOrEqual(2)
    expect(
      candidates.some((candidate) => candidate.notes.length >= 4),
    ).toBe(true)
  })

  it("主旋律と既存Arrangementが高密度ならSilence Gateを優先する", () => {
    const melodyNotes = Array.from({ length: 16 }, (_, index) => ({
      id: `dense-${index}`,
      startBeat: index,
      durationBeats: 1,
      pitch: 60 + (index % 5),
      velocity: 80,
      locks: [],
    }))
    const need = assessDecorationNeed(
      input({
        melodyNotes,
        arrangementContext: {
          previousSectionNoteCount: 48,
          currentSectionNoteCount: 64,
          nextSectionNoteCount: 48,
        },
      }),
    )
    expect(need.level).toBe("silence")
    expect(need.score).toBeLessThan(36)
  })

  it("Pedal・Swell・Pickupを役割に応じた実音へ変換する", () => {
    const candidates = generateDecorationCandidates(input())
    const pedal = candidates.find(
      (candidate) => candidate.decorationPlan?.gestureRole === "pedal",
    )
    const swell = candidates.find(
      (candidate) => candidate.decorationPlan?.gestureRole === "swell",
    )
    const directed = candidates.find((candidate) =>
      ["pickup", "transition", "ending"].includes(
        candidate.decorationPlan?.gestureRole ?? "",
      ),
    )

    expect(pedal?.notes).toHaveLength(1)
    expect(pedal?.notes[0].plannedToneRole).toBe("common-tone")
    expect(pedal?.notes[0].durationBeats).toBeGreaterThanOrEqual(1)
    expect(swell?.notes.length).toBeGreaterThanOrEqual(2)
    expect(swell?.notes.at(-1)!.velocity).toBeGreaterThanOrEqual(
      swell?.notes[0].velocity ?? 0,
    )
    expect((directed?.notes.at(-1)?.pitch ?? -1) % 12).toBe(
      directed?.decorationPlan?.targetPitchClass,
    )
  })

  it("Favorite / Reject履歴を候補スコアへ反映する", () => {
    const candidates = generateDecorationCandidates(
      input({
        preferenceProfile: {
          favoriteCharacters: ["piano"],
          favoriteShapes: ["turn"],
          favoriteRhythms: ["syncopation"],
          rejectedCharacters: ["bell"],
          rejectedShapes: ["sparse-accent"],
          rejectedRhythms: ["staccato"],
        },
      }),
    )
    const favoriteAligned = candidates.filter(
      (candidate) =>
        candidate.decorationPlan?.character === "piano" ||
        candidate.decorationPlan?.shape === "turn" ||
        candidate.decorationPlan?.rhythmStyle === "syncopation",
    )
    expect(favoriteAligned.length).toBeGreaterThan(0)
    expect(
      Math.max(
        ...favoriteAligned.map(
          (candidate) => candidate.decorationPlan?.preferenceMatch ?? 0,
        ),
      ),
    ).toBeGreaterThan(50)
    expect(
      candidates.every(
        (candidate) =>
          (candidate.decorationPlan?.preferenceMatch ?? 50) >= 50,
      ),
    ).toBe(true)
  })
})
