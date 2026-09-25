import type { MelodyGeneratorProfile, MelodyNote } from "@/core/melody"
import type { SectionRole } from "@/core/section"
import { keyScalePitchClasses } from "@/core/scale"
import { isChordTone, isTensionTone } from "@/core/chord"
import { chordAtBeat, type HarmonicMapEntry } from "./harmonicMap"
import type { RangeSetting } from "./generationParams"

/**
 * 生成した主旋律の仕上げ。旋律の作り方の基本に沿って、次の点だけを直す。
 *
 * 00. サビは旋律全体を音階の上で3度(入らなければ2度)上げ、Aメロは2度下げて、セクションの高さに差を付ける。
 *     音程の並び(形)はそのまま保つので、Hookや冒頭の設計は崩れない。選んだ音域からは出さない
 * 0. 前のフレーズとほぼ同じ高さで繰り返すフレーズは、音階の上で1〜2段ずらす(反復進行)。同じ3〜4音の中を回り続けないように
 * 1. 同じ音の3連打以上は、間の音を隣の音へ動かす(語りの作り方=speech-rhythmic・incantatoryは除く)
 * 2. 5半音以上跳んだら、次の音は逆向きへ3半音以内で戻る(跳躍の回収)
 * 3. サビは後半に、ほかより高い頂点を1つ作る
 * 4. セクションの終わりはコードの音で、サビ・アウトロは主音で落ち着いて終わる
 *
 * あわせて、クラシックの旋律づくりで基本とされる次の点も整える(特定の曲の型ではなく、一般的な原則として)。
 * 4b. 順次進行でつなぐ: 実在の旋律(民謡・コラール)に比べて跳躍が多すぎるので、跳躍の間にある裏拍の音を
 *     前後を1〜2半音でつなぐ音(経過音)に替え、3度の動きの前の長い音は末尾を経過音に分ける
 * 5. ベースとの関係: 拍頭で旋律とベースが同じ向きに動いて5度・8度が続く所(平行5度・8度)を、別のコードの音にする
 * 6. 向かう先を持つ音: 属和音の導音はコードが変わったら主音へ上がり、属七の7度は1〜2半音下がる
 * 7. 問いと答え: 16拍以上のセクションは、前半の終わりを主音以外の音にして「開いた」まま後半へつなぐ
 * 8. ため息: セクション中に1か所だけ、長い音の頭を1段上の音から下がって入る形(倚音)にする
 *
 * 拍頭(1・3拍目)はコードの音だけ、裏拍は前後と2半音以内でつながるならテンションも使う(解決の要る非和声音は作らない)。
 * 作り方ごとに意図して置いた音(経過音・掛留・先取り・テンションなど)と、その解決先には触らない。
 * 選んだ音域の外にも出さない。
 */

export interface MelodicCraftContext {
  harmonicMap: HarmonicMapEntry[]
  range: RangeSetting
  totalBeats: number
  sectionRole: SectionRole
  profile?: MelodyGeneratorProfile
  key?: string
}

const pc = (pitch: number) => ((pitch % 12) + 12) % 12
type CraftStep = "lift" | "sequence" | "repeats" | "variety" | "arch" | "leapRecovery" | "climax"
  | "conjunct" | "counterpoint" | "tendency" | "antecedent" | "sigh"

/**
 * 作り方ごとに使う仕上げ。独自の設計(跳躍・半音の動き・掛留・語りの連打・動かない美しさ)を持つ作り方には、
 * その設計とぶつかる仕上げをかけない。終わり方(コードの音・主音で終わる)はすべての作り方に使う。
 */
