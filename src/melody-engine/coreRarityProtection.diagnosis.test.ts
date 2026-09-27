import { it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordInputText } from "@/core/chordInput"
import type { CandidateGenerationDiagnostics, MelodyGeneratorProfile } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles, type GenerateProfileBatchInput, type ProfileCandidate } from "./generateFromChords"
import { candidatePath, traceStages, type StageNote, type StageRecord } from "./stageTrace"

/**
 * 案A(protectCoreFromRarity)で、なぜ選ばれる候補が入れ替わるのか、後の段階がどう反応するのかの診断(記録専用、開発用の条件)。
 * CORE_PROTECTION_DIAG_OUT を指定したときだけ動く。生成・採点・閾値は変えない。
 *   1. 入れ替わりの理由: 出ていった候補・入ってきた候補それぞれについて、その候補自身の音(仕上げ後)が変わったか、
 *      選抜の理由と点数がどう変わったかを記録する。
 *   2. 後の段階の反応: 同じ候補で最終の音が変わったとき、変更前後で音の差が増えた段階を数える。
 *   3. 後半の最高音: 同じ候補ごとに「後半にも最高音と同じ高さがあるか」の変化(有→無 / 無→有)を数える。
 *   4. 特定の例(サビ後半の対照の回帰のテスト条件と、古典らしさが大きく下がった G のサビ)を、候補と段階が分かる形で書き出す。
 */
const COMPARISON_SONGS = [
  { key: "Bb", chords: "Bb | Gm | Eb | F | Bb | Gm | Cm | F" },
  { key: "Em", chords: "Em | C | G | D | Em | C | B7 | Em" },
  { key: "D", chords: "D | Bm | G | A | D | F#m | G | A" },
  { key: "Gm", chords: "Gm | Eb | Bb | F | Gm | Cm | D7 | Gm" },
]

type Run = ReturnType<typeof traceStages<ReturnType<typeof generateFromChordsWithProfiles>>>
const PROFILES: MelodyGeneratorProfile[] = ["standard", "cinematic"]
const profileOf = (diagnostic: CandidateGenerationDiagnostics, input: GenerateProfileBatchInput) =>
  PROFILES.find((_, index) => diagnostic.batchBaseSeed === input.seed + index * 500009) ?? "?"
const poolKey = (diagnostic: CandidateGenerationDiagnostics, input: GenerateProfileBatchInput) =>
  [profileOf(diagnostic, input), diagnostic.candidatePoolIndex, diagnostic.candidateSeed, diagnostic.openingRegenerationAttempts].join("|")
const candidateKey = (candidate: ProfileCandidate) => [
  candidate.generatorProfile,
  candidate.generationDiagnostics!.candidatePoolIndex,
  candidate.seed,
  candidate.generationDiagnostics!.openingRegenerationAttempts,
].join("|")
const signature = (notes: readonly StageNote[]) => JSON.stringify([...notes].sort((a, b) => a.startBeat - b.startBeat).map((note) => [note.startBeat, note.durationBeats, note.pitch]))

/** 候補プールの1件の、仕上げ後(選抜に使う形)の音 */
function craftedOf(records: readonly StageRecord[], profile: string, poolIndex: number, attempt: number): string | undefined {
  const record = records.filter((entry) => entry.context.phase === "craft" && entry.stage === "harmonicIntegrity" &&
    entry.context.profile === profile && entry.context.poolIndex === poolIndex && entry.context.attempt === attempt).at(-1)
  return record ? signature(record.notes) : undefined
}

function swapsOf(input: GenerateProfileBatchInput, off: Run, on: Run) {
  const offDiagnostics = new Map(off.result.diagnostics.map((diagnostic) => [poolKey(diagnostic, input), diagnostic]))
  const onDiagnostics = new Map(on.result.diagnostics.map((diagnostic) => [poolKey(diagnostic, input), diagnostic]))
  const selectedOff = new Set(off.result.candidates.map(candidateKey))
  const selectedOn = new Set(on.result.candidates.map(candidateKey))
  const describe = (key: string) => {
    const before = offDiagnostics.get(key)
    const after = onDiagnostics.get(key)
    const [profile, poolIndex, , attempt] = key.split("|")
    const craftedBefore = craftedOf(off.records, profile, Number(poolIndex), Number(attempt))
    const craftedAfter = craftedOf(on.records, profile, Number(poolIndex), Number(attempt))
    return {
      key,
      inPoolBefore: Boolean(before),
      inPoolAfter: Boolean(after),
      ownNotesChanged: craftedBefore !== undefined && craftedAfter !== undefined ? craftedBefore !== craftedAfter : undefined,
      reason: `${before?.reason ?? "-"} → ${after?.reason ?? "-"}`,
      quality: [before?.qualityScore, after?.qualityScore].map((value) => value === undefined ? null : Math.round(value * 100) / 100),
      selectionScore: [before?.selectionScore, after?.selectionScore].map((value) => value == null ? null : Math.round(value * 1000) / 1000),
    }
  }
  const out = [...selectedOff].filter((key) => !selectedOn.has(key)).map(describe)
  const into = [...selectedOn].filter((key) => !selectedOff.has(key)).map(describe)
  return { out, into }
}

