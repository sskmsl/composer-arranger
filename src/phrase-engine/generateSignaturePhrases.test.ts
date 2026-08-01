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
      expect(candidate.score.arpeggioPenalty).toBeLessThanOrEqual(1)
    }
    expect(
      candidates.filter((candidate) => candidate.score.overall >= 70).length,
    ).toBeGreaterThanOrEqual(2)
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
      first[0].seed,
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
})
