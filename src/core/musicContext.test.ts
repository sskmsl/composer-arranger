import { describe, expect, it } from "vitest"
import { createEmptyProject } from "./project"
import { GENRE_IDS, GENRE_KIND, normalizeGenreBlend, resolveMusicContext } from "./musicContext"

describe("Music Context", () => {
  it("既存の18語を重複なしに保ち、Genre以外の役割を分類する", () => {
    expect(new Set(GENRE_IDS).size).toBe(18)
    expect(GENRE_KIND.dorian).toBe("mode")
    expect(GENRE_KIND.ritual).toBe("dramaticRole")
    expect(GENRE_KIND.finale).toBe("dramaticRole")
  })

  it("完成パターンを選ばず数値特性を重み合成し、旧Profileは明示Genreなしで維持する", () => {
    const base = createEmptyProject("Genre blend")
    base.song.songProfile = "minimal-tension"
    const legacy = resolveMusicContext(base)
    expect(legacy.genres).toEqual([])
    const french = { ...base, song: { ...base.song, genreBlend: [{ id: "french-pop" as const, weight: 1 }] } }
    const dark = { ...base, song: { ...base.song, genreBlend: [{ id: "romantic-dark" as const, weight: 1 }] } }
    const blended = { ...base, song: { ...base.song, genreBlend: [
      { id: "french-pop" as const, weight: .5 },
      { id: "romantic-dark" as const, weight: .35 },
      { id: "cinematic" as const, weight: .15 },
    ] } }
    const mix = resolveMusicContext(blended)
    expect(mix.genres).toHaveLength(3)
    expect(mix.genre.rhythmDensity).toBeGreaterThan(resolveMusicContext(dark).genre.rhythmDensity)
    expect(mix.genre.rhythmDensity).toBeLessThan(resolveMusicContext(french).genre.rhythmDensity)
    expect(normalizeGenreBlend([
      { id: "trip-hop", weight: 1 }, { id: "trip-hop", weight: 1 }, { id: "minimalism", weight: 2 },
    ])).toEqual([{ id: "trip-hop", weight: .5 }, { id: "minimalism", weight: .5 }])
  })

  it("Sound ImageはGenre特性を変えず、空間だけを補間する", () => {
    const base = createEmptyProject("Aesthetic")
    base.song.genreBlend = [{ id: "trip-hop", weight: .65 }, { id: "romantic-dark", weight: .35 }]
    const before = resolveMusicContext(base)
    base.song.aesthetic = { image: "atmospheric-depth", amount: 1 }
    const after = resolveMusicContext(base)
    expect(after.genre).toEqual(before.genre)
    expect(after.aesthetic.depth).toBeGreaterThan(before.aesthetic.depth)
    expect(after.aesthetic.layerTransparency).toBeGreaterThan(before.aesthetic.layerTransparency)
  })
})
