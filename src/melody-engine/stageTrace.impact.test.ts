import { expect, it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordInputText } from "@/core/chordInput"
import type { SectionRole } from "@/core/section"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { candidatePath, traceStages, type CandidateStage, type StageNote } from "./stageTrace"

/**
 * 物語付けの「頂点の希少化」(narrative:peakRarity)が、核の音をどれだけ動かし、大きな跳躍をどれだけ新しく作るかの記録
 * (記録専用。生成・採点・閾値は変えない。docs/rhythm-memory-controls.md の「影響範囲の記録」)。
 *
 * 条件と定義は結果を見る前に固定した:
 *   - 条件: 開発用の比較(developmentPrinciples.comparison.test.ts)と同じ4進行 × seed 101・202・303 × Aメロ・サビ
 *     × 8・16小節 × 標準・映画的。核のある最終候補すべて
 *   - 大きな跳躍: 隣り合う音の音程が 8 半音以上
 *   - 短い音での大きな移動: 前の音の長さが 0.5 拍以下で、音程が 7 半音以上
 *   - 「新しく作った」: 同じ2音(id)が、その段階の前には隣り合っていないか、音程がしきい値未満だった
 *   - 音が動いたことを悪化とは数えない
 * IMPACT_OUT を指定すると、集計を JSON で書き出す。
 */
const SONGS = [
  { key: "C", chords: "F | G | Em | Am | Dm | G | C | C" },
  { key: "Am", chords: "Am | F | G | E7 | Am | F | E7 | Am" },
  { key: "G", chords: "G | D/F# | Em | C | Am | D | G | G" },
  { key: "Dm", chords: "Dm | Bb | F | C | Gm | Bb | A7 | Dm" },
]
const SEEDS = [101, 202, 303]
const ROLES: SectionRole[] = ["verse", "chorus"]
const BIG_LEAP = 8
const SHORT_NOTE = .5
const SHORT_MOVE = 7

type Pair = { first: StageNote; second: StageNote; interval: number }
const pairsOf = (notes: readonly StageNote[]): Pair[] => {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  return sorted.slice(1).map((second, index) => ({ first: sorted[index], second, interval: second.pitch - sorted[index].pitch }))
}
const isBigLeap = (pair: Pair) => Math.abs(pair.interval) >= BIG_LEAP
const isShortMove = (pair: Pair) => pair.first.durationBeats <= SHORT_NOTE + 1e-6 && Math.abs(pair.interval) >= SHORT_MOVE
const key = (pair: Pair) => `${pair.first.id}>${pair.second.id}`

/** after で条件を満たす組のうち、before では同じ2音が隣り合っていないか、条件を満たしていなかったもの */
function newlyCreated(before: readonly StageNote[], after: readonly StageNote[], test: (pair: Pair) => boolean): Pair[] {
  const earlier = new Map(pairsOf(before).map((pair) => [key(pair), pair]))
  return pairsOf(after).filter((pair) => test(pair) && !(earlier.has(key(pair)) && test(earlier.get(key(pair))!)))
}

interface Row {
  group: string
  coreMoved: boolean
  coreNotesMoved: number
  otherNotesMoved: number
  newBigLeaps: number
  newShortMoves: number
  newBigLeapsInOutput: number
  newShortMovesInOutput: number
  /** 最終の音にある大きな跳躍を、初めて作った段階 */
  outputLeapOrigins: string[]
}

function rowFor(path: readonly CandidateStage[], coreLength: number, group: string): Row | undefined {
  const before = path.find((entry) => entry.stage === "narrative:climaxPeak")
  const after = path.find((entry) => entry.stage === "narrative:peakRarity")
  if (!before || !after) return undefined
  const output = path.at(-1)!.notes
  const pitchBefore = new Map(before.notes.map((note) => [note.id, note.pitch]))
  const moved = after.notes.filter((note) => pitchBefore.has(note.id) && pitchBefore.get(note.id) !== note.pitch)
  const coreNotesMoved = moved.filter((note) => note.startBeat < coreLength - 1e-6).length
  const outputPairs = new Map(pairsOf(output).map((pair) => [key(pair), pair]))
  const bigLeaps = newlyCreated(before.notes, after.notes, isBigLeap)
  const shortMoves = newlyCreated(before.notes, after.notes, isShortMove)
  const survives = (pair: Pair, test: (pair: Pair) => boolean) => outputPairs.has(key(pair)) && test(outputPairs.get(key(pair))!)
  // 最終の大きな跳躍が、どの段階で初めて(その2音の組として)しきい値を超えたか
  const outputLeapOrigins = pairsOf(output).filter(isBigLeap).map((pair) => {
    const origin = path.find((entry) => {
      const found = pairsOf(entry.notes).find((candidate) => key(candidate) === key(pair))
      return found !== undefined && isBigLeap(found)
    })
    return origin?.stage ?? "対応不明"
  })
  return {
    group,
    coreMoved: coreNotesMoved > 0,
    coreNotesMoved,
    otherNotesMoved: moved.length - coreNotesMoved,
    newBigLeaps: bigLeaps.length,
    newShortMoves: shortMoves.length,
    newBigLeapsInOutput: bigLeaps.filter((pair) => survives(pair, isBigLeap)).length,
    newShortMovesInOutput: shortMoves.filter((pair) => survives(pair, isShortMove)).length,
    outputLeapOrigins,
  }
}