const classify = (out: ReturnType<typeof swapsOf>["out"][number], into: ReturnType<typeof swapsOf>["into"]) => {
  if (!out.inPoolAfter) return "出ていった候補がプールから消えた(再生成など)"
  if (out.ownNotesChanged) return "出ていった候補自身の音が変わった"
  // 選抜は作り方ごとに別々に行うので、同じ作り方で入ってきた候補だけを見る
  const profile = out.key.split("|")[0]
  if (into.some((candidate) => candidate.key.split("|")[0] === profile && candidate.ownNotesChanged)) return "出ていった候補は同じで、入ってきた候補の音が変わった"
  return "どちらの音も同じで、他の候補の変化で順位が変わった"
}

/** 仕上げ(finish)で採用した案(established / arc / late-peak) */
function chosenFinish(records: readonly StageRecord[], candidate: ProfileCandidate): string {
  const own = (record: StageRecord) => record.context.profile === candidate.generatorProfile &&
    record.context.poolIndex === candidate.generationDiagnostics!.candidatePoolIndex
  const survivor = records.filter((record) => record.stage === "pool:harmonicIntegrity" && own(record)).at(-1)
  return String(records.filter((record) => record.stage === "buildCandidate:chosen" && own(record) &&
    record.context.attempt === survivor?.context.attempt).at(-1)?.context.chosenFinish)
}

/**
 * 同じ候補の、段階ごとの音の差が前の段階より増えた段階。差は、保護ありの音を開始拍・長さで保護なしの音に照合して
 * 音高が違う(または対応がない)音の数と、音数の差の和。片方向の照合なので実際に違う音の数と一致するとは限らず、
 * 回数の順位は音楽上の悪影響の順位でもない
 */
function stageGrowth(off: Run, on: Run, candidate: ProfileCandidate, previous: ProfileCandidate) {
  const pathOff = candidatePath(off.records, { profile: previous.generatorProfile, poolIndex: previous.generationDiagnostics!.candidatePoolIndex, patternIndex: previous.patternIndex })
  const pathOn = candidatePath(on.records, { profile: candidate.generatorProfile, poolIndex: candidate.generationDiagnostics!.candidatePoolIndex, patternIndex: candidate.patternIndex })
  const differences = (a: readonly StageNote[], b: readonly StageNote[]) => {
    const pitches = new Map(a.map((note) => [`${note.startBeat}|${note.durationBeats}`, note.pitch]))
    return b.filter((note) => pitches.get(`${note.startBeat}|${note.durationBeats}`) !== note.pitch).length + Math.abs(a.length - b.length)
  }
  const growth: { stage: string; differences: number }[] = []
  let last = 0
  pathOn.forEach((entry, index) => {
    const other = pathOff[index]
    if (!other || other.stage !== entry.stage) return
    const count = differences(other.notes, entry.notes)
    if (count > last) growth.push({ stage: entry.stage, differences: count })
    last = count
  })
  return growth
}

const latterHalfPeak = (candidate: ProfileCandidate, totalBeats: number) => {
  const max = Math.max(...candidate.notes.map((note) => note.pitch))
  return candidate.notes.some((note) => note.pitch === max && note.startBeat >= totalBeats / 2 - 1e-6)
}