const PROFILE_STEPS: Record<MelodyGeneratorProfile, readonly CraftStep[]> = {
  standard: ["lift", "sequence", "repeats", "variety", "arch", "leapRecovery", "climax", "conjunct", "counterpoint", "tendency", "antecedent", "sigh"],
  cinematic: ["lift", "sequence", "repeats", "variety", "arch", "leapRecovery", "climax", "conjunct", "counterpoint", "tendency", "antecedent", "sigh"],
  rhythmic: ["lift", "repeats", "variety", "arch", "leapRecovery", "climax", "conjunct", "counterpoint", "tendency", "antecedent"],
  minimal: ["lift", "repeats", "leapRecovery", "climax", "conjunct", "counterpoint", "tendency", "antecedent"],
  leaping: ["climax"],
  chromatic: [],
  "elegiac-cantabile": ["leapRecovery", "climax", "counterpoint", "tendency"],
  "speech-rhythmic": ["leapRecovery"],
  incantatory: [],
}
/** セクションの高さの寄せ方(音階の段数)。サビは3度上、Bメロは2度上、Aメロは2度下 */
const LIFT_STEPS: Partial<Record<SectionRole, number>> = {
  chorus: 2,
  "grand-chorus": 2,
  "pre-chorus": 1,
  verse: -1,
}
/** サビのHookは同じ形で戻ってくることが大事なので、サビではフレーズ全体を動かす仕上げはしない */
const HOOK_SENSITIVE_STEPS = new Set<CraftStep>(["sequence", "variety", "arch"])
/** 作り方が表情として置いた音。これとその解決先には触らない(普通の経過音・刺繍音は直してよい) */
const EXPRESSIVE_ROLES = new Set<MelodyNote["plannedToneRole"]>([
  "approach-tone", "appoggiatura", "suspension", "anticipation", "tension-hold", "unresolved-conflict",
])
const CLIMAX_ROLES = new Set<SectionRole>(["chorus", "grand-chorus", "breakdown-chorus"])
const RESOLVING_ROLES = new Set<SectionRole>(["chorus", "grand-chorus", "breakdown-chorus", "outro"])

/** 休み(0.75拍以上)で区切ったフレーズ。休みがなければ2小節ずつ(短いセクションは半分)に分ける */
function splitPhrases(notes: MelodyNote[], totalBeats: number): number[][] {
  const phrases: number[][] = [[]]
  notes.forEach((note, index) => {
    const previous = notes[index - 1]
    if (previous && note.startBeat - (previous.startBeat + previous.durationBeats) >= 0.75) phrases.push([])
    phrases[phrases.length - 1].push(index)
  })
  const nonEmpty = phrases.filter((phrase) => phrase.length > 0)
  if (nonEmpty.length > 1) return nonEmpty
  const size = totalBeats >= 16 ? 8 : totalBeats / 2
  const chunks: number[][] = []
  notes.forEach((note, index) => {
    const chunk = Math.floor(note.startBeat / size)
    ;(chunks[chunk] ??= []).push(index)
  })
  return chunks.filter((phrase) => phrase && phrase.length > 0)
}

/** 音階の上で steps 段動かした音(音階外の音は、近い音階の音から数える) */
function moveInScale(pitch: number, steps: number, scale: number[]): number {
  let current = pitch
  while (!scale.includes(((current % 12) + 12) % 12)) current -= 1
  let remaining = Math.abs(steps)
  const direction = Math.sign(steps)
  while (remaining > 0) {
    current += direction
    if (scale.includes(((current % 12) + 12) % 12)) remaining -= 1
  }
  return current
}

