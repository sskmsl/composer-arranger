import { describe, expect, it } from "vitest"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { measureMelodyCraft } from "./melodyCraftMetrics"
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
  classical: { label: "古典派の主題", description: "Mozart・Haydn・Beethoven の弦楽四重奏の第1ヴァイオリン冒頭16小節と和音" },
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
})
