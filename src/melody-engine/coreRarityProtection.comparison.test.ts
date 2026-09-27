import { expect, it } from "vitest"
import { writeFileSync } from "node:fs"
import { isChordTone } from "@/core/chord"
import { parseChordInputText } from "@/core/chordInput"
import { pitchClass } from "@/core/note"
import type { SectionRole } from "@/core/section"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles, type ProfileCandidate } from "./generateFromChords"
import { buildHarmonicMap, chordAtBeat } from "./harmonicMap"
import { candidatePath, traceStages, type StageNote, type StageRecord } from "./stageTrace"

/**
 * 案A(頂点の希少化で核の範囲を下げない)の比較。変更前(protectCoreFromRarity: false、既定)と変更後(true)を同じ条件で比べる。
 * 条件と記録する項目は結果を見る前に固定した(docs/rhythm-memory-controls.md の「案Aの比較」)。
 *   - 条件: 診断用(開発用の比較)とも実験2とも違う4進行 × seed 9101・9202・9303 × Aメロ・サビ × 8・16小節 × 標準・映画的
 *   - 同じ候補(作り方とプールの番号が同じ)への処理の差と、選ばれる候補の入れ替わりを分けて数える
 *   - 核の維持は、組み立て直後の核の範囲の音と比べて、音高の完全一致と、移調を許した形(音程・リズム)の一致を分ける
 *   - 音が動いたことを悪化とは数えない。閾値は設けない
 * CORE_PROTECTION_OUT を指定すると、集計を JSON で書き出す。
 */
const SONGS = [
  { key: "Bb", chords: "Bb | Gm | Eb | F | Bb | Gm | Cm | F" },
  { key: "Em", chords: "Em | C | G | D | Em | C | B7 | Em" },
  { key: "D", chords: "D | Bm | G | A | D | F#m | G | A" },
  { key: "Gm", chords: "Gm | Eb | Bb | F | Gm | Cm | D7 | Gm" },
]
const SEEDS = [9101, 9202, 9303]
const ROLES: SectionRole[] = ["verse", "chorus"]
const BIG_LEAP = 8
const SHORT_NOTE = .5
const SHORT_MOVE = 7

interface Measure {
  /** 組み立て直後と比べて、核の範囲の音が同じ音(id)・同じ音高・同じリズム */
  headExact: boolean
  /** 同じ音(id)・同じリズムで、隣り合う音程が同じ(移調を許す) */
  headShape: boolean
  /** 核の範囲で、組み立て直後からちょうど1オクターブ動いた音の数 */
  headOctaveMoves: number
  bigLeaps: number
  shortMoves: number
  /** 最高音が最初に現れる位置(区間に対する割合) */
  peakPosition: number
  /** 最高音が2回以上ある */
  peakShared: boolean
  /** 最高音が核の範囲にある */
  peakInCore: boolean
  /** 拍頭(1・3拍目)でコードの音でない音の数 */
  strongNonChord: number
  noteCount: number
}

function measure(candidate: ProfileCandidate, records: readonly StageRecord[], text: string, totalBeats: number): Measure | undefined {
  if (candidate.coreLengthBeats === undefined) return undefined
  const coreLength = candidate.coreLengthBeats
  const path = candidatePath(records, {
    profile: candidate.generatorProfile,
    poolIndex: candidate.generationDiagnostics!.candidatePoolIndex,
    patternIndex: candidate.patternIndex,
  })
  const assembled = path.find((entry) => entry.stage === "assemble")
  if (!assembled) return undefined
  const head = (notes: readonly StageNote[]) => [...notes].filter((note) => note.startBeat < coreLength - 1e-6).sort((a, b) => a.startBeat - b.startBeat)
  const before = head(assembled.notes)
  const after = head(path.at(-1)!.notes)
  const sameNotes = before.length === after.length && before.every((note, index) =>
    note.id === after[index].id && note.startBeat === after[index].startBeat && note.durationBeats === after[index].durationBeats)
  const intervals = (notes: readonly StageNote[]) => notes.slice(1).map((note, index) => note.pitch - notes[index].pitch)
  const pitchBefore = new Map(before.map((note) => [note.id, note.pitch]))
  const notes = [...candidate.notes].sort((a, b) => a.startBeat - b.startBeat)
  const pairs = notes.slice(1).map((note, index) => ({ first: notes[index], interval: note.pitch - notes[index].pitch }))
  const max = Math.max(...notes.map((note) => note.pitch))
  const peak = notes.find((note) => note.pitch === max)!
  const harmonicMap = buildHarmonicMap(parseChordInputText(text, "s1", 4, "c"))
  return {
    headExact: sameNotes && before.every((note, index) => note.pitch === after[index].pitch),
    headShape: sameNotes && intervals(before).every((interval, index) => interval === intervals(after)[index]),
    headOctaveMoves: after.filter((note) => pitchBefore.has(note.id) && Math.abs(note.pitch - pitchBefore.get(note.id)!) === 12).length,
    bigLeaps: pairs.filter((pair) => Math.abs(pair.interval) >= BIG_LEAP).length,
    shortMoves: pairs.filter((pair) => pair.first.durationBeats <= SHORT_NOTE + 1e-6 && Math.abs(pair.interval) >= SHORT_MOVE).length,
    peakPosition: peak.startBeat / totalBeats,
    peakShared: notes.filter((note) => note.pitch === max).length > 1,
    peakInCore: peak.startBeat < coreLength - 1e-6,
    strongNonChord: notes.filter((note) => {
      if (Math.abs(note.startBeat % 2) > 1e-6) return false
      const entry = chordAtBeat(harmonicMap, note.startBeat)
      return entry !== undefined && !isChordTone(entry.parsed, pitchClass(note.pitch))
    }).length,
    noteCount: notes.length,
  }
}