it.runIf(Boolean(process.env.CORE_PROTECTION_DIAG_OUT))("案Aの入れ替わりと後の段階の反応を診断する(記録専用)", () => {
  const swapCauses: Record<string, number> = {}
  const reasonChanges: Record<string, number> = {}
  const growthStages: Record<string, number> = {}
  const firstStages: Record<string, number> = {}
  const finishChanges: Record<string, number> = {}
  const latter = { kept: 0, lost: 0, gained: 0, neither: 0 }
  const examples: unknown[] = []
  const conditionsFor = () => {
    const list: { label: string; input: GenerateProfileBatchInput }[] = []
    for (const bars of [8, 16] as const) for (const song of COMPARISON_SONGS) for (const role of ["verse", "chorus"] as SectionRole[]) for (const seed of [9101, 9202, 9303]) {
      const text = bars === 16 ? `${song.chords} | ${song.chords}` : song.chords
      list.push({ label: `${song.key} ${role} ${bars}小節 seed${seed}`, input: {
        chords: parseChordInputText(text, "s1", 4, "c"), sectionId: "s1", sectionRole: role, songProfile: "dark-romantic", density: "balanced",
        range: RANGE_PRESETS.middle, drama: "growing", totalBeats: bars * 4, seed, profiles: PROFILES, key: song.key,
      } })
    }
    return list
  }
  for (const { input } of conditionsFor()) {
    const off = traceStages(() => generateFromChordsWithProfiles({ ...input, protectCoreFromRarity: false }))
    const on = traceStages(() => generateFromChordsWithProfiles({ ...input, protectCoreFromRarity: true }))
    const { out, into } = swapsOf(input, off, on)
    for (const candidate of out) {
      const cause = classify(candidate, into)
      swapCauses[cause] = (swapCauses[cause] ?? 0) + 1
      reasonChanges[`出: ${candidate.reason}`] = (reasonChanges[`出: ${candidate.reason}`] ?? 0) + 1
    }
    for (const candidate of into) reasonChanges[`入: ${candidate.reason}`] = (reasonChanges[`入: ${candidate.reason}`] ?? 0) + 1
    const offByKey = new Map(off.result.candidates.map((candidate) => [candidateKey(candidate), candidate]))
    for (const candidate of on.result.candidates) {
      const previous = offByKey.get(candidateKey(candidate))
      if (!previous) continue
      const before = latterHalfPeak(previous, input.totalBeats)
      const after = latterHalfPeak(candidate, input.totalBeats)
      if (before && after) latter.kept += 1
      else if (before) latter.lost += 1
      else if (after) latter.gained += 1
      else latter.neither += 1
      if (signature(previous.notes) === signature(candidate.notes)) continue
      const growth = stageGrowth(off, on, candidate, previous)
      // 採用した仕上げの案が変わると、同じ段階名でも別の案の記録を比べることになるので分けて数える
      const finish = `${chosenFinish(off.records, previous)} → ${chosenFinish(on.records, candidate)}`
      finishChanges[finish] = (finishChanges[finish] ?? 0) + 1
      if (growth[0]) firstStages[`${growth[0].stage}(${finish})`] = (firstStages[`${growth[0].stage}(${finish})`] ?? 0) + 1
      for (const step of growth) growthStages[step.stage] = (growthStages[step.stage] ?? 0) + 1
    }
  }

  // 特定の例1: サビ後半の対照の頭の回帰(hookDevelopment.test.ts と同じ条件)
  const contrastInput: GenerateProfileBatchInput = {
    chords: ["Am", "F", "C", "G", "Am", "F", "C", "G"].map((symbol, index) => ({ id: `c${index}`, sectionId: "s", startBeat: index * 4, durationBeats: 4, symbol, bass: null })),
    sectionId: "s", sectionRole: "chorus", songProfile: "original-custom", density: "balanced", range: { low: 60, high: 77 },
    drama: "growing", totalBeats: 32, seed: 7, profiles: ["standard"],
  }
  {
    const off = traceStages(() => generateFromChordsWithProfiles({ ...contrastInput, protectCoreFromRarity: false }))
    const on = traceStages(() => generateFromChordsWithProfiles({ ...contrastInput, protectCoreFromRarity: true }))
    examples.push({ example: "サビ後半の対照の頭の回帰(Am F C G、seed 7、original-custom)", ...swapsOf(contrastInput, off, on) })
  }
  // 特定の例2: 古典らしさが大きく下がった G のサビ(seed 303、標準、プール11番)
  {
    const input: GenerateProfileBatchInput = {
      chords: parseChordInputText("G | D/F# | Em | C | Am | D | G | G", "s1", 4, "c"), sectionId: "s1", sectionRole: "chorus",
      songProfile: "dark-romantic", density: "balanced", range: RANGE_PRESETS.middle, drama: "growing", totalBeats: 32, seed: 303,
      profiles: PROFILES, key: "G",
    }
    const off = traceStages(() => generateFromChordsWithProfiles({ ...input, protectCoreFromRarity: false }))
    const on = traceStages(() => generateFromChordsWithProfiles({ ...input, protectCoreFromRarity: true }))
    const pick = (run: Run) => run.result.candidates.find((candidate) => candidate.generatorProfile === "standard" && candidate.generationDiagnostics!.candidatePoolIndex === 11)
    const before = pick(off)
    const after = pick(on)
    if (before && after) {
      const pathOff = candidatePath(off.records, { profile: "standard", poolIndex: 11, patternIndex: before.patternIndex })
      const pathOn = candidatePath(on.records, { profile: "standard", poolIndex: 11, patternIndex: after.patternIndex })
      examples.push({
        example: "古典らしさが大きく下がった G のサビ(seed 303、標準、プール11番)",
        stages: pathOn.map((entry, index) => ({ stage: entry.stage, off: signature(pathOff[index]?.notes ?? []), on: signature(entry.notes) }))
          .filter((entry, index, all) => index === 0 || entry.off !== all[index - 1].off || entry.on !== all[index - 1].on),
        growth: stageGrowth(off, on, after, before),
      })
    }
  }

  writeFileSync(process.env.CORE_PROTECTION_DIAG_OUT!, JSON.stringify({ swapCauses, reasonChanges, finishChanges, firstStages, growthStages, latterHalfPeakOnSameCandidates: latter, examples }, null, 1))
}, 900000)
