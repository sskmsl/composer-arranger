/**
 * 「刻みと跳躍」: 同じ音を小刻みに打ってから伸ばす「刻み」と、主音・属音を柱にした 4度・5度の跳躍で作る旋律。
 *
 * 利用者の録音(My_Recording_3)から、音の並びではなく原理だけを取り出した(録音の音列は保存していない):
 *   - 同音の刻みのかたまりが 8小節に 3〜4 回(標準の作り方は 0.1 回)
 *   - 動く音程の約3割が 4度・5度の跳躍で、主音と属音を行き来する
 *   - 半音上から柱の音へ下りる「ため息」が要所にだけある
 *   - 使う音は主音から属音までの5音が中心で、フレーズの後ろは休む
 *
 * 生成順序: 柱の音(主音・属音・上の主音・9度)を決める → 核のフレーズ(刻み→跳躍→伸ばし)を1つ作る →
 * フレーズごとの役割で1か所だけ変える(語尾をため息に / 柱を上げる / 一段高い頂点) → 和音に使えない柱だけ近い構成音へ逃がす。
 * コードが変わっても柱の音は保ち、響きの意味だけを変える(保続音の考え方)。
 */
import type { SeededRandom } from "@/core/rng"
import type { CandidateMelodyDNA, MelodyNote, MelodyOpeningPlan } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { allUsablePitchClasses, chordTonePitchClasses } from "@/core/chord"
import { pitchClass } from "@/core/note"
import { parseKey } from "@/core/scale"
import { chordAtBeat, type HarmonicMapEntry } from "./harmonicMap"
import type { RangeSetting } from "./generationParams"
import { nearestAllowedPitch } from "./pitchUtils"
import { emotionalTargetFraction } from "./emotionalArc"

/** 柱の音(主音からの半音数) */
const TONIC = 0
const DOMINANT = 7
const UPPER_TONIC = 12
const NINTH = 14

type PhraseRole = "hook" | "answer" | "develop" | "return" | "rise" | "climax"

interface Cell {
  /** 柱の音(主音からの半音数) */
  pillar: number
  /** 刻みの回数(最後の1音は伸ばす) */
  pulses: number
  /** 最後の音を伸ばす長さ(拍) */
  hold: number
  /** 柱へ半音(または全音)上から下りるため息を前に置くか */
  sigh?: boolean
  /** 柱を伸ばした後、音階を何歩たどって着地するか(符号が向き)。刻み・跳躍の間をつなぐ順次の動き */
  walk?: number
}

interface PhraseShape {
  entry: number
  cells: Cell[]
}

export interface PulseLeapPlan {
  tonicMidi: number
  pulseBeats: number
  roles: PhraseRole[]
}

function phraseRoles(count: number, sectionRole: SectionRole): PhraseRole[] {
  if (count <= 1) return ["hook"]
  if (count === 2) return ["hook", "answer"]
  if (count === 3) return ["hook", "answer", "return"]
  if (count <= 5) return ["hook", "answer", "develop", "return", "return"].slice(0, count) as PhraseRole[]
  // 長いセクション: 前半で核と応答を二度聴かせ、柱を一段ずつ上げて、セクションの感情の目標位置で頂点
  const climax = Math.min(count - 2, Math.max(3, Math.round(emotionalTargetFraction(sectionRole) * count)))
  return Array.from({ length: count }, (_, index): PhraseRole =>
    index === climax ? "climax"
      : index > climax ? (index === count - 1 ? "return" : "answer")
        : index >= 4 ? "rise"
          : (["hook", "answer", "hook", "answer"] as const)[index])
}