type Summary = Record<string, number>
function summarize(rows: readonly Measure[]): Summary {
  const mean = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length) * 1000) / 1000
  return {
    candidates: rows.length,
    headExactShare: mean(rows.map((row) => Number(row.headExact))),
    headShapeShare: mean(rows.map((row) => Number(row.headShape))),
    headOctaveMovesTotal: rows.reduce((sum, row) => sum + row.headOctaveMoves, 0),
    bigLeapsTotal: rows.reduce((sum, row) => sum + row.bigLeaps, 0),
    shortMovesTotal: rows.reduce((sum, row) => sum + row.shortMoves, 0),
    peakPositionMean: mean(rows.map((row) => row.peakPosition)),
    peakSharedShare: mean(rows.map((row) => Number(row.peakShared))),
    peakInCoreShare: mean(rows.map((row) => Number(row.peakInCore))),
    strongNonChordTotal: rows.reduce((sum, row) => sum + row.strongNonChord, 0),
    noteCountMean: mean(rows.map((row) => row.noteCount)),
  }
}

it("案A: 頂点の希少化から核を守る変更の前後を、固定した条件で比べる(記録専用)", () => {
  const all = { before: [] as Measure[], after: [] as Measure[] }
  const same = { before: [] as Measure[], after: [] as Measure[] }
  const changedWithinSame = { headExactGained: 0, headExactLost: 0, notesChanged: 0 }
  let conditions = 0
  let conditionsWithSwap = 0
  let swappedCandidates = 0
  for (const bars of [8, 16] as const) for (const song of SONGS) for (const role of ROLES) for (const seed of SEEDS) {
    const text = bars === 16 ? `${song.chords} | ${song.chords}` : song.chords
    const run = (protectCoreFromRarity: boolean) => traceStages(() => generateFromChordsWithProfiles({
      chords: parseChordInputText(text, "s1", 4, "c"), sectionId: "s1", sectionRole: role, songProfile: "dark-romantic",
      density: "balanced", range: RANGE_PRESETS.middle, drama: "growing", totalBeats: bars * 4, seed,
      profiles: ["standard", "cinematic"], key: song.key, protectCoreFromRarity,
    }))
    const off = run(false)
    const on = run(true)
    conditions += 1
    const keyOf = (candidate: ProfileCandidate) => `${candidate.generatorProfile}|${candidate.generationDiagnostics!.candidatePoolIndex}`
    const offByKey = new Map(off.result.candidates.map((candidate) => [keyOf(candidate), candidate]))
    const onKeys = new Set(on.result.candidates.map(keyOf))
    const swapped = on.result.candidates.filter((candidate) => !offByKey.has(keyOf(candidate))).length
    if (swapped > 0) conditionsWithSwap += 1
    swappedCandidates += swapped
    for (const candidate of off.result.candidates) {
      const row = measure(candidate, off.records, text, bars * 4)
      if (row) all.before.push(row)
    }
    for (const candidate of on.result.candidates) {
      const row = measure(candidate, on.records, text, bars * 4)
      if (row) all.after.push(row)
      const previous = offByKey.get(keyOf(candidate))
      if (!previous || !onKeys.has(keyOf(previous))) continue
      const before = measure(previous, off.records, text, bars * 4)
      if (!row || !before) continue
      same.before.push(before)
      same.after.push(row)
      if (!before.headExact && row.headExact) changedWithinSame.headExactGained += 1
      if (before.headExact && !row.headExact) changedWithinSame.headExactLost += 1
      if (candidate.notes.some((note, index) => note.pitch !== previous.notes[index]?.pitch) || candidate.notes.length !== previous.notes.length) {
        changedWithinSame.notesChanged += 1
      }
    }
  }
  const report = {
    conditions,
    selection: { conditionsWithSwap, swappedCandidates },
    sameCandidates: { before: summarize(same.before), after: summarize(same.after), ...changedWithinSame },
    allSelected: { before: summarize(all.before), after: summarize(all.after) },
  }
  expect(same.before.length).toBeGreaterThan(0)
  if (process.env.CORE_PROTECTION_OUT) writeFileSync(process.env.CORE_PROTECTION_OUT, JSON.stringify(report, null, 1))
}, 900000)
