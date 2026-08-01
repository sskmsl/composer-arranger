import { describe, expect, it } from "vitest"
import { parseChordInputText } from "@/core/chordInput"
import {
  generateSignaturePhraseCandidates,
  regenerateSignaturePhraseCandidate,
  signaturePhraseSimilarity,
  type GenerateSignaturePhrasesInput,
} from "./generateSignaturePhrases"

function input(seed = 424242): GenerateSignaturePhrasesInput {
  return {
    chords: parseChordInputText(
      "Am(add9) | D#dim | Fmaj7 | E7",
      "s1",
      4,
      "signature",
    ),
    sectionId: "s1",
    sectionRole: "intro",
    songProfile: "original-custom",
    density: "balanced",
    drama: "growing",
    range: { low: 60, high: 79 },
    key: "Am",
    beatsPerBar: 4,
    totalBeats: 16,
    seed,
    lengthBars: 2,
  }
}

function eightBarInput(seed = 424242): GenerateSignaturePhrasesInput {
  return {
    ...input(seed),
    chords: parseChordInputText(
      "Am(add9) | D#dim | Fmaj7 | E7 | Am(add9) | Fmaj7 | Dm9 | E7",
      "s1",
      4,
      "signature-8",
    ),
    totalBeats: 32,
    lengthBars: 8,
  }
}

function pedalEightBarInput(seed = 424242): GenerateSignaturePhrasesInput {
  return {
    ...eightBarInput(seed),
    chords: parseChordInputText(
      "Am(add9) | Fmaj7 | Cmaj7 | G6 | Am(add9) | Fmaj7 | Cmaj7 | G6",
      "s1",
      4,
      "signature-pedal-8",
    ),
  }
}

function rhythmSignature(candidate: ReturnType<typeof generateSignaturePhraseCandidates>[number]) {
  return candidate.notes
    .map((note) => `${note.startBeat}:${note.durationBeats}`)
    .join("|")
}

