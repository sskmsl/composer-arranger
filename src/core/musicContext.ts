import type { ComposerProject } from "./project"
import { blendToward, resolveReferenceInfluence, type ResolvedReferenceInfluence } from "./referenceProfile"

export const GENRE_IDS = [
  "ethereal", "romantic-dark", "cinematic", "new-wave", "hollywood-sadcore",
  "ritual", "finale", "cool", "trip-hop", "neoclassical", "minimalism",
  "j-chanson", "hi-nrg", "dorian", "electronica", "sadcore-slowcore",
  "french-pop", "kayokyoku",
] as const
export type GenreId = (typeof GENRE_IDS)[number]
export type GenreKind = "style" | "mood" | "mode" | "dramaticRole"
export interface GenreWeight { id: GenreId; weight: number }
export interface AestheticSelection {
  image: "neutral" | "atmospheric-depth"
  amount: number
}

export const GENRE_LABELS: Record<GenreId, string> = {
  ethereal: "Ethereal", "romantic-dark": "Romantic Dark", cinematic: "Cinematic",
  "new-wave": "New Wave", "hollywood-sadcore": "Hollywood Sadcore", ritual: "Ritual",
  finale: "Finale", cool: "Cool", "trip-hop": "Trip-Hop", neoclassical: "Neoclassical",
  minimalism: "Minimalism", "j-chanson": "J-Chanson", "hi-nrg": "Hi-NRG",
  dorian: "Dorian", electronica: "Electronica", "sadcore-slowcore": "Sadcore / Slowcore",
  "french-pop": "French Pop", kayokyoku: "歌謡曲",
}

export const GENRE_KIND: Record<GenreId, GenreKind> = {
  ethereal: "mood", "romantic-dark": "mood", cinematic: "style",
  "new-wave": "style", "hollywood-sadcore": "mood", ritual: "dramaticRole",
  finale: "dramaticRole", cool: "mood", "trip-hop": "style", neoclassical: "style",
  minimalism: "style", "j-chanson": "style", "hi-nrg": "style", dorian: "mode",
  electronica: "style", "sadcore-slowcore": "style", "french-pop": "style",
  kayokyoku: "style",
}

export interface GenreTraits {
  rhythmDensity: number
  bassMovement: number
  phraseDensity: number
  decorationDensity: number
  repetition: number
  syncopation: number
  sustain: number
  space: number
  registerRange: number
  tension: number
  dynamicContrast: number
  harmonicDensity: number
}

export interface SoundImageTraits {
  timbreSoftness: number
  depth: number
  decay: number
  foregroundFocus: number
  textureDensity: number
  transientSoftness: number
  stereoDiffusion: number
  registerAir: number
  organicElectronicBalance: number
  darkLuminousBalance: number
  layerTransparency: number
}

const neutralGenre: GenreTraits = {
  rhythmDensity: .5, bassMovement: .5, phraseDensity: .5, decorationDensity: .5,
  repetition: .5, syncopation: .5, sustain: .5, space: .5, registerRange: .5,
  tension: .5, dynamicContrast: .5, harmonicDensity: .5,
}
const genre = (value: Partial<GenreTraits>): GenreTraits => ({ ...neutralGenre, ...value })

