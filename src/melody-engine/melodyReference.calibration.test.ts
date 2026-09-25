import { describe, expect, it } from "vitest"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { measureMelodyCraft, type MelodyCraftMetrics } from "./melodyCraftMetrics"
import {
  buildFeatureModel,
  CLASSICAL_FEATURES,
  classicalFeatureValues,
  rawClassicalTypicality,
  weightedMedian,
  type ClassicalFeatureKey,
  type ClassicalModel,
} from "./classicalLikeness"
import {
  distributionOf,
  referenceMetricValues,
  referenceUnitToMelody,
  type MelodyReferenceStats,
  type ReferenceMetricKey,
  type ReferenceUnit,
} from "./melodyReference"

/**
 * 実在曲の物差しを集計して src/melody-engine/reference/melodyReferenceStats.json を作る。
 * 楽譜の取り出し(Python)が要るので、ふだんのテストでは何もしない。
 *   python3 tools/melody-reference/extract_corpus.py reference-data/melody-corpus
 *   MELODY_REFERENCE_DIR=reference-data/melody-corpus npx vitest run src/melody-engine/melodyReference.calibration.test.ts
 */
const CORPORA: Record<string, { label: string; description: string }> = {
  bach: { label: "Bach のコラール", description: "ソプラノの旋律と、4声から求めた拍ごとの和音(ベース付き)" },
  essen: { label: "Essen 民謡集", description: "ドイツ語圏を中心とした民謡の旋律(4/4・2/4、和音なし)" },
  classical: { label: "古典派・ロマン派", description: "Mozart・Haydn・Beethoven・Schumann ほかの最上声部と和音(1曲あたり最初の96小節まで)" },
}

const directory = process.env.MELODY_REFERENCE_DIR

describe.skipIf(!directory)("実在曲の物差しを集計する", () => {
  it("集計して書き出す", () => {
    const stats: MelodyReferenceStats = {
      source: "music21 10.5.0 同梱コーパス(パブリックドメイン)",
      unitBeats: 32,
      corpora: {},
    }
    for (const [name, meta] of Object.entries(CORPORA)) {
      const file = join(directory!, `${name}.jsonl`)
      if (!existsSync(file)) continue
      const units = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ReferenceUnit)
      const collected: Partial<Record<ReferenceMetricKey, number[]>> = {}
      for (const unit of units) {
        const { notes, chords } = referenceUnitToMelody(unit)
        const metrics = measureMelodyCraft(notes, chords, unit.key)
        const values = referenceMetricValues(metrics, { hasChords: chords.length > 0, final: unit.final, totalBeats: unit.totalBeats })
        for (const [key, value] of Object.entries(values) as [ReferenceMetricKey, number][]) {
          if (Number.isFinite(value)) (collected[key] ??= []).push(value)
        }
      }
      stats.corpora[name] = {
        ...meta,
        pieces: new Set(units.map((unit) => unit.piece)).size,
        units: units.length,
        metrics: Object.fromEntries(Object.entries(collected).map(([key, values]) => [key, distributionOf(values!)])),
      }
    }
    writeFileSync(join(__dirname, "reference", "melodyReferenceStats.json"), JSON.stringify(stats, null, 2) + "\n")
    expect(Object.keys(stats.corpora).length).toBeGreaterThan(0)
  })

  it("古典らしさの物差しを作って書き出す(古典=100)", () => {
    // 古典 = Bach のコラールと、古典派・ロマン派の最上声部。2つの曲集は同じ重みにする
    const groups = ["bach", "classical"]
    const measured: Array<{ group: string; piece: string; metrics: MelodyCraftMetrics }> = []
    for (const group of groups) {
      const units = readFileSync(join(directory!, `${group}.jsonl`), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ReferenceUnit)
      for (const unit of units) {
        const { notes, chords } = referenceUnitToMelody(unit)
        if (chords.length === 0) continue
        measured.push({ group, piece: unit.piece, metrics: measureMelodyCraft(notes, chords, unit.key) })
      }
    }
    // 曲ごとに 5 つに 1 つを「学習に使わない」組にする(同じ曲の単位は同じ組に入れる)
    const holdoutPiece = (piece: string) => [...piece].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7) % 5 === 0
    const weightOf = (list: typeof measured) => {
      const counts = new Map<string, number>()
      for (const item of list) counts.set(item.group, (counts.get(item.group) ?? 0) + 1)
      return (item: (typeof measured)[number]) => 0.5 / (counts.get(item.group) ?? 1)
    }
    const fit = measured.filter((item) => !holdoutPiece(item.piece))
    const holdout = measured.filter((item) => holdoutPiece(item.piece))
    const fitWeight = weightOf(fit)
    const holdoutWeight = weightOf(holdout)
    const features = Object.fromEntries(CLASSICAL_FEATURES.map((feature) => [
      feature.key,
      buildFeatureModel(fit.map((item) => ({ value: classicalFeatureValues(item.metrics)[feature.key], weight: fitWeight(item) })), feature),
    ])) as ClassicalModel["features"]
    const draft: ClassicalModel = {
      source: "music21 10.5.0 同梱コーパス(パブリックドメイン): Bach のコラール、古典派・ロマン派の最上声部",
      corpora: groups,
      units: { fit: fit.length, holdout: holdout.length },
      features,
      normalization: 1,
      holdout: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
    }
    const holdoutRaw = holdout.map((item) => ({ value: rawClassicalTypicality(classicalFeatureValues(item.metrics), draft).raw, weight: holdoutWeight(item) }))
    draft.normalization = weightedMedian(holdoutRaw)
    const scores = holdoutRaw.map((item) => ({ value: Math.min(100, (item.value / draft.normalization) * 100), weight: item.weight }))
    const round = (value: number) => Math.round(value * 10) / 10
    draft.holdout = {
      p10: round(weightedMedian(scores, 0.1)),
      p25: round(weightedMedian(scores, 0.25)),
      p50: round(weightedMedian(scores, 0.5)),
      p75: round(weightedMedian(scores, 0.75)),
      p90: round(weightedMedian(scores, 0.9)),
    }
    const compact = {
      ...draft,
      normalization: Math.round(draft.normalization * 1e6) / 1e6,
      features: Object.fromEntries(Object.entries(draft.features).map(([key, model]) => [key, {
        ...model,
        low: Math.round(model.low * 1e4) / 1e4,
        high: Math.round(model.high * 1e4) / 1e4,
        density: model.density.map((value) => Math.round(value * 1e4) / 1e4),
        reference: Math.round(model.reference * 1e4) / 1e4,
        median: Math.round(model.median * 1e4) / 1e4,
      }])) as Record<ClassicalFeatureKey, ClassicalModel["features"][ClassicalFeatureKey]>,
    }
    writeFileSync(join(__dirname, "reference", "classicalModel.json"), JSON.stringify(compact) + "\n")
    expect(draft.holdout.p50).toBeCloseTo(100, 0)
  })
})