function summarize(rows: readonly Row[]) {
  const share = (count: number) => Math.round(count / Math.max(1, rows.length) * 1000) / 1000
  const origins: Record<string, number> = {}
  for (const origin of rows.flatMap((row) => row.outputLeapOrigins)) origins[origin] = (origins[origin] ?? 0) + 1
  return {
    candidates: rows.length,
    coreMovedShare: share(rows.filter((row) => row.coreMoved).length),
    coreNotesMovedTotal: rows.reduce((sum, row) => sum + row.coreNotesMoved, 0),
    otherNotesMovedTotal: rows.reduce((sum, row) => sum + row.otherNotesMoved, 0),
    withNewBigLeapShare: share(rows.filter((row) => row.newBigLeaps > 0).length),
    newBigLeapsTotal: rows.reduce((sum, row) => sum + row.newBigLeaps, 0),
    newBigLeapsInOutputTotal: rows.reduce((sum, row) => sum + row.newBigLeapsInOutput, 0),
    withNewShortMoveShare: share(rows.filter((row) => row.newShortMoves > 0).length),
    newShortMovesTotal: rows.reduce((sum, row) => sum + row.newShortMoves, 0),
    newShortMovesInOutputTotal: rows.reduce((sum, row) => sum + row.newShortMovesInOutput, 0),
    outputBigLeapsTotal: rows.reduce((sum, row) => sum + row.outputLeapOrigins.length, 0),
    outputBigLeapOrigins: Object.fromEntries(Object.entries(origins).sort((a, b) => b[1] - a[1])),
  }
}

it("頂点の希少化の影響範囲を記録する(記録専用)", () => {
  const rows: Row[] = []
  let withoutNarrative = 0
  for (const bars of [8, 16] as const) for (const song of SONGS) for (const role of ROLES) for (const seed of SEEDS) {
    const text = bars === 16 ? `${song.chords} | ${song.chords}` : song.chords
    const chords = parseChordInputText(text, "s1", 4, "c")
    const { result, records } = traceStages(() => generateFromChordsWithProfiles({
      chords, sectionId: "s1", sectionRole: role, songProfile: "dark-romantic", density: "balanced",
      range: RANGE_PRESETS.middle, drama: "growing", totalBeats: bars * 4, seed, profiles: ["standard", "cinematic"], key: song.key,
    }))
    for (const candidate of result.candidates) {
      if (candidate.coreLengthBeats === undefined) continue
      const path = candidatePath(records, {
        profile: candidate.generatorProfile,
        poolIndex: candidate.generationDiagnostics!.candidatePoolIndex,
        patternIndex: candidate.patternIndex,
      })
      // 取り出した道筋の最後は、実際に出した音と同じ
      expect(path.at(-1)?.stage).toBe("final:output")
      expect(path.at(-1)!.notes.map((note) => note.pitch)).toEqual(candidate.notes.map((note) => note.pitch))
      const style = role === "chorus" ? candidate.coreRhythm ?? "varied" : "verse"
      const row = rowFor(path, candidate.coreLengthBeats, `${style}|${bars}bars|core${candidate.coreLengthBeats}`)
      if (row) rows.push(row)
      else withoutNarrative += 1
    }
  }
  const groups = [...new Set(rows.map((row) => row.group))].sort()
  const byAxis = (index: number) => Object.fromEntries([...new Set(rows.map((row) => row.group.split("|")[index]))].sort()
    .map((value) => [value, summarize(rows.filter((row) => row.group.split("|")[index] === value))]))
  const report = {
    definitions: { bigLeapSemitones: BIG_LEAP, shortNoteBeats: SHORT_NOTE, shortMoveSemitones: SHORT_MOVE },
    withoutNarrative,
    all: summarize(rows),
    byStyle: byAxis(0),
    byBars: byAxis(1),
    byCoreLength: byAxis(2),
    byGroup: Object.fromEntries(groups.map((group) => [group, summarize(rows.filter((row) => row.group === group))])),
  }
  expect(rows.length).toBeGreaterThan(0)
  if (process.env.IMPACT_OUT) writeFileSync(process.env.IMPACT_OUT, JSON.stringify(report, null, 1))
}, 600000)