/** 完成パターンではなく、既存Generatorの判断を動かす正規化された傾向値。 */
const GENRE_TRAITS: Record<GenreId, GenreTraits> = {
  ethereal: genre({ rhythmDensity: .22, bassMovement: .28, phraseDensity: .28, decorationDensity: .28, repetition: .68, sustain: .83, space: .83, registerRange: .68, harmonicDensity: .55 }),
  "romantic-dark": genre({ rhythmDensity: .38, bassMovement: .58, phraseDensity: .47, decorationDensity: .35, repetition: .72, sustain: .67, space: .65, tension: .77, dynamicContrast: .58 }),
  cinematic: genre({ rhythmDensity: .48, bassMovement: .53, phraseDensity: .43, decorationDensity: .42, sustain: .75, space: .66, registerRange: .82, dynamicContrast: .83, harmonicDensity: .65 }),
  "new-wave": genre({ rhythmDensity: .76, bassMovement: .72, phraseDensity: .52, decorationDensity: .42, repetition: .81, syncopation: .69, sustain: .30, space: .37, dynamicContrast: .59 }),
  "hollywood-sadcore": genre({ rhythmDensity: .20, bassMovement: .36, phraseDensity: .33, decorationDensity: .24, repetition: .68, sustain: .88, space: .77, tension: .65, dynamicContrast: .74 }),
  ritual: genre({ rhythmDensity: .36, bassMovement: .19, phraseDensity: .24, decorationDensity: .18, repetition: .91, sustain: .88, space: .76, tension: .73, harmonicDensity: .25 }),
  finale: genre({ rhythmDensity: .65, bassMovement: .65, phraseDensity: .48, decorationDensity: .35, repetition: .75, sustain: .65, registerRange: .85, dynamicContrast: .90 }),
  cool: genre({ rhythmDensity: .57, bassMovement: .57, phraseDensity: .36, decorationDensity: .27, repetition: .67, syncopation: .72, space: .64, harmonicDensity: .36 }),
  "trip-hop": genre({ rhythmDensity: .42, bassMovement: .74, phraseDensity: .25, decorationDensity: .24, repetition: .88, syncopation: .78, sustain: .64, space: .72, tension: .66 }),
  neoclassical: genre({ rhythmDensity: .33, bassMovement: .51, phraseDensity: .57, decorationDensity: .38, repetition: .58, sustain: .72, space: .56, registerRange: .75, harmonicDensity: .73 }),
  minimalism: genre({ rhythmDensity: .37, bassMovement: .25, phraseDensity: .18, decorationDensity: .14, repetition: .94, syncopation: .30, sustain: .73, space: .85, harmonicDensity: .24 }),
  "j-chanson": genre({ rhythmDensity: .45, bassMovement: .58, phraseDensity: .40, decorationDensity: .33, repetition: .66, sustain: .62, space: .61, tension: .64, harmonicDensity: .65 }),
  "hi-nrg": genre({ rhythmDensity: .88, bassMovement: .81, phraseDensity: .42, decorationDensity: .31, repetition: .87, syncopation: .63, sustain: .22, space: .29, dynamicContrast: .73 }),
  dorian: genre({ rhythmDensity: .43, bassMovement: .41, phraseDensity: .38, decorationDensity: .22, repetition: .74, sustain: .67, space: .60, tension: .51, harmonicDensity: .31 }),
  electronica: genre({ rhythmDensity: .67, bassMovement: .62, phraseDensity: .40, decorationDensity: .34, repetition: .79, syncopation: .73, sustain: .43, space: .54 }),
  "sadcore-slowcore": genre({ rhythmDensity: .17, bassMovement: .20, phraseDensity: .27, decorationDensity: .13, repetition: .78, sustain: .85, space: .87, dynamicContrast: .36, harmonicDensity: .35 }),
  "french-pop": genre({ rhythmDensity: .52, bassMovement: .53, phraseDensity: .43, decorationDensity: .35, repetition: .76, syncopation: .54, sustain: .58, space: .62, tension: .59, harmonicDensity: .60 }),
  kayokyoku: genre({ rhythmDensity: .58, bassMovement: .62, phraseDensity: .49, decorationDensity: .37, repetition: .79, sustain: .51, space: .45, dynamicContrast: .75, harmonicDensity: .58 }),
}

const neutralImage: SoundImageTraits = {
  timbreSoftness: .5, depth: .5, decay: .5, foregroundFocus: .5,
  textureDensity: .5, transientSoftness: .5, stereoDiffusion: .5, registerAir: .5,
  organicElectronicBalance: .5, darkLuminousBalance: .5, layerTransparency: .5,
}
const atmosphericImage: SoundImageTraits = {
  timbreSoftness: .77, depth: .87, decay: .86, foregroundFocus: .74,
  textureDensity: .39, transientSoftness: .78, stereoDiffusion: .84, registerAir: .73,
  organicElectronicBalance: .54, darkLuminousBalance: .48, layerTransparency: .82,
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) }

export function normalizeGenreBlend(source: readonly GenreWeight[]): GenreWeight[] {
  const combined = new Map<GenreId, number>()
  for (const entry of source) {
    if (!GENRE_IDS.includes(entry.id) || !Number.isFinite(entry.weight) || entry.weight <= 0) continue
    combined.set(entry.id, (combined.get(entry.id) ?? 0) + entry.weight)
  }
  const total = [...combined.values()].reduce((sum, weight) => sum + weight, 0)
  return total > 0 ? [...combined].map(([id, weight]) => ({ id, weight: weight / total })) : []
}

export interface ResolvedMusicContext {
  genres: GenreWeight[]
  genre: GenreTraits
  aesthetic: SoundImageTraits
  /** Genre か Reference のどちらかが傾向値を動かしているか(どちらも無ければ従来どおり中立) */
  styleActive: boolean
  /** 参考曲から抽象化した参考値(旋律・感情の弧など、傾向値へ畳み込めないもの)。無ければ null */
  reference: ResolvedReferenceInfluence | null
}

/**
 * Reference は Genre / Aesthetic より下の層。明示的な Genre や音像の選択があるときは、
 * そちらを優先して参考値へ近づける割合を半分にする。
 */
