import { expect, it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordInputText } from "@/core/chordInput"
import type { SectionRole } from "@/core/section"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles, type ProfileCandidate } from "./generateFromChords"
import { candidatePath, traceStages, type StageNote, type StageRecord } from "./stageTrace"

/**
 * 案Dの診断(記録専用。CORE_PROTECTION_LATEPEAK_OUT を指定したときだけ動く)。
 * 案A(protectCoreFromRarity)の有無で、頂点を後ろへずらす案(late-peak)が
 *   1. 試す条件に入ったか 2. 実際に試したか 3. 採用されたか
 * を分けて数える。母数は、候補プールのすべての候補(最後に作り直した回)と、最終の3案に入った候補の2つ。
 * さらに、前後どちらでも最終の3案に入った同じ候補について、同じ仕上げの案どうしの差と、案が替わった後の差を分ける。
 * 条件は案Aの比較(開発用)と同じ。
 */
const SONGS = [
  { key: "Bb", chords: "Bb | Gm | Eb | F | Bb | Gm | Cm | F" },
  { key: "Em", chords: "Em | C | G | D | Em | C | B7 | Em" },
  { key: "D", chords: "D | Bm | G | A | D | F#m | G | A" },
  { key: "Gm", chords: "Gm | Eb | Bb | F | Gm | Cm | D7 | Gm" },
]
const SEEDS = [9101, 9202, 9303]
const ROLES: SectionRole[] = ["verse", "chorus"]

interface PoolEntry { eligible: boolean; tried: boolean; adopted: boolean; finish: string }

/** 候補プールの各候補(作り方・番号の最後に作り直した回)について、late-peak の条件・試行・採用 */
function poolEntries(records: readonly StageRecord[]): Map<string, PoolEntry> {
  const entries = new Map<string, PoolEntry>()
  for (const record of records) {
    if (record.stage !== "buildCandidate:chosen") continue
    const key = `${record.context.profile}|${record.context.poolIndex}`
    const tried = records.some((other) => other.context.finish === "late-peak" && other.context.profile === record.context.profile &&
      other.context.poolIndex === record.context.poolIndex && other.context.attempt === record.context.attempt)
    // 同じ番号を作り直したときは、後の記録で上書きする(最後に作り直した回が残る)
    entries.set(key, {
      eligible: Boolean(record.context.latePeakEligible),
      tried,
      adopted: record.context.chosenFinish === "late-peak",
      finish: String(record.context.chosenFinish),
    })
  }
  return entries
}

const identity = (candidate: ProfileCandidate) => [
  candidate.generatorProfile,
  candidate.generationDiagnostics!.candidatePoolIndex,
  candidate.seed,
  candidate.generationDiagnostics!.openingRegenerationAttempts,
].join("|")

/** 開始拍・長さで照合して音高が違う音の数と、音数の差(片方向の照合。実際に違う音の数と一致するとは限らない) */
const differences = (a: readonly StageNote[], b: readonly StageNote[]) => {
  const pitches = new Map(a.map((note) => [`${note.startBeat}|${note.durationBeats}`, note.pitch]))
  return b.filter((note) => pitches.get(`${note.startBeat}|${note.durationBeats}`) !== note.pitch).length + Math.abs(a.length - b.length)
}