function hookShape(
  rng: SeededRandom,
  phraseBeats: number,
  pulseBeats: number,
  opening?: MelodyOpeningPlan,
  dna?: CandidateMelodyDNA,
): PhraseShape {
  // 入りは小節頭か、少し遅らせた裏から(録音でも拍の頭を外した入りが多い)
  const entry = dna?.rhythmGrammar === "syncopated" ? rng.pick([0.5, 0.75])
    : dna?.rhythmGrammar === "cyclic" ? 0
      : opening && opening.startBeatOffset <= 1 ? opening.startBeatOffset : rng.pick([0, 0.5, 0.75])
  const sustained = dna?.rhythmGrammar === "sustained"
  const holdFirst = sustained ? 2 : rng.pick([1, 1.5])
  const direction = opening?.initialDirection
  // 柱の順番: 属音から主音へ下りる5度 / 主音から属音へ上がる5度 / 上の主音から属音へ下りる4度
  const [firstPillar, secondPillar] = dna?.motifIdentity === "leap-recovery" || direction === "ascending"
    ? [TONIC, DOMINANT]
    : direction === "descending" && dna?.motifIdentity !== "repeated-cell"
      ? [UPPER_TONIC, DOMINANT]
      : [DOMINANT, rng.chance(0.65) ? TONIC : UPPER_TONIC]
  const first: Cell = { pillar: firstPillar, pulses: sustained ? 3 : rng.pick([2, 3, 3, 4, 5]), hold: holdFirst }
  // 2つ目の柱は短めに刻むか1音で受け、そこから音階を1〜2歩たどって内側へ着地する
  const walkDirection = secondPillar === TONIC ? 1 : -1
  const second: Cell = {
    pillar: secondPillar, pulses: rng.pick([1, 1, 2, 3]), hold: sustained ? 1.5 : 1,
    walk: walkDirection * rng.pick([1, 2, 2]),
  }
  const shape = { entry, cells: [first, second] }
  // フレーズの後ろに余白(1拍以上)を残す
  while (shapeLength(shape, pulseBeats) > phraseBeats - 1 && shape.cells.some((cell) => cell.pulses > 2 || cell.hold > 1 || Math.abs(cell.walk ?? 0) > 1)) {
    const walker = shape.cells.find((item) => Math.abs(item.walk ?? 0) > 1)
    const cell = shape.cells.find((item) => item.pulses > 2) ?? shape.cells.find((item) => item.hold > 1)
    if (cell && cell.pulses > 2) cell.pulses -= 1
    else if (walker) walker.walk = Math.sign(walker.walk!)
    else if (cell) cell.hold -= 0.5
  }
  return shape
}

const WALK_NOTE_BEATS = 0.5
const WALK_LANDING_BEATS = 1

function shapeLength(shape: PhraseShape, pulseBeats: number): number {
  return shape.entry + shape.cells.reduce((sum, cell) => sum + (cell.sigh ? 0.5 : 0) + (cell.pulses - 1) * pulseBeats + cell.hold
    + (cell.walk ? (Math.abs(cell.walk) - 1) * WALK_NOTE_BEATS + WALK_LANDING_BEATS : 0), 0)
}

/** 役割ごとに1か所だけ変える(核の刻みと入りは保つ) */
function varyShape(hook: PhraseShape, role: PhraseRole, architecture?: CandidateMelodyDNA["phraseArchitecture"]): PhraseShape {
  const cells = hook.cells.map((cell) => ({ ...cell }))
  switch (role) {
    case "answer":
      if (architecture === "asymmetric") {
        // 短く切って、余白で答える
        return { entry: hook.entry, cells: [{ ...cells[0], hold: cells[0].hold + 1 }] }
      }
      if (architecture === "balanced") {
        // 同じ刻みで、語尾だけ上の主音へ
        cells[cells.length - 1] = { ...cells[cells.length - 1], pillar: cells[cells.length - 1].pillar === UPPER_TONIC ? TONIC : UPPER_TONIC }
        break
      }
      // 語尾を、属音へ半音上から下りるため息に(小変形)
      cells[cells.length - 1] = { pillar: DOMINANT, pulses: 1, hold: cells[cells.length - 1].hold + 0.5, sigh: true }
      break
    case "develop":
      // 刻みはそのまま、最初の柱を上の主音へ上げ、属音へ4度で下りる(音程だけを変える発展)
      cells[0] = { ...cells[0], pillar: UPPER_TONIC }
      cells[1] = { ...cells[1], pillar: DOMINANT }
      break
    case "rise":
      cells[0] = { ...cells[0], pillar: UPPER_TONIC }
      break
    case "climax":
      // 9度まで上がってから属音へ下りる。頂点は一度だけ
      cells[0] = { ...cells[0], pillar: NINTH, hold: cells[0].hold + 0.5 }
      cells[1] = { ...cells[1], pillar: DOMINANT, sigh: true }
      break
    case "return":
      cells[cells.length - 1] = { ...cells[cells.length - 1], hold: cells[cells.length - 1].hold + 0.5 }
      break
    default:
      break
  }
  return { entry: hook.entry, cells }
}

