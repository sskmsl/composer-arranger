import { describe, expect, it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyGeneratorProfile, MelodyNote } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { measureMelodyCraft, type MelodyCraftMetrics } from "./melodyCraftMetrics"

/**
 * 主旋律の作りの良さを、いくつかのコード進行・作り方でまとめて測る回帰テスト。
 * 数値の目安は melodyCraftMetrics.ts を参照。仕上げ(melodicCraft.ts)を入れる前と後の値をコメントに残す。
 * 環境変数 MELODY_CRAFT_OUT にファイル名を渡すと、測った値を書き出す。
 */

const PROFILES: MelodyGeneratorProfile[] = ["standard", "minimal", "leaping", "rhythmic", "cinematic", "elegiac-cantabile"]
const SONGS: Array<{ key: string; chords: string }> = [
  { key: "C", chords: "F | G | Em | Am | Dm | G | C | C" },
  { key: "Am", chords: "Am | F | G | E7 | Am | F | E7 | Am" },
  { key: "G", chords: "G | D/F# | Em | C | Am | D | G | G" },
  { key: "Dm", chords: "Dm | Bb | F | C | Gm | Bb | A7 | Dm" },
]
const SEEDS = [101, 202, 303]

interface Sample { metrics: MelodyCraftMetrics; notes: MelodyNote[]; role: SectionRole; profile: MelodyGeneratorProfile; song: number }

function generate(): Sample[] {
  const samples: Sample[] = []
  SONGS.forEach((song, songIndex) => {
    const chords = parseChordInputText(song.chords, "s1", 4, "c")
    for (const role of ["verse", "chorus"] as SectionRole[]) {
      for (const seed of SEEDS) {
        const { candidates } = generateFromChordsWithProfiles({
          chords,
          sectionId: "s1",
          sectionRole: role,
          songProfile: "dark-romantic",
          density: "balanced",
          range: RANGE_PRESETS.middle,
          drama: "growing",
          totalBeats: 32,
          seed,
          profiles: PROFILES,
          key: song.key,
        })
        for (const candidate of candidates) {
          samples.push({
            metrics: measureMelodyCraft(candidate.notes, chords, song.key),
            notes: candidate.notes,
            role,
            profile: candidate.generatorProfile,
            song: songIndex,
          })
        }
      }
    }
  })
  return samples
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)