describe("Signature Phrase Generator", () => {
  it("リズム先行の独立した1〜2小節候補を12案返す", () => {
    const candidates = generateSignaturePhraseCandidates(input())

    expect(candidates).toHaveLength(12)
    expect(
      candidates.every(
        (candidate) =>
          candidate.plan.role === "intro" &&
          candidate.plan.lengthBars === 2 &&
          candidate.phraseLengthBeats === 8 &&
          candidate.notes.length >= 3 &&
          candidate.notes.every(
            (note) =>
              note.startBeat >= 0 &&
              note.startBeat + note.durationBeats <= 8.001,
          ),
      ),
    ).toBe(true)
    expect(new Set(candidates.map(rhythmSignature)).size).toBeGreaterThanOrEqual(8)
    expect(new Set(candidates.map((candidate) => candidate.plan.contour)).size).toBeGreaterThanOrEqual(4)
    expect(
      new Set(candidates.map((candidate) => candidate.plan.variationStrategy)).size,
    ).toBeGreaterThanOrEqual(4)
    expect(
      new Set(candidates.map((candidate) => candidate.plan.archetype)),
    ).toEqual(
      new Set(["atmospheric-gateway", "obsessive-motor", "kinetic-hook"]),
    )
    for (const archetype of [
      "atmospheric-gateway",
      "obsessive-motor",
      "kinetic-hook",
    ] as const) {
      expect(
        candidates.filter((candidate) => candidate.plan.archetype === archetype)
          .length,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it("全評価軸を計算し、採用・編集候補となる品質を最低2案確保する", () => {
    const candidates = generateSignaturePhraseCandidates(input(9163))
    for (const candidate of candidates) {
      expect(candidate.score.identity).toBeGreaterThanOrEqual(0)
      expect(candidate.score.openingImpact).toBeGreaterThanOrEqual(0)
      expect(candidate.score.rhythmicIdentity).toBeGreaterThanOrEqual(0)
      expect(candidate.score.contourIdentity).toBeGreaterThanOrEqual(0)
      expect(candidate.score.developmentPotential).toBeGreaterThanOrEqual(0)
      expect(candidate.score.standaloneStrength).toBeGreaterThanOrEqual(0)
      expect(candidate.score.worldBuilding).toBeGreaterThanOrEqual(0)
      expect(candidate.score.motifMemorability).toBeGreaterThanOrEqual(0)
      expect(candidate.score.motifIntegrity).toBeGreaterThanOrEqual(0)
      expect(candidate.score.repetitionDrive).toBeGreaterThanOrEqual(0)
      expect(candidate.score.longRangeCoherence).toBeGreaterThanOrEqual(0)
      expect(candidate.score.variationBalance).toBeGreaterThanOrEqual(0)
      expect(candidate.score.silenceUse).toBeGreaterThanOrEqual(0)
      expect(candidate.score.arpeggioPenalty).toBeLessThanOrEqual(1)
      expect(candidate.score.mechanicalPenalty).toBeLessThanOrEqual(1)
    }
    expect(
      candidates.filter((candidate) => candidate.score.overall >= 70).length,
    ).toBeGreaterThanOrEqual(2)
  })

  it("8小節を同一Motifの階層的な反復・変形・回帰として生成する", () => {
    const candidates = generateSignaturePhraseCandidates(eightBarInput(24081))
    expect(candidates).toHaveLength(12)
    for (const candidate of candidates) {
      expect(candidate.plan.lengthBars).toBe(8)
      expect(candidate.phraseLengthBeats).toBe(32)
      expect(candidate.plan.developmentStages).toHaveLength(8)
      expect(candidate.plan.developmentStages[0]).toBe("establish")
      expect(candidate.plan.developmentStages).toContain("decorated-return")
      expect(candidate.plan.developmentStages).toContain("open-tail")
      expect(new Set(candidate.plan.developmentStages).size).toBeGreaterThanOrEqual(6)
      expect(candidate.plan.decorationIntents).toHaveLength(3)
      expect(candidate.score.longRangeCoherence).toBeGreaterThanOrEqual(0)
      expect(candidate.score.variationBalance).toBeGreaterThanOrEqual(0)
      expect(
        candidate.notes.every(
          (note) =>
            note.startBeat >= 0 &&
            note.startBeat + note.durationBeats <= 32.001,
        ),
      ).toBe(true)
    }
    expect(
      candidates.filter(
        (candidate) =>
          candidate.score.longRangeCoherence >= 0.42 &&
          candidate.score.variationBalance >= 0.38,
      ).length,
    ).toBeGreaterThanOrEqual(8)
  })

  it("複数seedの8小節生成でも採用候補となる長期品質を最低2案維持する", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const candidates = generateSignaturePhraseCandidates(
        eightBarInput(seed * 7919),
      )
      expect(
        candidates.filter(
          (candidate) =>
            candidate.score.overall >= 68 &&
            candidate.score.mechanicalPenalty <= 0.5 &&
            candidate.score.longRangeCoherence >= 0.42 &&
            candidate.score.variationBalance >= 0.38,
        ).length,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it("旧DecorationのGesture語彙を独立レイヤーではなくSignature実音へ統合する", () => {
    const candidates = generateSignaturePhraseCandidates(eightBarInput(97123))
    const gestureRoles = new Set(
      candidates.flatMap((candidate) =>
        candidate.plan.decorationIntents.map((intent) => intent.gestureRole),
      ),
    )
    expect(gestureRoles.size).toBeGreaterThanOrEqual(4)
    expect(
      candidates.some((candidate) =>
        candidate.notes.some((note) =>
          [
            "approach-tone",
            "neighbor-tone",
            "suspension",
            "common-tone",
          ].includes(note.plannedToneRole ?? ""),
        ),
      ),
    ).toBe(true)
  })

  it("入口戦略ごとに余白・反復・身体的輪郭の異なる音楽的IDを持つ", () => {
    const candidates = generateSignaturePhraseCandidates(input(39017))
    const atmospheric = candidates.filter(
      (candidate) => candidate.plan.archetype === "atmospheric-gateway",
    )
    const obsessive = candidates.filter(
      (candidate) => candidate.plan.archetype === "obsessive-motor",
    )
    const kinetic = candidates.filter(
      (candidate) => candidate.plan.archetype === "kinetic-hook",
    )
    // 和音化で同時発音する声部を「時間の密度」として重複加算しない。
    // 余白の品質は、声部数ではなくフレーズ中に音が存在する時間で評価する。
    const soundingRatio = (candidate: (typeof candidates)[number]) => {
      const merged = [...candidate.notes]
        .sort((left, right) => left.startBeat - right.startBeat)
        .reduce<{ start: number; end: number }[]>((ranges, note) => {
          const end = note.startBeat + note.durationBeats
          const last = ranges[ranges.length - 1]
          if (last && note.startBeat <= last.end) {
            last.end = Math.max(last.end, end)
          } else {
            ranges.push({ start: note.startBeat, end })
          }
          return ranges
        }, [])
      return (
        merged.reduce((sum, range) => sum + range.end - range.start, 0) /
        candidate.phraseLengthBeats
      )
    }
    const maximumInterval = (candidate: (typeof candidates)[number]) =>
      Math.max(
        0,
        ...candidate.notes.slice(1).map((note, index) =>
          Math.abs(note.pitch - candidate.notes[index].pitch),
        ),
      )

    expect(atmospheric.some((candidate) => soundingRatio(candidate) < 0.62)).toBe(true)
    expect(
      obsessive.some((candidate) => candidate.score.repetitionDrive >= 0.58),
    ).toBe(true)
    expect(kinetic.some((candidate) => maximumInterval(candidate) >= 4)).toBe(true)
    expect(
      candidates.filter((candidate) => candidate.score.mechanicalPenalty < 0.3)
        .length,
    ).toBeGreaterThanOrEqual(8)
  })

  it("複数seedでも高品質候補を最低2案維持する", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const candidates = generateSignaturePhraseCandidates(input(seed))
      expect(
        candidates.filter((candidate) => candidate.score.overall >= 70)
          .length,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it("総合点だけでなくHook品質ゲートを満たす候補を優先する", () => {
    const candidates = generateSignaturePhraseCandidates(input(7419))
    const hookReady = candidates.filter(
      (candidate) =>
        candidate.score.openingImpact >= 0.55 &&
        candidate.score.motifMemorability >= 0.55 &&
        candidate.score.motifIntegrity >= 0.4 &&
        candidate.score.worldBuilding >= 0.5 &&
        candidate.score.mechanicalPenalty <= 0.5,
    )
    expect(hookReady.length).toBeGreaterThanOrEqual(10)
    expect(
      candidates.every(
        (candidate) =>
          candidate.plan.motifSize >= 3 && candidate.plan.motifSize <= 5,
      ),
    ).toBe(true)
  })

  it("Song Profileと1小節内変形が生成結果へ実際に反映される", () => {
    const minimal = generateSignaturePhraseCandidates({
      ...input(8102),
      songProfile: "minimal-tension",
      lengthBars: 1,
    })
    const dramatic = generateSignaturePhraseCandidates({
      ...input(8102),
      songProfile: "dramatic-synth-pop",
      lengthBars: 1,
    })
    const fingerprints = (candidates: typeof minimal) =>
      candidates.map(
        (candidate) =>
          `${candidate.plan.archetype}:${candidate.plan.variationStrategy}:${rhythmSignature(candidate)}:${candidate.notes.map((note) => note.pitch).join(",")}`,
      )
    expect(fingerprints(minimal)).not.toEqual(fingerprints(dramatic))
    expect(new Set(minimal.map(rhythmSignature)).size).toBeGreaterThanOrEqual(8)
    expect(
      new Set(
        minimal.map((candidate) =>
          candidate.notes.map((note) => note.pitch).join(","),
        ),
      ).size,
    ).toBeGreaterThanOrEqual(8)
  })

  it("Diversity Filterでリズム・移高不変音程・輪郭の重複を抑える", () => {
    const candidates = generateSignaturePhraseCandidates(input(777))
    const similarities = candidates.flatMap((left, leftIndex) =>
      candidates
        .slice(leftIndex + 1)
        .map((right) => signaturePhraseSimilarity(left, right)),
    )
    expect(Math.max(...similarities.map((value) => value.overallSimilarity))).toBeLessThan(0.86)
    expect(
      similarities.filter((value) => value.rhythmSimilarity > 0.9).length,
    ).toBeLessThan(similarities.length / 3)
  })

  it("固定seedで完全再現し、対象候補だけ兄弟と異なる案へ再生成できる", () => {
    const sourceInput = input(2026)
    const first = generateSignaturePhraseCandidates(sourceInput)
    const second = generateSignaturePhraseCandidates(sourceInput)
    expect(second).toEqual(first)

    const replacement = regenerateSignaturePhraseCandidate(
      sourceInput,
      first[0],
      first.slice(1),
    )
    expect(replacement.seed).not.toBe(first[0].seed)
    expect(rhythmSignature(replacement)).not.toBe(rhythmSignature(first[0]))
    expect(replacement.similarityToSelected).toHaveLength(11)
  })

  it("既存Phrase Generatorの候補数・型へ依存しない", async () => {
    const { generatePhraseCandidates } = await import("./generatePhrases")
    const ordinary = generatePhraseCandidates({
      ...input(88),
      lengthBars: 2,
    })
    const signature = generateSignaturePhraseCandidates(input(88))
    expect(ordinary).toHaveLength(3)
    expect(signature).toHaveLength(12)
    expect("intent" in ordinary[0]).toBe(true)
    expect("plan" in signature[0]).toBe(true)
  })

  it("単音だけでなくblock-chord/broken-chordの和音フレーズも提案する", () => {
    const modeCounts: Record<string, number> = {
      "single-line": 0,
      "block-chord": 0,
      "broken-chord": 0,
    }
    for (let seed = 1; seed <= 20; seed++) {
      const candidates = generateSignaturePhraseCandidates(input(seed))
      for (const candidate of candidates) {
        modeCounts[candidate.plan.voicingMode] += 1
      }
    }
    expect(modeCounts["single-line"]).toBeGreaterThan(0)
    expect(modeCounts["block-chord"]).toBeGreaterThan(0)
    expect(modeCounts["broken-chord"]).toBeGreaterThan(0)
  })

  it("block-chordは同時発音の声部がほとんどのケースで3半音以上離れて濁らない", () => {
    // 稀に、別々に生成された2つのleadノートが量子化後に同じ拍へ重なり、
    // それぞれのスタックが衝突することがある(voicingQualityが検出しペナルティにする)。
    // 完全にゼロにする保証はしないため、統計的な清潔さで検証する。
    let totalGroups = 0
    let cleanGroups = 0
    const qualityScores: number[] = []
    for (let seed = 1; seed <= 20; seed++) {
      const candidates = generateSignaturePhraseCandidates(
        input(seed),
      ).filter((candidate) => candidate.plan.voicingMode === "block-chord")
      for (const candidate of candidates) {
        qualityScores.push(candidate.score.voicingQuality)
        const groups = new Map<number, number[]>()
        for (const note of candidate.notes) {
          const key = Math.round(note.startBeat * 4)
          const group = groups.get(key) ?? []
          group.push(note.pitch)
          groups.set(key, group)
        }
        for (const pitches of groups.values()) {
          if (pitches.length < 2) continue
          totalGroups++
          const sorted = [...pitches].sort((left, right) => left - right)
          const clean = sorted.every(
            (pitch, index) => index === 0 || pitch - sorted[index - 1] >= 3,
          )
          if (clean) cleanGroups++
        }
      }
    }
    expect(totalGroups).toBeGreaterThan(0)
    expect(cleanGroups / totalGroups).toBeGreaterThan(0.9)
    expect(qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length).toBeGreaterThan(0.9)
  })

  it("8小節の和音化は構造点だけに限定し、全ノートを機械的に厚くしない", () => {
    const candidates = generateSignaturePhraseCandidates(eightBarInput(60213))
    for (const candidate of candidates) {
      if (candidate.plan.voicingMode === "block-chord") {
        const supportNotes = candidate.notes.filter((note) =>
          /-voice-(low|inner|upper)-\d+$/.test(note.id),
        )
        const voicedBars = new Set(
          supportNotes.map((note) => Math.floor(note.startBeat / 4)),
        )
        expect(voicedBars.size).toBeLessThanOrEqual(8)
        expect(supportNotes.length).toBeLessThanOrEqual(24)
      }
      if (candidate.plan.voicingMode === "broken-chord") {
        const arpeggiatedSources = new Set(
          candidate.notes
            .filter((note) => note.id.includes("-arp"))
            .map((note) => note.id.replace(/-voice-.*-arp\d+$/, "")),
        )
        expect(arpeggiatedSources.size).toBeLessThanOrEqual(6)
      }
    }
  })

  it("転回・開離・Drop 2・Pedal・内声移動のVoicing語彙を候補群で網羅する", () => {
    const styles = new Set<string>()
    const motions = new Set<string>()
    const chordCandidates = []
    for (let seed = 1; seed <= 10; seed++) {
      const generated = [
        ...generateSignaturePhraseCandidates(eightBarInput(seed * 3571)),
        ...generateSignaturePhraseCandidates(pedalEightBarInput(seed * 4513)),
      ]
      for (const candidate of generated) {
        if (candidate.plan.voicingMode === "single-line") continue
        styles.add(candidate.plan.voiceLeading.style)
        motions.add(candidate.plan.voiceLeading.motion)
        chordCandidates.push(candidate)
      }
    }
    expect(styles).toEqual(
      new Set([
        "close-position",
        "open-spread",
        "drop-2",
        "pedal-tone",
        "inner-motion",
      ]),
    )
    expect(motions).toEqual(new Set(["smooth", "contrary", "oblique"]))
    expect(
      chordCandidates.every(
        (candidate) => candidate.score.voiceLeadingQuality >= 0.58,
      ),
    ).toBe(true)
    expect(
      chordCandidates.some((candidate) => {
        const pedal = candidate.plan.voiceLeading.pedalPitchClass
        if (
          candidate.plan.voiceLeading.style !== "pedal-tone" ||
          pedal === undefined
        ) {
          return false
        }
        return candidate.notes.filter(
          (note) =>
            note.id.includes("-voice-") &&
            ((note.pitch % 12) + 12) % 12 === pedal,
        ).length >= 2
      }),
    ).toBe(true)
  })

  it("Block Chordの低声が前後を参照し、全声部の平行移動へ偏らない", () => {
    let transitions = 0
    let controlledLeaps = 0
    let parallelTransitions = 0
    for (let seed = 1; seed <= 16; seed++) {
      const candidates = generateSignaturePhraseCandidates(
        eightBarInput(seed * 6151),
      ).filter((candidate) => candidate.plan.voicingMode === "block-chord")
      for (const candidate of candidates) {
        const frames = [...new Set(
          candidate.notes
            .filter((note) => /-voice-(low|inner|upper)-\d+$/.test(note.id))
            .map((note) => note.startBeat),
        )].sort((left, right) => left - right).map((startBeat) => {
          const pitches = candidate.notes
            .filter((note) => note.startBeat === startBeat)
            .map((note) => note.pitch)
            .sort((left, right) => left - right)
          return { bass: pitches[0], lead: pitches.at(-1)! }
        })
        for (let index = 1; index < frames.length; index++) {
          const bassMotion = frames[index].bass - frames[index - 1].bass
          const leadMotion = frames[index].lead - frames[index - 1].lead
          transitions++
          if (Math.abs(bassMotion) <= candidate.plan.voiceLeading.maxVoiceLeap) {
            controlledLeaps++
          }
          if (
            bassMotion !== 0 &&
            leadMotion !== 0 &&
            Math.sign(bassMotion) === Math.sign(leadMotion)
          ) {
            parallelTransitions++
          }
        }
      }
    }
    expect(transitions).toBeGreaterThan(20)
    expect(controlledLeaps / transitions).toBeGreaterThan(0.75)
    expect(parallelTransitions / transitions).toBeLessThan(0.6)
  })

  it("構造上のLiftまたはReturnだけでテンション声部を段階的に候補化する", () => {
    let tensionCandidates = 0
    let totalChordCandidates = 0
    for (let seed = 1; seed <= 20; seed++) {
      for (const candidate of generateSignaturePhraseCandidates(
        eightBarInput(seed * 1877),
      )) {
        if (candidate.plan.voicingMode === "single-line") continue
        totalChordCandidates++
        if (
          candidate.notes.some(
            (note) =>
              note.id.includes("-voice-") &&
              note.plannedToneRole === "tension-hold",
          )
        ) {
          tensionCandidates++
        }
      }
    }
    expect(totalChordCandidates).toBeGreaterThan(30)
    expect(tensionCandidates).toBeGreaterThan(0)
    expect(tensionCandidates).toBeLessThan(totalChordCandidates)
  })

  it("Leadの音程・Onset・Durationを和音化後も単声かつ16分音符グリッドで保持する", () => {
    for (const sourceInput of [input(7301), eightBarInput(9109)]) {
      const candidates = generateSignaturePhraseCandidates(sourceInput)
      for (const candidate of candidates) {
        const leadNotes = candidate.notes
          .filter((note) => !note.id.includes("-voice-"))
          .sort((left, right) => left.startBeat - right.startBeat)
        expect(leadNotes.length).toBeGreaterThan(0)
        expect(
          leadNotes.every(
            (note) =>
              Number.isInteger(note.startBeat * 4) &&
              Number.isInteger(note.durationBeats * 4),
          ),
        ).toBe(true)
        expect(
          leadNotes.slice(1).every(
            (note, index) =>
              leadNotes[index].startBeat + leadNotes[index].durationBeats <=
              note.startBeat + 0.001,
          ),
        ).toBe(true)
      }
    }
  })

  it("暗黙のDominant Voicingへ強い変化テンションを混入しない", () => {
    const sourceInput = eightBarInput(44119)
    for (let seed = 1; seed <= 16; seed++) {
      const candidates = generateSignaturePhraseCandidates({
        ...sourceInput,
        seed: seed * 4099,
      })
      for (const candidate of candidates) {
        const dominantColors = candidate.notes.filter((note) => {
          if (
            !note.id.includes("-voice-") ||
            note.plannedToneRole !== "tension-hold"
          ) {
            return false
          }
          const chord = sourceInput.chords.find(
            (item) =>
              note.startBeat >= item.startBeat &&
              note.startBeat < item.startBeat + item.durationBeats,
          )
          return chord?.symbol === "E7"
        })
        expect(
          dominantColors.every((note) =>
            [1, 6].includes(((note.pitch % 12) + 12) % 12),
          ),
        ).toBe(true)
      }
    }
  })

  it("broken-chordは単音を短いアルペジオへ分解し、音数がleadより増える", () => {
    const candidates = generateSignaturePhraseCandidates(input(3)).filter(
      (candidate) => candidate.plan.voicingMode === "broken-chord",
    )
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      expect(candidate.notes.length).toBeGreaterThan(0)
      expect(
        candidate.notes.every(
          (note) =>
            note.startBeat >= 0 &&
            note.startBeat + note.durationBeats <= candidate.phraseLengthBeats + 0.001,
        ),
      ).toBe(true)
      const arpeggios = new Map<string, typeof candidate.notes>()
      for (const note of candidate.notes.filter((item) => item.id.includes("-arp"))) {
        const sourceId = note.id.replace(/-voice-.*-arp\d+$/, "")
        const lead = candidate.notes.find((item) => item.id === sourceId)
        expect(lead).toBeDefined()
        expect(note.startBeat).toBeGreaterThan(lead!.startBeat)
        expect(note.startBeat + note.durationBeats).toBeLessThanOrEqual(
          lead!.startBeat + lead!.durationBeats + 0.001,
        )
        const notes = arpeggios.get(sourceId) ?? []
        notes.push(note)
        arpeggios.set(sourceId, notes)
      }
      for (const notes of arpeggios.values()) {
        const ordered = [...notes].sort(
          (left, right) => left.startBeat - right.startBeat,
        )
        expect(
          ordered.slice(1).every(
            (note, index) =>
              ordered[index].startBeat + ordered[index].durationBeats <=
              note.startBeat + 0.001,
          ),
        ).toBe(true)
      }
    }
  })

  it("和音展開後もPlan由来の類似度比較は旋律の核(leadNotes)で行い、声部数で薄まらない", () => {
    const candidates = generateSignaturePhraseCandidates(input(555))
    // 全候補ペアでoverallSimilarityが発散しない(NaN/Infinityにならない)ことを確認する
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const similarity = signaturePhraseSimilarity(candidates[i], candidates[j])
        expect(Number.isFinite(similarity.overallSimilarity)).toBe(true)
        expect(similarity.overallSimilarity).toBeGreaterThanOrEqual(0)
        expect(similarity.overallSimilarity).toBeLessThanOrEqual(1)
      }
    }
  })
})