function tonicPitchClass(key: string | undefined, harmonicMap: HarmonicMapEntry[]): { tonic: number; minor: boolean } {
  const parsed = key ? parseKey(key) : null
  if (parsed) return { tonic: parsed.rootPc, minor: parsed.isMinor }
  const first = harmonicMap[0]?.parsed
  if (!first) return { tonic: 0, minor: false }
  const minor = first.tones.some((tone) => (tone.pitchClass - first.rootPc + 12) % 12 === 3)
  return { tonic: first.rootPc, minor }
}

/** 柱(主音〜9度)が音域に収まる主音の高さ。収まらなければ上の主音まで */
function tonicMidiFor(tonic: number, range: RangeSetting, register?: MelodyOpeningPlan["intent"]["register"]): number {
  const candidates: number[] = []
  for (let midi = range.low - 12; midi <= range.high; midi++) {
    if (((midi % 12) + 12) % 12 === tonic && midi >= range.low && midi + UPPER_TONIC <= range.high) candidates.push(midi)
  }
  if (candidates.length === 0) {
    for (let midi = range.low; midi <= range.high; midi++) if (((midi % 12) + 12) % 12 === tonic) return midi
    return range.low
  }
  const withNinth = candidates.filter((midi) => midi + NINTH <= range.high)
  const pool = withNinth.length ? withNinth : candidates
  return register === "high" ? pool[pool.length - 1] : pool[0]
}

/** 音階に沿って1歩動かす */
function scaleStep(pitch: number, direction: number, scale: readonly number[]): number {
  for (let semitones = 1; semitones <= 2; semitones++) {
    const candidate = pitch + direction * semitones
    if (scale.includes(((candidate % 12) + 12) % 12)) return candidate
  }
  return pitch + direction * 2
}