it.runIf(Boolean(process.env.CORE_PROTECTION_LATEPEAK_OUT))("案D: late-peak が試され、採用される割合を、保護の有無で分ける(記録専用)", () => {
  const count = () => ({ candidates: 0, eligible: 0, tried: 0, adopted: 0 })
  const pool = { off: count(), on: count() }
  const selected = { off: count(), on: count() }
  const transitions: Record<string, number> = {}
  const same = { sameFinish: 0, sameFinishChanged: 0, sameFinishDifferences: 0, finishChanged: 0, finishChangedDifferences: 0 }
  const representative: string[] = []
  for (const bars of [8, 16] as const) for (const song of SONGS) for (const role of ROLES) for (const seed of SEEDS) {
    const text = bars === 16 ? `${song.chords} | ${song.chords}` : song.chords
    const run = (protectCoreFromRarity: boolean) => traceStages(() => generateFromChordsWithProfiles({
      chords: parseChordInputText(text, "s1", 4, "c"), sectionId: "s1", sectionRole: role, songProfile: "dark-romantic",
      density: "balanced", range: RANGE_PRESETS.middle, drama: "growing", totalBeats: bars * 4, seed,
      profiles: ["standard", "cinematic"], key: song.key, protectCoreFromRarity,
    }))
    const off = run(false)
    const on = run(true)
    const entries = { off: poolEntries(off.records), on: poolEntries(on.records) }
    for (const side of ["off", "on"] as const) {
      for (const entry of entries[side].values()) {
        pool[side].candidates += 1
        pool[side].eligible += Number(entry.eligible)
        pool[side].tried += Number(entry.tried)
        pool[side].adopted += Number(entry.adopted)
      }
      const result = side === "off" ? off.result : on.result
      for (const candidate of result.candidates) {
        const entry = entries[side].get(`${candidate.generatorProfile}|${candidate.generationDiagnostics!.candidatePoolIndex}`)
        if (!entry) continue
        selected[side].candidates += 1
        selected[side].eligible += Number(entry.eligible)
        selected[side].tried += Number(entry.tried)
        selected[side].adopted += Number(entry.adopted)
      }
    }
    // 候補プール全体で、仕上げの案がどう替わったか(同じ作り方・番号どうし)
    for (const [key, before] of entries.off) {
      const after = entries.on.get(key)
      if (!after) continue
      const label = `${before.finish} → ${after.finish}`
      transitions[label] = (transitions[label] ?? 0) + 1
    }
    // 前後どちらでも最終の3案に入った同じ候補
    const offById = new Map(off.result.candidates.map((candidate) => [identity(candidate), candidate]))
    for (const candidate of on.result.candidates) {
      const previous = offById.get(identity(candidate))
      if (!previous) continue
      const target = (item: ProfileCandidate) => ({ profile: item.generatorProfile, poolIndex: item.generationDiagnostics!.candidatePoolIndex, patternIndex: item.patternIndex })
      const before = entries.off.get(`${previous.generatorProfile}|${previous.generationDiagnostics!.candidatePoolIndex}`)
      const after = entries.on.get(`${candidate.generatorProfile}|${candidate.generationDiagnostics!.candidatePoolIndex}`)
      const diff = differences(candidatePath(off.records, target(previous)).at(-1)!.notes, candidatePath(on.records, target(candidate)).at(-1)!.notes)
      if (before?.finish === after?.finish) {
        same.sameFinish += 1
        if (diff > 0) {
          same.sameFinishChanged += 1
          same.sameFinishDifferences += diff
        }
      } else {
        same.finishChanged += 1
        same.finishChangedDifferences += diff
      }
      // 代表例(案Cの確認): 古典らしさが大きく下がった G のサビ(開発用の比較条件)は別の条件なので、ここではこの条件の中で
      // 同じ仕上げの案のまま差が大きい候補を残す
      if (before?.finish === after?.finish && diff >= 5) {
        representative.push(`${song.key} ${role} ${bars}小節 seed${seed} ${candidate.generatorProfile} pool${candidate.generationDiagnostics!.candidatePoolIndex}: 案 ${after?.finish}、差 ${diff}`)
      }
    }
  }
  const report = { population: { pool, selected }, finishTransitionsInPool: transitions, sameCandidates: same, representativeSameFinish: representative }
  expect(pool.off.candidates).toBeGreaterThan(0)
  writeFileSync(process.env.CORE_PROTECTION_LATEPEAK_OUT!, JSON.stringify(report, null, 1))
}, 900000)
