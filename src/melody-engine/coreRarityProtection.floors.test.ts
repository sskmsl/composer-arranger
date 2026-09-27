import { it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyGeneratorProfile } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles, type ProfileCandidate } from "./generateFromChords"
import { measureMelodyCraft } from "./melodyCraftMetrics"
import { classicalLikeness } from "./classicalLikeness"
import { CLASSICAL_MODELS } from "./classicalModels"
import type { ChordEvent } from "@/core/project"

/**
 * 案A(protectCoreFromRarity)を既定にしたときに割れた下限の診断(記録専用。CORE_PROTECTION_FLOORS_OUT を指定したときだけ動く)。
 * 下限の値は変えず、下がった分が「選ばれる候補の入れ替わり」と「同じ候補への処理の差」のどちらから来たかを分ける。
 * 条件は、それぞれの下限のテストと同じ(開発用)。
 */
const SONGS = [
  { key: "C", chords: "F | G | Em | Am | Dm | G | C | C" },
  { key: "Am", chords: "Am | F | G | E7 | Am | F | E7 | Am" },
  { key: "G", chords: "G | D/F# | Em | C | Am | D | G | G" },
  { key: "Dm", chords: "Dm | Bb | F | C | Gm | Bb | A7 | Dm" },
]
const identity = (candidate: ProfileCandidate) => [
  candidate.generatorProfile,
  candidate.generationDiagnostics!.candidatePoolIndex,
  candidate.seed,
  candidate.generationDiagnostics!.openingRegenerationAttempts,
].join("|")

function decompose(profiles: MelodyGeneratorProfile[], metric: (candidate: ProfileCandidate, chords: ChordEvent[], key: string) => number) {
  const values = { off: [] as number[], on: [] as number[], sameOff: [] as number[], sameOn: [] as number[], swappedOut: [] as number[], swappedIn: [] as number[] }
  const changed: string[] = []
  for (const song of SONGS) for (const role of ["verse", "chorus"] as SectionRole[]) for (const seed of [101, 202, 303]) {
    const chords = parseChordInputText(song.chords, "s1", 4, "c")
    const run = (protectCoreFromRarity: boolean) => generateFromChordsWithProfiles({
      chords, sectionId: "s1", sectionRole: role, songProfile: "dark-romantic", density: "balanced", range: RANGE_PRESETS.middle,
      drama: "growing", totalBeats: 32, seed, profiles, key: song.key, protectCoreFromRarity,
    }).candidates
    const off = run(false)
    const on = run(true)
    const offById = new Map(off.map((candidate) => [identity(candidate), candidate]))
    const onIds = new Set(on.map(identity))
    for (const candidate of off) {
      const value = metric(candidate, chords, song.key)
      values.off.push(value)
      if (!onIds.has(identity(candidate))) values.swappedOut.push(value)
    }
    for (const candidate of on) {
      const value = metric(candidate, chords, song.key)
      values.on.push(value)
      const previous = offById.get(identity(candidate))
      if (!previous) {
        values.swappedIn.push(value)
        continue
      }
      const before = metric(previous, chords, song.key)
      values.sameOff.push(before)
      values.sameOn.push(value)
      if (Math.abs(before - value) > 1e-9) changed.push(`${song.key} ${role} ${seed} ${candidate.generatorProfile} pool${candidate.generationDiagnostics!.candidatePoolIndex}: ${before.toFixed(3)} → ${value.toFixed(3)}`)
    }
  }
  const mean = (list: number[]) => Math.round(list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length) * 10000) / 10000
  return Object.fromEntries([...Object.entries(values).map(([name, list]) => [name, { mean: mean(list), count: list.length }]), ["changedSameCandidates", changed]])
}

it.runIf(Boolean(process.env.CORE_PROTECTION_FLOORS_OUT))("案Aで割れた下限を、候補の入れ替わりと同じ候補への処理の差に分ける(記録専用)", () => {
  const report = {
    // melodyCraft.survey.test.ts の「導音は主音へ」(下限 0.9)と同じ条件
    leadingToneResolution: decompose(["standard", "minimal", "leaping", "rhythmic", "cinematic", "elegiac-cantabile"],
      (candidate, chords, key) => measureMelodyCraft(candidate.notes, chords, key).leadingToneResolution),
    // developmentPrinciples.comparison.test.ts の 8小節の古典らしさ(下限 94)と同じ条件
    classicalEightBars: decompose(["standard", "cinematic"],
      (candidate, chords, key) => classicalLikeness(measureMelodyCraft(candidate.notes, chords, key), CLASSICAL_MODELS).score),
  }
  writeFileSync(process.env.CORE_PROTECTION_FLOORS_OUT!, JSON.stringify(report, null, 1))
}, 900000)