const REFERENCE_UNDER_EXPLICIT = .5

function applyReferenceToGenre(traits: GenreTraits, reference: ResolvedReferenceInfluence, explicit: boolean): boolean {
  const scale = explicit ? REFERENCE_UNDER_EXPLICIT : 1
  let changed = false
  const pull = (key: keyof GenreTraits, value: number, strength: number) => {
    traits[key] = blendToward(traits[key], value, strength * scale)
    changed = true
  }
  if (reference.rhythm) {
    const { traits: rhythm, strength } = reference.rhythm
    pull("rhythmDensity", rhythm.density, strength)
    pull("syncopation", rhythm.syncopation, strength)
    pull("repetition", rhythm.grooveTendency, strength * .5)
  }
  if (reference.bass) pull("bassMovement", reference.bass.traits.bassMovement, reference.bass.strength)
  if (reference.harmony) {
    const { traits: harmony, strength } = reference.harmony
    pull("tension", harmony.tension, strength)
    pull("harmonicDensity", harmony.harmonicRhythm, strength)
  }
  if (reference.arrangement) {
    const { traits: arrangement, strength } = reference.arrangement
    pull("phraseDensity", arrangement.phraseFrequency, strength)
    pull("decorationDensity", arrangement.foregroundDensity, strength)
    pull("sustain", arrangement.backgroundSustain, strength)
    pull("space", 1 - arrangement.foregroundDensity, strength)
    pull("dynamicContrast", arrangement.sectionContrast, strength)
  }
  return changed
}

function applyReferenceToImage(image: SoundImageTraits, reference: ResolvedReferenceInfluence, explicitAmount: number) {
  if (!reference.aesthetic) return
  const { traits, strength } = reference.aesthetic
  const weight = strength * (1 - explicitAmount * (1 - REFERENCE_UNDER_EXPLICIT))
  // 楽器を足すのではなく、いまある音の距離・余韻・立ち上がり・密度を動かす値だけに畳み込む
  image.depth = blendToward(image.depth, traits.depth, weight)
  image.decay = blendToward(image.decay, traits.decay, weight)
  image.transientSoftness = blendToward(image.transientSoftness, traits.transientSoftness, weight)
  image.timbreSoftness = blendToward(image.timbreSoftness, traits.transientSoftness, weight * .5)
  image.stereoDiffusion = blendToward(image.stereoDiffusion, traits.stereoDiffusion, weight)
  image.darkLuminousBalance = blendToward(image.darkLuminousBalance, traits.darkLuminousBalance, weight)
  image.textureDensity = blendToward(image.textureDensity, traits.textureDensity, weight)
  image.layerTransparency = blendToward(image.layerTransparency, 1 - traits.textureDensity, weight)
  image.foregroundFocus = blendToward(image.foregroundFocus, .5 + (traits.depth - .5) * .5, weight)
}

export function resolveMusicContext(project: ComposerProject, sectionId?: string): ResolvedMusicContext {
  void sectionId
  // 旧Song Profileは従来の判断経路で維持する。明示Genreだけを追加Contextにする。
  const genres = normalizeGenreBlend(project.song.genreBlend ?? [])
  const genreTraits = { ...neutralGenre }
  if (genres.length > 0) {
    for (const key of Object.keys(genreTraits) as (keyof GenreTraits)[]) {
      genreTraits[key] = genres.reduce((sum, item) => sum + GENRE_TRAITS[item.id][key] * item.weight, 0)
    }
  }
  const selection = project.song.aesthetic
  const amount = selection?.image === "atmospheric-depth" ? clamp01(selection.amount) : 0
  const aesthetic = { ...neutralImage }
  for (const key of Object.keys(aesthetic) as (keyof SoundImageTraits)[]) {
    aesthetic[key] = neutralImage[key] * (1 - amount) + atmosphericImage[key] * amount
  }
  const reference = resolveReferenceInfluence(project.song.referenceProfiles ?? [], project.song.referenceInfluences ?? [])
  const referenceShapesStyle = reference ? applyReferenceToGenre(genreTraits, reference, genres.length > 0) : false
  if (reference) applyReferenceToImage(aesthetic, reference, amount)
  return { genres, genre: genreTraits, aesthetic, styleActive: genres.length > 0 || referenceShapesStyle, reference }
}

/** 音像(Aesthetic)が中立から動いているか。明示の選択か、参考曲の音像のどちらか */
export function hasActiveSoundImage(project: ComposerProject): boolean {
  return project.song.aesthetic?.image === "atmospheric-depth" && project.song.aesthetic.amount > 0
    || (project.song.referenceInfluences ?? []).some((setting) => setting.targets.aesthetic !== undefined)
}