export function generatePulseLeapPattern(
  rng: SeededRandom,
  harmonicMap: HarmonicMapEntry[],
  totalBeats: number,
  range: RangeSetting,
  noteDensity: number,
  sectionRole: SectionRole,
  key?: string,
  opening?: MelodyOpeningPlan,
  dna?: CandidateMelodyDNA,
): { notes: MelodyNote[]; plan: PulseLeapPlan } {
  const { tonic, minor } = tonicPitchClass(key, harmonicMap)
  const tonicMidi = tonicMidiFor(tonic, range, opening?.intent.register)
  const phraseBeats = totalBeats >= 16 ? 8 : 4
  const pulseBeats = dna?.rhythmGrammar === "sustained" || noteDensity < 0.4 ? 0.5 : 0.25
  const count = Math.max(1, Math.floor(totalBeats / phraseBeats))
  const roles = phraseRoles(count, sectionRole)
  const hook = hookShape(rng, phraseBeats, pulseBeats, opening, dna)
  const notes: MelodyNote[] = []
  const sighStep = minor ? 1 : 2
  const scale = (minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((step) => (tonic + step) % 12)

  const pitchFor = (pillar: number, beat: number) => {
    let pitch = tonicMidi + pillar
    if (pitch > range.high) pitch -= 12
    const entry = chordAtBeat(harmonicMap, beat)
    if (!entry) return pitch
    // 柱の音がその和音で使えるなら保つ(響きの意味だけが変わる)。使えないときだけ近い構成音へ
    if (allUsablePitchClasses(entry.parsed).includes(pitchClass(pitch))) return pitch
    return nearestAllowedPitch(pitch, chordTonePitchClasses(entry.parsed), range)
  }

  roles.forEach((role, phraseIndex) => {
    const phraseStart = phraseIndex * phraseBeats
    const phraseEnd = Math.min(totalBeats, phraseStart + phraseBeats)
    const shape = role === "hook" ? hook : varyShape(hook, role, dna?.phraseArchitecture)
    let cursor = phraseStart + shape.entry
    for (const cell of shape.cells) {
      if (cursor >= phraseEnd - 0.25) break
      const target = pitchFor(cell.pillar, cursor)
      if (cell.sigh && cursor + 0.5 < phraseEnd) {
        // 半音(長調なら全音)上から寄りかかって柱へ下りる
        const upper = Math.min(range.high, target + sighStep)
        notes.push({
          id: crypto.randomUUID(), startBeat: cursor, durationBeats: 0.5, pitch: upper, velocity: 80, locks: [],
          plannedToneRole: "appoggiatura",
          plannedResolution: { targetPitchClass: pitchClass(target), targetBeat: cursor + 0.5, maximumDelayBeats: 0.5 },
        })
        cursor += 0.5
      }
      for (let pulse = 0; pulse < cell.pulses; pulse++) {
        const last = pulse === cell.pulses - 1
        const duration = Math.min(last ? cell.hold : pulseBeats, phraseEnd - cursor)
        if (duration < 0.2) break
        notes.push({
          id: crypto.randomUUID(), startBeat: cursor, durationBeats: duration, pitch: target,
          velocity: pulse === 0 ? 86 : last ? 78 : 70 + rng.intBetween(0, 6), locks: [],
          plannedToneRole: chordAtBeat(harmonicMap, cursor) && chordTonePitchClasses(chordAtBeat(harmonicMap, cursor)!.parsed).includes(pitchClass(target))
            ? "chord-tone" : "tension-hold",
        })
        cursor += duration
      }
      if (cell.walk) {
        // 音階を1歩ずつたどって着地(順次の動き)。最後の音は少し伸ばす
        let pitch = target
        const steps = Math.abs(cell.walk)
        for (let step = 0; step < steps; step++) {
          const last = step === steps - 1
          const duration = Math.min(last ? WALK_LANDING_BEATS : WALK_NOTE_BEATS, phraseEnd - cursor)
          if (duration < 0.25) break
          pitch = scaleStep(pitch, Math.sign(cell.walk), scale)
          const entry = chordAtBeat(harmonicMap, cursor)
          const fits = !entry || allUsablePitchClasses(entry.parsed).includes(pitchClass(pitch))
          notes.push({
            id: crypto.randomUUID(), startBeat: cursor, durationBeats: duration, pitch: fits || !last ? pitch : nearestAllowedPitch(pitch, chordTonePitchClasses(entry!.parsed), range),
            velocity: 72, locks: [], plannedToneRole: fits ? "chord-tone" : last ? "chord-tone" : "passing-tone",
          })
          cursor += duration
        }
      }
    }
  })
  // 音域の端では、はみ出した音だけオクターブで内側へ戻す(形は保つ)
  for (const note of notes) {
    while (note.pitch > range.high && note.pitch - 12 >= range.low) note.pitch -= 12
    while (note.pitch < range.low && note.pitch + 12 <= range.high) note.pitch += 12
    note.pitch = Math.max(range.low, Math.min(range.high, note.pitch))
  }
  return { notes, plan: { tonicMidi, pulseBeats, roles } }
}
