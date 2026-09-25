import { describe, expect, it } from "vitest"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseChordInputText } from "@/core/chordInput"
import type { MelodyNote } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { composerSongExchangeToProject } from "@/core/composerSongExchange"
import { resolveMusicContext, type ResolvedMusicContext } from "@/core/musicContext"
import type { ComposerProject } from "@/core/project"
import { parseReferenceProfile, type ReferenceApplyTarget, type ReferenceInfluenceAmount } from "@/core/referenceProfile"
import { RANGE_PRESETS } from "@/melody-engine/generationParams"
import { generateFromChordsWithProfiles } from "@/melody-engine/generateFromChords"
import { analyzeFullSongArrangement, generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { measureMelodyReferenceFeatures, melodyReferenceFitScore } from "@/melody-engine/referenceFit"
import { classicalLikeness } from "@/melody-engine/classicalLikeness"
import { CLASSICAL_MODELS } from "@/melody-engine/classicalModels"
import { measureMelodyCraft } from "@/melody-engine/melodyCraftMetrics"

/**
 * 同じコード・テンポ・セクションで、参考曲なし / 弱 / 中 / 強 を比べる。
 * 確かめること: 参考曲の傾向へ近づく / Hook-first と作りの良さは保つ / いまの曲の骨格(コード・調・頂点の場所)は変えない /
 * 音像は楽器を足すのではなく、距離・余韻・密度の値として効く。
 * 参考プロファイルには音列が無いので、参考曲のフレーズを再現する経路そのものが無い(parse で拒否することも確かめる)。
 * 環境変数 REFERENCE_COMPARISON_OUT にファイル名を渡すと、測った値を書き出す。
 */

// 16分の裏拍が多く、暗く、ベースがよく動き、終盤に頂点が来る参考曲(数値だけ)
const PROFILE = parseReferenceProfile({
  version: 1, id: "ref-test", label: "テスト用の参考曲", createdAt: "2026-09-25T00:00:00Z",
  source: { kind: "audio", durationSeconds: 240, tempoBpm: 123 },
  melody: { motifLength: .43, repetition: .6, noteDensity: .55, restDensity: .3, rhythmicIdentity: .85, registerExpansion: .6, climaxTiming: .8 },
  harmony: { harmonicRhythm: .52, tension: .46, resolutionStrength: .7, bassMovement: .82, modalTendency: .2 },
  rhythm: { density: .8, syncopation: .83, grooveTendency: .93 },
  arrangement: { foregroundDensity: .38, backgroundSustain: .29, phraseFrequency: .28, sectionContrast: .42, registerBalance: .23 },
  aesthetic: { depth: .74, decay: .57, transientSoftness: .27, stereoDiffusion: .72, darkLuminousBalance: .33, textureDensity: .45 },
  emotion: { restraint: .26, tensionCurve: [0, .66, .69, .74, .7, .73, .97, 1], climaxTiming: .98, release: .36, afterglow: .02 },
  confidence: {},
})

const LEVELS: Array<ReferenceInfluenceAmount | null> = [null, "low", "moderate", "high"]
const ALL_TARGETS: ReferenceApplyTarget[] = ["melody", "harmony", "rhythm", "bass", "arrangement", "aesthetic", "emotionalArc"]

function withReference(project: ComposerProject, amount: ReferenceInfluenceAmount | null, targets = ALL_TARGETS): ComposerProject {
  return {
    ...project,
    song: {
      ...project.song,
      referenceProfiles: amount ? [PROFILE] : [],
      referenceInfluences: amount ? [{ profileId: PROFILE.id, targets: Object.fromEntries(targets.map((target) => [target, amount])) }] : [],
    },
  }
}

const SONGS = [
  { key: "C", chords: "F | G | Em | Am | Dm | G | C | C" },
  { key: "Am", chords: "Am | F | G | E7 | Am | F | E7 | Am" },
  { key: "Dm", chords: "Dm | Bb | F | C | Gm | Bb | A7 | Dm" },
]
const SEEDS = [11, 22, 33]
const ROLES: SectionRole[] = ["verse", "chorus"]

interface MelodySample { level: string; fit: number; hook: number; classical: number; notes: MelodyNote[]; song: number; seed: number; role: SectionRole }

function generateMelodies(context: ResolvedMusicContext, level: string): MelodySample[] {
  const samples: MelodySample[] = []
  SONGS.forEach((song, songIndex) => {
    const chords = parseChordInputText(song.chords, "s1", 4, "c")
    for (const role of ROLES) for (const seed of SEEDS) {
      const { candidates } = generateFromChordsWithProfiles({
        chords, sectionId: "s1", sectionRole: role, songProfile: "dark-romantic", density: "balanced",
        range: RANGE_PRESETS.middle, drama: "growing", totalBeats: 32, seed, profiles: ["standard", "cinematic"], key: song.key,
        musicContext: context,
      })
      for (const candidate of candidates) {
        samples.push({
          level,
          fit: melodyReferenceFitScore(candidate.notes, 32, { traits: PROFILE.melody, strength: 1 }),
          hook: ((candidate.coreHumability ?? 0) + (candidate.coreHookability ?? 0)) / 2,
          classical: classicalLikeness(measureMelodyCraft(candidate.notes, chords, song.key), CLASSICAL_MODELS).score,
          notes: candidate.notes,
          song: songIndex,
          seed,
          role,
        })
      }
    }
  })
  return samples
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../contracts/composer-song-exchange.v2.example.json"), "utf8"))
const baseProject = composerSongExchangeToProject(fixture)
/** ジャンル指定のない曲(参考曲だけが傾向値を動かす場合) */
const plainProject: ComposerProject = { ...baseProject, song: { ...baseProject.song, genreBlend: [] } }

describe("Reference Influence: 参考なし / 弱 / 中 / 強の比較", () => {
  const melodies = LEVELS.map((level) => {
    const context = resolveMusicContext(withReference(plainProject, level))
    return generateMelodies(context, level ?? "none")
  })
  const summary: Record<string, unknown> = {}

  it("旋律: 強くするほど参考曲の傾向(密度・余白・リズムの個性・反復)へ近づき、Hook と作りの良さは保つ", () => {
    const rows = melodies.map((samples) => ({
      level: samples[0].level,
      fit: mean(samples.map((s) => s.fit)),
      hook: mean(samples.map((s) => s.hook)),
      classical: mean(samples.map((s) => s.classical)),
      features: Object.fromEntries(Object.keys(PROFILE.melody).filter((key) => key !== "motifLength").map((key) => [
        key, mean(samples.map((s) => measureMelodyReferenceFeatures(s.notes, 32)[key as "noteDensity"])),
      ])),
    }))
    summary.melody = rows
    expect(rows[3].fit).toBeGreaterThan(rows[0].fit)
    expect(rows[2].fit).toBeGreaterThanOrEqual(rows[0].fit)
    // Hook-first は崩さない(核の覚えやすさ・歌いやすさの平均は、参考なしから大きく下がらない)
    for (const row of rows) expect(row.hook).toBeGreaterThan(rows[0].hook - .06)
    // 作りの良さ(古典らしさ)も保つ
    for (const row of rows) expect(row.classical).toBeGreaterThan(rows[0].classical - 6)
  })

  it("旋律: 弱では多くの候補がそのまま残り、強でも同じ入力から新しく作った旋律になる(参考曲の音列は持っていない)", () => {
    const key = (s: MelodySample) => `${s.song}-${s.seed}-${s.role}`
    const same = (samples: MelodySample[]) => {
      const base = new Map<string, string[]>()
      for (const s of melodies[0]) base.set(key(s), [...(base.get(key(s)) ?? []), JSON.stringify(s.notes.map((n) => [n.startBeat, n.pitch]))])
      return mean(samples.map((s) => Number(base.get(key(s))?.includes(JSON.stringify(s.notes.map((n) => [n.startBeat, n.pitch]))) ?? false)))
    }
    const unchanged = melodies.map((samples) => same(samples))
    summary.unchangedShare = unchanged
    expect(unchanged[1]).toBeGreaterThanOrEqual(unchanged[3])
    expect(() => parseReferenceProfile({ ...PROFILE, melody: { ...PROFILE.melody, notes: [60, 62, 64] } })).toThrow()
    expect(() => parseReferenceProfile({ ...PROFILE, chords: ["Fm", "C"] })).toThrow()
  })

  it("リズム・ベース・フレーズ・音像: 傾向値が参考曲の向きへ動き、Genre や音像の明示より弱い", () => {
    const traits = LEVELS.map((level) => resolveMusicContext(withReference(plainProject, level)))
    expect(traits[0].styleActive).toBe(false)
    expect(traits[1].styleActive).toBe(true)
    summary.traits = traits.map((context) => ({ genre: context.genre, aesthetic: context.aesthetic }))
    expect(traits[3].genre.rhythmDensity).toBeGreaterThan(traits[1].genre.rhythmDensity)
    expect(traits[1].genre.rhythmDensity).toBeGreaterThan(traits[0].genre.rhythmDensity)
    expect(traits[3].genre.syncopation).toBeGreaterThan(traits[0].genre.syncopation)
    expect(traits[3].genre.bassMovement).toBeGreaterThan(traits[0].genre.bassMovement)
    expect(traits[3].aesthetic.depth).toBeGreaterThan(traits[0].aesthetic.depth)
    expect(traits[3].aesthetic.darkLuminousBalance).toBeLessThan(traits[0].aesthetic.darkLuminousBalance)
    // 強でも参考値そのものにはならない(上限あり)
    expect(Math.abs(traits[3].genre.rhythmDensity - PROFILE.rhythm.density)).toBeGreaterThan(.05)
    // 明示の Genre があるときは、参考曲の効きが半分になる
    const withGenre = (level: ReferenceInfluenceAmount | null) => resolveMusicContext(withReference(
      { ...plainProject, song: { ...plainProject.song, genreBlend: [{ id: "sadcore-slowcore", weight: 1 }] } }, level))
    const genreShift = withGenre("high").genre.rhythmDensity - withGenre(null).genre.rhythmDensity
    const plainShift = traits[3].genre.rhythmDensity - traits[0].genre.rhythmDensity
    expect(genreShift).toBeGreaterThan(0)
    expect(genreShift / (PROFILE.rhythm.density - withGenre(null).genre.rhythmDensity))
      .toBeLessThan(plainShift / (PROFILE.rhythm.density - traits[0].genre.rhythmDensity))
  })

  it("アレンジ: 頂点の場所とセクションの役割は変えず、エネルギーの弧だけを少し寄せる。パートを新しく足さない", () => {
    const analyses = LEVELS.map((level) => analyzeFullSongArrangement(withReference(baseProject, level, ["emotionalArc"])))
    summary.energy = analyses.map((analysis) => analysis.sections.map((section) => section.energy))
    for (const analysis of analyses) {
      expect(analysis.peakSectionId).toBe(analyses[0].peakSectionId)
      expect(analysis.sections.map((section) => section.semanticRole)).toEqual(analyses[0].sections.map((section) => section.semanticRole))
    }
    const shift = analyses[3].sections.map((section, index) => Math.abs(section.energy - analyses[0].sections[index].energy))
    expect(Math.max(...shift)).toBeLessThanOrEqual(12)

    const arrangements = LEVELS.map((level) => generateFullSongArrangement(withReference(baseProject, level), { seed: 7 }))
    const trackIds = arrangements.map((arrangement) => new Set(arrangement.tracks.map((track) => track.id)))
    // 使える楽器の枠は同じ(参考曲にある楽器を足す処理はしない)
    for (const ids of trackIds) expect([...ids].sort()).toEqual([...trackIds[0]].sort())
    summary.arrangement = arrangements.map((arrangement) => Object.fromEntries(arrangement.tracks
      .filter((track) => track.notes.length > 0)
      .map((track) => [track.id, track.notes.length])))
    if (process.env.REFERENCE_COMPARISON_OUT) writeFileSync(process.env.REFERENCE_COMPARISON_OUT, JSON.stringify(summary, null, 2))
  })
})