export function applyMelodicCraft(sourceNotes: MelodyNote[], context: MelodicCraftContext): MelodyNote[] {
  const notes = [...sourceNotes].map((note) => ({ ...note })).sort((a, b) => a.startBeat - b.startBeat)
  if (notes.length < 3) return notes
  const scale = context.key ? keyScalePitchClasses(context.key) : []
  const tonic = scale[0]
  const steps = new Set(context.profile ? PROFILE_STEPS[context.profile] : PROFILE_STEPS.standard)
  if (CLIMAX_ROLES.has(context.sectionRole)) for (const step of HOOK_SENSITIVE_STEPS) steps.delete(step)
  // 冒頭(最初の1小節)は候補ごとの入り方の設計なので触らない
  const openingEnd = Math.min(4, context.totalBeats / 4)
  const low = context.range.low
  const high = context.range.high

  const chordPcs = (beat: number) => {
    const entry = chordAtBeat(context.harmonicMap, beat)
    return entry ? entry.parsed.tones.filter((tone) => tone.role !== "tension").map((tone) => tone.pitchClass) : []
  }
  /** コードの音かテンション(後段のコード整合と同じ判定) */
  const usable = (beat: number) => {
    const entry = chordAtBeat(context.harmonicMap, beat)
    if (!entry) return []
    return Array.from({ length: 12 }, (_, value) => value).filter((value) => isChordTone(entry.parsed, value) || isTensionTone(entry.parsed, value))
  }
  const strong = (beat: number) => Math.abs((Math.round(beat * 4) / 4) % 2) < 1e-6
  // 解決先として予定されている拍(前の音が掛留・経過音などで、ここへ解決する)
  const resolutionBeats = new Set(notes.flatMap((note) =>
    note.plannedResolution && EXPRESSIVE_ROLES.has(note.plannedToneRole) ? [note.plannedResolution.targetBeat] : []))
  const expressive = (note: MelodyNote) => note.locks.includes("pitch") || EXPRESSIVE_ROLES.has(note.plannedToneRole)
    || [...resolutionBeats].some((beat) => Math.abs(beat - note.startBeat) < 1e-6)
  const locked = (note: MelodyNote) => note.startBeat < openingEnd - 1e-6 || expressive(note)

  /** index の音を pitch にしてよいか(拍頭はコードの音、裏拍は前後と滑らかにつながる音階の音) */
  const fits = (index: number, pitch: number): boolean => {
    if (pitch < low || pitch > high) return false
    const note = notes[index]
    if (chordPcs(note.startBeat).includes(pc(pitch))) return true
    if (strong(note.startBeat) || !usable(note.startBeat).includes(pc(pitch))) return false
    const previous = notes[index - 1]
    const next = notes[index + 1]
    return (!previous || Math.abs(pitch - previous.pitch) <= 2) && (!next || Math.abs(next.pitch - pitch) <= 2)
  }

  const setPitch = (index: number, pitch: number) => {
    const note = notes[index]
    note.pitch = pitch
    const chordTone = chordPcs(note.startBeat).includes(pc(pitch))
    // 裏拍のテンション(9th・13thなど)として置く。解決の要らない音なので後段のコード整合でも残る
    note.plannedToneRole = chordTone ? "chord-tone" : "tension-hold"
    delete note.plannedResolution
  }

  /** from から direction 向きに、minStep〜maxStep 半音離れた置ける音(近い順) */
  const candidatesFrom = (index: number, from: number, direction: 1 | -1, minStep: number, maxStep: number) => {
    const result: number[] = []
    for (let step = minStep; step <= maxStep; step += 1) {
      const pitch = from + direction * step
      if (fits(index, pitch)) result.push(pitch)
    }
    return result
  }

  // 00. セクションの高さ: サビは上へ、Aメロは下へ、旋律ごと音階の上で動かす
  const liftSteps = LIFT_STEPS[context.sectionRole]
  if (steps.has("lift") && liftSteps && scale.length === 7 && notes.every((note) => !note.locks.includes("pitch"))) {
    const direction = Math.sign(liftSteps)
    for (let amount = Math.abs(liftSteps); amount > 0; amount -= 1) {
      const moved = notes.map((note) => moveInScale(note.pitch, direction * amount, scale))
      if (Math.max(...moved) > high || Math.min(...moved) < low) continue
      const original = notes.map((note) => note.pitch)
      notes.forEach((note, index) => {
        // 表情の音(経過・掛留・倚音・先取り)は、あとで解決先と同じ半音数だけ動かす
        if (EXPRESSIVE_ROLES.has(note.plannedToneRole)) return
        let pitch = moved[index]
        const chord = chordPcs(note.startBeat)
        const keep = chord.includes(pc(pitch)) || (!strong(note.startBeat) && usable(note.startBeat).includes(pc(pitch)))
        if (!keep) {
          // コードの音へ寄せるとき、前の音との音程がなるべく元と同じになる音を選ぶ(形を崩さない)
          const previousNew = index > 0 ? notes[index - 1].pitch : null
          const wantedInterval = index > 0 ? original[index] - original[index - 1] : 0
          const options = [-3, -2, -1, 1, 2, 3].map((offset) => pitch + offset)
            .filter((candidate) => candidate >= low && candidate <= high && chord.includes(pc(candidate)))
            // 元は動いていた所で、前の音と同じ高さにしない(連打を作らない)
            .filter((candidate, _, all) => wantedInterval === 0 || candidate !== previousNew || all.length === 1)
            .sort((a, b) => previousNew === null
              ? Math.abs(a - pitch) - Math.abs(b - pitch)
              : Math.abs(a - previousNew - wantedInterval) - Math.abs(b - previousNew - wantedInterval))
          if (options.length > 0) pitch = options[0]
        }
        note.pitch = pitch
        note.plannedToneRole = chord.includes(pc(pitch)) ? "chord-tone" : "tension-hold"
        if (note.plannedToneRole === "chord-tone") delete note.plannedResolution
      })
      notes.forEach((note, index) => {
        if (!EXPRESSIVE_ROLES.has(note.plannedToneRole)) return
        const targetIndex = note.plannedResolution
          ? notes.findIndex((candidate) => Math.abs(candidate.startBeat - note.plannedResolution!.targetBeat) < 1e-6)
          : index + 1
        const target = notes[targetIndex]
        const shift = target && !EXPRESSIVE_ROLES.has(target.plannedToneRole) ? target.pitch - original[targetIndex] : moved[index] - original[index]
        note.pitch = original[index] + shift
        if (note.plannedResolution && target) note.plannedResolution = { ...note.plannedResolution, targetPitchClass: pc(target.pitch) }
        // 解決先のない表情音が、動かした先でコードにもテンションにも合わなくなったら、近いコードの音にする
        const outside = note.pitch < low || note.pitch > high
        if (outside || (!note.plannedResolution && !usable(note.startBeat).includes(pc(note.pitch)))) {
          const chord = chordPcs(note.startBeat)
          const nearest = [0, -1, 1, -2, 2, -3, 3].map((offset) => note.pitch + offset)
            .find((pitch) => pitch >= low && pitch <= high && chord.includes(pc(pitch)))
          if (nearest !== undefined) setPitch(index, nearest)
        }
      })
      break
    }
  }

  // 0. 反復進行: 前のフレーズと同じ高さの繰り返しを、音階の上で少しずらす
  if (scale.length === 7 && steps.has("sequence")) {
    const phrases = splitPhrases(notes, context.totalBeats)
    const mean = (indexes: number[]) => indexes.reduce((sum, index) => sum + notes[index].pitch, 0) / indexes.length
    const originalMeans = phrases.map(mean)
    const originalSets = phrases.map((indexes) => new Set(indexes.map((index) => notes[index].pitch)))
    const climax = CLIMAX_ROLES.has(context.sectionRole)
    phrases.forEach((indexes, phraseIndex) => {
      if (phraseIndex === 0) return
      const previousSet = originalSets[phraseIndex - 1]
      const shared = [...originalSets[phraseIndex]].filter((pitch) => previousSet.has(pitch)).length / Math.max(1, originalSets[phraseIndex].size)
      if (Math.abs(originalMeans[phraseIndex] - originalMeans[phraseIndex - 1]) >= 1.5 || shared < 0.6) return
      // サビは頂点へ向かって段々上げる。それ以外は1つおきに1段上げる(A→A'→A→A')
      const steps = climax ? Math.min(2, phraseIndex) : phraseIndex % 2 === 1 ? 1 : 0
      if (steps === 0) return
      for (const index of indexes) {
        if (locked(notes[index])) continue
        const moved = moveInScale(notes[index].pitch, steps, scale)
        const options = [moved, moved - 1, moved + 1, moved - 2, moved + 2].filter((pitch) => fits(index, pitch))
        if (options.length > 0) setPitch(index, options[0])
      }
    })
  }

  // 1. 同音の3連打以上をほどく
  if (steps.has("repeats")) {
    let start = 0
    while (start < notes.length) {
      let end = start
      while (end + 1 < notes.length && notes[end + 1].pitch === notes[start].pitch
        && notes[end + 1].startBeat - (notes[end].startBeat + notes[end].durationBeats) < 1) end += 1
      if (end - start >= 2) {
        // 連打の後に向かう音の方向へ、間の音を動かす(なければ上へ)
        const after = notes[end + 1]
        const direction: 1 | -1 = after && after.pitch < notes[start].pitch ? -1 : 1
        for (let index = start + 1; index < end; index += 2) {
          if (locked(notes[index])) continue
          const base = notes[start].pitch
          const options = [...candidatesFrom(index, base, direction, 1, 4), ...candidatesFrom(index, base, direction === 1 ? -1 : 1, 1, 4)]
          if (options.length > 0) setPitch(index, options[0])
        }
      }
      start = end + 1
    }
  }

  // 1b. よく使う音(上位2つ)の連打は、裏拍側の音を隣の音へ動かし、同じ数音の中を回り続けないようにする
  if (steps.has("variety")) {
    const counts = new Map<number, number>()
    for (const note of notes) counts.set(note.pitch, (counts.get(note.pitch) ?? 0) + 1)
    const frequent = new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([pitch]) => pitch))
    for (let index = 1; index < notes.length - 1; index += 1) {
      const note = notes[index]
      const previous = notes[index - 1]
      if (note.pitch !== previous.pitch || !frequent.has(note.pitch) || strong(note.startBeat) || locked(note)) continue
      if (note.startBeat - (previous.startBeat + previous.durationBeats) >= 0.75) continue
      const next = notes[index + 1]
      // 次の音の方へ動く(次が同じ高さなら上へ)
      const direction: 1 | -1 = next.pitch < note.pitch ? -1 : 1
      const options = [...candidatesFrom(index, note.pitch, direction, 1, 3), ...candidatesFrom(index, note.pitch, direction === 1 ? -1 : 1, 1, 3)]
      if (options.length > 0) setPitch(index, options[0])
    }
  }

  // 1c. 3度の中を回り続けるフレーズに山を作る(フレーズの6割あたりの拍頭の音を、4半音以内で上のコードの音へ)
  if (steps.has("arch")) {
    for (const indexes of splitPhrases(notes, context.totalBeats)) {
      if (indexes.length < 4) continue
      const pitches = indexes.map((index) => notes[index].pitch)
      const phraseMax = Math.max(...pitches)
      // 音域が広いか、使う音が5種類以上あれば十分に動いている
      if (phraseMax - Math.min(...pitches) >= 7 || new Set(pitches).size >= 5) continue
      const startBeat = notes[indexes[0]].startBeat
      const endBeat = notes[indexes[indexes.length - 1]].startBeat
      const target = startBeat + (endBeat - startBeat) * 0.6
      const peak = indexes
        .filter((index) => strong(notes[index].startBeat) && !locked(notes[index]) && index !== indexes[indexes.length - 1])
        .sort((a, b) => Math.abs(notes[a].startBeat - target) - Math.abs(notes[b].startBeat - target))[0]
      if (peak === undefined) continue
      const options = candidatesFrom(peak, phraseMax, 1, 1, 4 - Math.max(0, phraseMax - notes[peak].pitch))
      if (options.length > 0) setPitch(peak, options[0])
    }
  }

  // 2. 跳躍の後は、逆向きへ戻る(なるべく1〜2半音の小さな動きで)。頂点づくりの後にもう一度かける
  const recoverLeaps = () => {
    for (let index = 0; steps.has("leapRecovery") && index + 2 < notes.length; index += 1) {
      const leap = notes[index + 1].pitch - notes[index].pitch
      if (Math.abs(leap) < 5) continue
      const target = notes[index + 2]
      const pivot = notes[index + 1]
      const next = target.pitch - pivot.pitch
      if (Math.sign(next) === -Math.sign(leap) && Math.abs(next) <= 3) continue
      // 次のフレーズに入っている(長い休みの後)なら回収しなくてよい
      if (target.startBeat - (pivot.startBeat + pivot.durationBeats) > 1.5 || locked(target)) continue
      const options = candidatesFrom(index + 2, pivot.pitch, leap > 0 ? -1 : 1, 1, 3)
      if (options.length > 0) setPitch(index + 2, options[0])
    }
  }
  recoverLeaps()

  // 3. サビは後半にはっきりした頂点を1つ作る
  if (CLIMAX_ROLES.has(context.sectionRole) && steps.has("climax")) {
    const currentMax = Math.max(...notes.map((note) => note.pitch))
    const windowNotes = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => note.startBeat >= context.totalBeats * 0.5 && note.startBeat <= context.totalBeats * 0.85
        && strong(note.startBeat) && note.durationBeats >= 0.75 && !locked(note))
    // もともと高い所にある音を選び、4半音以内の持ち上げで頂点にする(急な1オクターブの跳躍を作らない)
    const best = windowNotes
      .filter(({ note }) => currentMax - note.pitch <= 3)
      .sort((a, b) => b.note.pitch - a.note.pitch)[0]
    if (best && best.note.pitch <= currentMax) {
      const approach = notes[best.index - 1]
      const options = candidatesFrom(best.index, currentMax, 1, 1, 4 - (currentMax - best.note.pitch))
        .filter((pitch) => !approach || Math.abs(pitch - approach.pitch) <= 7)
      if (options.length > 0) {
        setPitch(best.index, options[0])
        // 頂点へ跳び上がったら、次の音で少し戻る
        const after = notes[best.index + 1]
        if (after && !locked(after) && !(after.pitch < options[0] && options[0] - after.pitch <= 3)) {
          const back = candidatesFrom(best.index + 1, options[0], -1, 1, 3)
          if (back.length > 0) setPitch(best.index + 1, back[0])
        }
      }
    }
  }

  const peakPitch = Math.max(...notes.map((note) => note.pitch))
  const isPeak = (index: number) => CLIMAX_ROLES.has(context.sectionRole) && notes[index].pitch === peakPitch
  const entryAt = (beat: number) => chordAtBeat(context.harmonicMap, beat)
  const lastIndexOf = notes.length - 1
  /** index の音を、元の高さに近いコードの音の中から accept を満たすものに替える(前後と7半音以内でつながる音) */
  const replaceWithChordTone = (index: number, accept: (pitch: number) => boolean, maxShift = 5) => {
    const note = notes[index]
    const previous = notes[index - 1]
    const next = notes[index + 1]
    const options: number[] = []
    for (let shift = 1; shift <= maxShift; shift += 1) {
      for (const pitch of [note.pitch - shift, note.pitch + shift]) {
        if (!fits(index, pitch) || !chordPcs(note.startBeat).includes(pc(pitch)) || !accept(pitch)) continue
        if (previous && Math.abs(pitch - previous.pitch) > 7) continue
        if (next && Math.abs(next.pitch - pitch) > 7) continue
        options.push(pitch)
      }
    }
    if (options.length === 0) return false
    setPitch(index, options[0])
    return true
  }

  // 4b. 順次進行でつなぐ(経過音)。跳躍そのものは旋律の表情なので、1セクションで直すのは跳躍の半分まで
  if (steps.has("conjunct") && scale.length === 7) {
    const inScale = (pitch: number) => scale.includes(pc(pitch))
    const leapCount = notes.slice(1).filter((note, index) => Math.abs(note.pitch - notes[index].pitch) >= 5).length
    let budget = Math.ceil(leapCount / 2)
    // (1) 跳躍の間にある裏拍の音を、前後を順次でつなぐ音にする
    for (let index = 1; index + 1 < notes.length && budget > 0; index += 1) {
      const note = notes[index]
      const previous = notes[index - 1]
      const next = notes[index + 1]
      if (strong(note.startBeat) || locked(note) || isPeak(index)) continue
      if (note.startBeat - (previous.startBeat + previous.durationBeats) > 0.5 || next.startBeat - (note.startBeat + note.durationBeats) > 0.5) continue
      const worst = Math.max(Math.abs(note.pitch - previous.pitch), Math.abs(next.pitch - note.pitch))
      if (worst < 5) continue
      const low = Math.min(previous.pitch, next.pitch) - 2
      const high = Math.max(previous.pitch, next.pitch) + 2
      const options: Array<{ pitch: number; worst: number }> = []
      for (let pitch = low; pitch <= high; pitch += 1) {
        if (pitch < context.range.low || pitch > context.range.high || !inScale(pitch) || pitch === previous.pitch || pitch === next.pitch) continue
        const toNext = Math.abs(next.pitch - pitch)
        const chordOk = chordPcs(note.startBeat).includes(pc(pitch)) || usable(note.startBeat).includes(pc(pitch))
        // コードの音でなければ、次の音へ1〜2半音で進む経過音に限る
        if (!chordOk && toNext > 2) continue
        options.push({ pitch, worst: Math.max(Math.abs(pitch - previous.pitch), toNext) })
      }
      const best = options.sort((a, b) => a.worst - b.worst || Math.abs(a.pitch - note.pitch) - Math.abs(b.pitch - note.pitch))[0]
      if (!best || best.worst > 4 || best.worst > worst - 2) continue
      const chordTone = chordPcs(note.startBeat).includes(pc(best.pitch))
      note.pitch = best.pitch
      note.plannedToneRole = chordTone ? "chord-tone" : usable(note.startBeat).includes(pc(best.pitch)) ? "tension-hold" : "approach-tone"
      if (note.plannedToneRole === "approach-tone") {
        note.plannedResolution = { targetPitchClass: pc(next.pitch), targetBeat: next.startBeat, maximumDelayBeats: next.startBeat - note.startBeat }
      } else {
        delete note.plannedResolution
      }
      budget -= 1
    }
    // (2) 3度(3〜4半音)で動く前の長い音(1.5拍以上)は、末尾の半拍を間の音階の音(経過音)に分ける
    let inserted = 0
    const maximumInserted = Math.max(1, Math.round(context.totalBeats / 16))
    for (let index = notes.length - 2; index >= 1 && inserted < maximumInserted; index -= 1) {
      const note = notes[index]
      const next = notes[index + 1]
      const interval = next.pitch - note.pitch
      if (Math.abs(interval) < 3 || Math.abs(interval) > 4 || note.durationBeats < 1.5 || locked(note) || locked(next) || isPeak(index)) continue
      if (next.startBeat - (note.startBeat + note.durationBeats) > 1e-6) continue
      const between = interval > 0 ? [note.pitch + 1, note.pitch + 2] : [note.pitch - 1, note.pitch - 2]
      const passing = between.find((pitch) => inScale(pitch) && Math.abs(next.pitch - pitch) <= 2 && Math.abs(next.pitch - pitch) >= 1)
      if (passing === undefined) continue
      const start = note.startBeat + note.durationBeats - 0.5
      if (strong(start)) continue
      note.durationBeats -= 0.5
      const chordTone = chordPcs(start).includes(pc(passing))
      notes.splice(index + 1, 0, {
        ...note,
        id: `${note.id}-pass`,
        startBeat: start,
        durationBeats: 0.5,
        pitch: passing,
        plannedToneRole: chordTone ? "chord-tone" : "approach-tone",
        plannedResolution: chordTone ? undefined : { targetPitchClass: pc(next.pitch), targetBeat: next.startBeat, maximumDelayBeats: 0.5 },
        locks: [],
      })
      inserted += 1
    }
  }

  // 5. ベースとの関係: 拍頭で旋律とベースが同じ向きに動いて、5度・8度が続く所をほどく
  if (steps.has("counterpoint")) {
    const strongIndexes = notes.map((note, index) => ({ note, index })).filter(({ note }) => strong(note.startBeat)).map(({ index }) => index)
    const perfect = (melody: number, bass: number) => {
      const interval = pc(melody - bass)
      return interval === 0 || interval === 7 ? interval : -1
    }
    const bassMove = (from: number, to: number) => {
      const delta = pc(to - from)
      return delta === 0 ? 0 : delta <= 6 ? 1 : -1
    }
    for (let position = 1; position < strongIndexes.length; position += 1) {
      const beforeIndex = strongIndexes[position - 1]
      const index = strongIndexes[position]
      const before = notes[beforeIndex]
      const note = notes[index]
      if (note.startBeat - before.startBeat > 2 + 1e-6) continue
      const beforeBass = entryAt(before.startBeat)?.parsed.bassPc
      const bass = entryAt(note.startBeat)?.parsed.bassPc
      if (beforeBass === undefined || bass === undefined) continue
      const bassDirection = bassMove(beforeBass, bass)
      const parallel = (pitch: number) => {
        const melodyDirection = Math.sign(pitch - before.pitch)
        const interval = perfect(pitch, bass)
        return melodyDirection !== 0 && melodyDirection === bassDirection && interval >= 0 && interval === perfect(before.pitch, beforeBass)
      }
      if (!parallel(note.pitch) || locked(note) || isPeak(index) || index === lastIndexOf) continue
      // なるべくベースと反対向きか、音程の変わる音へ
      replaceWithChordTone(index, (pitch) => !parallel(pitch), 4)
    }
  }

  // 6. 向かう先を持つ音: コードが変わる所で、導音は主音へ、属七の7度は下へ
  if (steps.has("tendency") && tonic !== undefined) {
    const dominantRoot = (tonic + 7) % 12
    for (let index = 0; index + 1 < notes.length; index += 1) {
      const note = notes[index]
      const next = notes[index + 1]
      const entry = entryAt(note.startBeat)
      const nextEntry = entryAt(next.startBeat)
      if (!entry || !nextEntry || entry === nextEntry || entry.parsed.rootPc !== dominantRoot) continue
      if (next.startBeat - (note.startBeat + note.durationBeats) > 1.5 || locked(next)) continue
      const nextChord = chordPcs(next.startBeat)
      let wanted: number[] = []
      if (pc(note.pitch) === (tonic + 11) % 12 && pc(next.pitch) !== tonic) wanted = [note.pitch + 1]
      else if (pc(note.pitch) === (tonic + 5) % 12 && chordPcs(note.startBeat).includes((tonic + 5) % 12)
        && !(note.pitch - next.pitch >= 1 && note.pitch - next.pitch <= 2)) wanted = [note.pitch - 1, note.pitch - 2]
      const target = wanted.find((pitch) => nextChord.includes(pc(pitch)) && fits(index + 1, pitch))
      if (target !== undefined) setPitch(index + 1, target)
    }
  }

  // 7. 問いと答え: 前半の終わりは主音で閉じず、後半へ開いておく
  if (steps.has("antecedent") && tonic !== undefined && context.totalBeats >= 16) {
    const middle = notes.map((note, index) => ({ note, index })).filter(({ note }) => note.startBeat < context.totalBeats / 2).at(-1)
    if (middle && pc(middle.note.pitch) === tonic && !locked(middle.note) && !isPeak(middle.index) && middle.index !== lastIndexOf) {
      replaceWithChordTone(middle.index, (pitch) => pc(pitch) !== tonic, 4)
    }
  }

  recoverLeaps()

  // 8. ため息: 長い音を1か所だけ、1段上の音(倚音)から下がって入る形にする
  if (steps.has("sigh") && scale.length === 7) {
    const target = context.totalBeats * 0.65
    const candidate = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note, index }) => {
        if (index === 0 || index === lastIndexOf || locked(note) || isPeak(index) || !strong(note.startBeat) || note.durationBeats < 1) return false
        if (!chordPcs(note.startBeat).includes(pc(note.pitch))) return false
        const upper = moveInScale(note.pitch, 1, scale)
        // 1段上がコードの音だと倚音にならない。前の音から大きく跳んで入らない
        return upper - note.pitch <= 2 && upper <= high && !usable(note.startBeat).includes(pc(upper))
          && Math.abs(upper - notes[index - 1].pitch) <= 5
      })
      .sort((a, b) => Math.abs(a.note.startBeat - target) - Math.abs(b.note.startBeat - target))[0]
    if (candidate) {
      const { note, index } = candidate
      const first = note.durationBeats >= 2 ? 1 : 0.5
      const appoggiatura: MelodyNote = {
        ...note,
        id: `${note.id}-sigh`,
        pitch: moveInScale(note.pitch, 1, scale),
        durationBeats: first,
        plannedToneRole: "appoggiatura",
        plannedResolution: { targetPitchClass: pc(note.pitch), targetBeat: note.startBeat + first, maximumDelayBeats: 1 },
      }
      note.startBeat += first
      note.durationBeats -= first
      notes.splice(index, 0, appoggiatura)
    }
  }

  // 4. 終わり方
  const lastIndex = notes.length - 1
  const last = notes[lastIndex]
  // セクションの最後の音は、表情として置いた音でも解決しないまま終わらないよう直す(手で固定した音は除く)
  if (!last.locks.includes("pitch")) {
    const endChord = chordPcs(last.startBeat)
    const resolving = RESOLVING_ROLES.has(context.sectionRole) && tonic !== undefined && endChord.includes(tonic)
    const wanted = resolving ? [tonic] : endChord
    if (!wanted.includes(pc(last.pitch))) {
      const options = [-1, 1].flatMap((direction) => candidatesFrom(lastIndex, last.pitch, direction as 1 | -1, 1, 6))
        .filter((pitch) => wanted.includes(pc(pitch)))
        // 下がって終わる方を少し好む
        .sort((a, b) => Math.abs(a - last.pitch) + (a > last.pitch ? 0.5 : 0) - (Math.abs(b - last.pitch) + (b > last.pitch ? 0.5 : 0)))
      if (options.length > 0) setPitch(lastIndex, options[0])
    }
    if (endChord.includes(pc(last.pitch)) && EXPRESSIVE_ROLES.has(last.plannedToneRole)) {
      last.plannedToneRole = "chord-tone"
      delete last.plannedResolution
    }
    // 最後の音は短く切らず、少し伸ばして終わる
    const room = context.totalBeats - last.startBeat
    if (last.durationBeats < 1.5 && room > last.durationBeats) last.durationBeats = Math.min(room, 2)
  }
  return notes
}
