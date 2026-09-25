import type { MelodyNote } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { keyScalePitchClasses } from "@/core/scale"
import { isChordTone, isTensionTone } from "@/core/chord"
import { chordAtBeat, type HarmonicMapEntry } from "./harmonicMap"
import type { RangeSetting } from "./generationParams"
import { measureMelodyCraft } from "./melodyCraftMetrics"
import { classicalLikeness, type ClassicalModels } from "./classicalLikeness"

/**
 * 推敲: 古典らしさ(古典=100)に近づくよう、音を1つずつ置き換えてみて、点が上がる変更だけを残す。
 * 目標は上限100で止まる点数ではなく、物差しの組み合わせの分布の高さ(古典の中心への近さ)。
 * 1曲ずつは「ふつうの古典」に届いていても、ジグザグ・同じ音への戻りのように古典の中心から外れた癖が残るため、
 * 100 に届いた後も中心へ寄せ続ける。
 *
 * 置き換えてよいのは、拍頭ならコードの音、裏拍ならテンションか、次の音へ1〜2半音で進む音階の音(経過音)だけ。
 * 冒頭の1小節・手で固定した音・表情として置いた音(掛留・倚音など)とその解決先・最後の音・サビの頂点、
 * コードが変わる所で導音が主音へ・属七の7度が下へ解決している音には触らない。
 * 選んだ音域からも出さない。1音あたり上下4半音までしか動かさないので、旋律の形(輪郭とリズム)は保たれる。
 */

const EXPRESSIVE_ROLES = new Set<MelodyNote["plannedToneRole"]>([
  "approach-tone", "appoggiatura", "suspension", "anticipation", "tension-hold", "unresolved-conflict",
])
const CLIMAX_ROLES = new Set<SectionRole>(["chorus", "grand-chorus", "breakdown-chorus"])
const pc = (pitch: number) => ((pitch % 12) + 12) % 12
/** 分布の高さ(対数)がこれ以上上がる変更だけを残す */
const MINIMUM_GAIN = 0.02

export interface ClassicalRefinementContext {
  harmonicMap: HarmonicMapEntry[]
  range: RangeSetting
  totalBeats: number
  sectionRole: SectionRole
  key?: string
  models: ClassicalModels
  /** 何周まで試すか */
  passes?: number
}