describe("主旋律の作りの良さ", () => {
  const samples = generate()
  const all = samples.map((sample) => sample.metrics)
  const summary = {
    repeatedPitch: mean(all.map((m) => m.repeatedPitch)),
    stepwise: mean(all.map((m) => m.stepwise)),
    leapRecovery: mean(all.map((m) => m.leapRecovery)),
    top3Share: mean(all.map((m) => m.top3Share)),
    distinctPitches: mean(all.map((m) => m.distinctPitches)),
    strongBeatChordTone: mean(all.map((m) => m.strongBeatChordTone)),
    outOfScale: mean(all.map((m) => m.outOfScale)),
    // 同じ曲・同じ作り方での、サビとAメロの平均の高さの差(半音)
    chorusLift: mean(SONGS.flatMap((_, song) => PROFILES.map((profile) => {
      const of = (role: SectionRole) => mean(samples.filter((s) => s.song === song && s.profile === profile && s.role === role).map((s) => s.metrics.meanPitch))
      return of("chorus") - of("verse")
    }))),
    chorusRangeLift: mean(SONGS.flatMap((_, song) => PROFILES.map((profile) => {
      const of = (role: SectionRole) => mean(samples.filter((s) => s.song === song && s.profile === profile && s.role === role).map((s) => s.metrics.range))
      return of("chorus") - of("verse")
    }))),
    // 主音のコードで終わるサビが、主音か3度(安定した音)で終わる割合
    chorusStableEnding: mean(samples.filter((s) => s.role === "chorus").map((s) => (s.metrics.endsOnTonic ? 1 : 0))),
    endsOnChordTone: mean(all.map((m) => (m.endsOnChordTone ? 1 : 0))),
    parallelPerfectRate: mean(all.map((m) => m.parallelPerfectRate)),
    leadingToneResolution: mean(all.map((m) => m.leadingToneResolution)),
    seventhResolution: mean(all.map((m) => m.seventhResolution)),
    skeletonSmoothness: mean(all.map((m) => m.skeletonSmoothness)),
    antecedentOpen: mean(all.map((m) => (m.antecedentOpen ? 1 : 0))),
    sighsPerSection: mean(all.map((m) => m.sighCount)),
  }

  it("測定結果", () => {
    const rounded = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))
    if (process.env.MELODY_CRAFT_OUT) {
      const perProfile = Object.fromEntries(PROFILES.map((profile) => {
        const ms = samples.filter((sample) => sample.profile === profile).map((sample) => sample.metrics)
        return [profile, {
          top3: Math.round(mean(ms.map((m) => m.top3Share)) * 100) / 100,
          distinct: Math.round(mean(ms.map((m) => m.distinctPitches)) * 10) / 10,
          repeated: Math.round(mean(ms.map((m) => m.repeatedPitch)) * 100) / 100,
          recovery: Math.round(mean(ms.map((m) => m.leapRecovery)) * 100) / 100,
          notes: Math.round(mean(ms.map((m) => m.noteCount))),
          parallel: Math.round(mean(ms.map((m) => m.parallelPerfectRate)) * 100) / 100,
          skeleton: Math.round(mean(ms.map((m) => m.skeletonSmoothness)) * 100) / 100,
          open: Math.round(mean(ms.map((m) => (m.antecedentOpen ? 1 : 0))) * 100) / 100,
          sighs: Math.round(mean(ms.map((m) => m.sighCount)) * 100) / 100,
        }]
      }))
      writeFileSync(process.env.MELODY_CRAFT_OUT, JSON.stringify({ ...rounded, perProfile }, null, 2))
    }
    expect(samples.length).toBeGreaterThan(0)
  })

  // 仕上げ前 → 仕上げ後(2026-09)の値。数字は少し余裕を持たせた下限・上限
  it("同じ音の連打が多すぎない(0.26 → 0.21)", () => expect(summary.repeatedPitch).toBeLessThanOrEqual(0.23))
  it("跳躍の後に逆向きへ戻る(0.41 → 0.50)", () => expect(summary.leapRecovery).toBeGreaterThanOrEqual(0.46))
  it("同じ数音の中を回り続けない(上位3音の割合 0.76 → 0.70、音の種類 6.8 → 7.4)", () => {
    expect(summary.top3Share).toBeLessThanOrEqual(0.73)
    expect(summary.distinctPitches).toBeGreaterThanOrEqual(7.1)
  })
  it("サビはAメロより高い(平均 +1.1 → +3.0半音)", () => expect(summary.chorusLift).toBeGreaterThanOrEqual(2.5))
  it("サビは主音で落ち着いて終わる(0.33 → 0.91)、どのセクションもコードの音で終わる(0.72 → 1.0)", () => {
    expect(summary.chorusStableEnding).toBeGreaterThanOrEqual(0.85)
    expect(summary.endsOnChordTone).toBeGreaterThanOrEqual(0.99)
  })
  it("コードとの相性は保つ(強拍のコードの音 0.71 → 0.82、調の外の音 0.03)", () => {
    expect(summary.strongBeatChordTone).toBeGreaterThanOrEqual(0.75)
    expect(summary.outOfScale).toBeLessThanOrEqual(0.05)
  })
  // 旋律の基本原理(2026-09)。クラシックの旋律づくりで一般的とされる原則で、特定の曲から測った値ではない
  it("拍頭で旋律とベースが平行5度・8度になる所を減らす(0.096 → 0.085)", () => expect(summary.parallelPerfectRate).toBeLessThanOrEqual(0.09))
  it("導音は主音へ(0.89 → 0.92)、属七の7度は下へ(0.95 → 0.97)解決する", () => {
    expect(summary.leadingToneResolution).toBeGreaterThanOrEqual(0.9)
    expect(summary.seventhResolution).toBeGreaterThanOrEqual(0.95)
  })
  it("前半は主音で閉じずに後半へつなぐ(0.81 → 0.84)", () => expect(summary.antecedentOpen).toBeGreaterThanOrEqual(0.82))
  it("ため息の形は入れすぎない(1セクション平均 0.13 → 0.27)", () => {
    expect(summary.sighsPerSection).toBeGreaterThanOrEqual(0.2)
    expect(summary.sighsPerSection).toBeLessThanOrEqual(1)
  })
})