export function refineTowardClassical(source: MelodyNote[], context: ClassicalRefinementContext): { notes: MelodyNote[]; before: number; after: number } {
  const notes = source.map((note) => ({ ...note })).sort((a, b) => a.startBeat - b.startBeat)
  const key = context.key
  if (!key || notes.length < 4 || context.harmonicMap.length === 0) {
    return { notes, before: 0, after: 0 }
  }
  const chords = context.harmonicMap.map((entry) => entry.chord)
  const scale = keyScalePitchClasses(key)
  const score = (list: MelodyNote[]) => classicalLikeness(measureMelodyCraft(list, chords, key), context.models).logDensity

  const entryAt = (beat: number) => chordAtBeat(context.harmonicMap, beat)
  const chordTone = (beat: number, pitch: number) => {
    const entry = entryAt(beat)
    return entry ? isChordTone(entry.parsed, pc(pitch)) : false
  }
  const tension = (beat: number, pitch: number) => {
    const entry = entryAt(beat)
    return entry ? isTensionTone(entry.parsed, pc(pitch)) : false
  }
  const strong = (beat: number) => Math.abs((Math.round(beat * 4) / 4) % 2) < 1e-6
  const openingEnd = Math.min(4, context.totalBeats / 4)
  const resolutionBeats = notes.flatMap((note) =>
    note.plannedResolution && EXPRESSIVE_ROLES.has(note.plannedToneRole) ? [note.plannedResolution.targetBeat] : [])
  const peak = Math.max(...notes.map((note) => note.pitch))
  // 導音→主音、属七の7度→下への解決(コードが変わる所)は、古典の基本として推敲で崩さない
  const tonic = scale[0]
  const tendencyResolutions = new Set<number>()
  for (let index = 1; index < notes.length; index += 1) {
    const previous = notes[index - 1]
    const note = notes[index]
    const previousEntry = entryAt(previous.startBeat)
    const entry = entryAt(note.startBeat)
    if (tonic === undefined || !previousEntry || !entry || previousEntry === entry || previousEntry.parsed.rootPc !== (tonic + 7) % 12) continue
    if (note.startBeat - (previous.startBeat + previous.durationBeats) > 1.5) continue
    const leadingTone = pc(previous.pitch) === (tonic + 11) % 12 && pc(note.pitch) === tonic
    const seventh = pc(previous.pitch) === (tonic + 5) % 12 && previous.pitch - note.pitch >= 1 && previous.pitch - note.pitch <= 2
    if (leadingTone || seventh) {
      tendencyResolutions.add(index)
      tendencyResolutions.add(index - 1)
    }
  }
  const editable = (index: number) => {
    const note = notes[index]
    if (tendencyResolutions.has(index)) return false
    if (index === notes.length - 1 || note.startBeat < openingEnd - 1e-6 || note.locks.includes("pitch")) return false
    if (EXPRESSIVE_ROLES.has(note.plannedToneRole)) return false
    if (resolutionBeats.some((beat) => Math.abs(beat - note.startBeat) < 1e-6)) return false
    if (CLIMAX_ROLES.has(context.sectionRole) && note.pitch === peak) return false
    return true
  }

  /** index の音を pitch にするときの役割(置けないなら null) */
  const roleFor = (index: number, pitch: number): Pick<MelodyNote, "plannedToneRole" | "plannedResolution"> | null => {
    const note = notes[index]
    if (pitch < context.range.low || pitch > context.range.high) return null
    if (chordTone(note.startBeat, pitch)) return { plannedToneRole: "chord-tone", plannedResolution: undefined }
    if (strong(note.startBeat)) return null
    const previous = notes[index - 1]
    const next = notes[index + 1]
    const nearNeighbours = (!previous || Math.abs(pitch - previous.pitch) <= 2) && (!next || Math.abs(next.pitch - pitch) <= 2)
    if (tension(note.startBeat, pitch) && nearNeighbours) return { plannedToneRole: "tension-hold", plannedResolution: undefined }
    // 経過音: 音階の音で、すぐ後のコードの音へ1〜2半音で進む
    if (next && scale.includes(pc(pitch)) && Math.abs(next.pitch - pitch) >= 1 && Math.abs(next.pitch - pitch) <= 2
      && next.startBeat - (note.startBeat + note.durationBeats) <= 0.5 && chordTone(next.startBeat, next.pitch)) {
      return {
        plannedToneRole: "approach-tone",
        plannedResolution: { targetPitchClass: pc(next.pitch), targetBeat: next.startBeat, maximumDelayBeats: next.startBeat - note.startBeat },
      }
    }
    return null
  }

  const before = score(notes)
  let current = before
  for (let pass = 0; pass < (context.passes ?? 5); pass += 1) {
    let improved = false
    for (let index = 1; index < notes.length - 1; index += 1) {
      if (!editable(index)) continue
      const original = notes[index]
      let best: { pitch: number; role: Pick<MelodyNote, "plannedToneRole" | "plannedResolution">; score: number } | null = null
      for (const offset of [-4, -3, -2, -1, 1, 2, 3, 4]) {
        const pitch = original.pitch + offset
        const role = roleFor(index, pitch)
        if (!role) continue
        notes[index] = { ...original, pitch, ...role }
        const candidate = score(notes)
        if (!best || candidate > best.score) best = { pitch, role, score: candidate }
      }
      notes[index] = original
      // わずかな差では動かさない(元の旋律の設計を優先する)
      if (best && best.score > current + MINIMUM_GAIN) {
        notes[index] = { ...original, pitch: best.pitch, ...best.role }
        if (!best.role.plannedResolution) delete notes[index].plannedResolution
        current = best.score
        improved = true
      }
    }
    if (!improved) break
  }
  return { notes, before, after: current }
}
