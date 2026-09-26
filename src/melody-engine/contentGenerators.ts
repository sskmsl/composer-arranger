import type { SeededRandom } from "@/core/rng"
import type { MelodyNote } from "@/core/melody"
import { pitchClass, type Midi } from "@/core/note"
import { chordTonePitchClasses } from "@/core/chord"
import type { SectionContentPlan, SectionLayer } from "@/core/sectionContent"
import { partRoleFor } from "@/core/sectionContent"
import { chordAtBeat, type HarmonicMapEntry } from "./harmonicMap"
import { registerWindow, snapToVocabulary, type ContentPlanContext } from "./sectionContentPlan"

const EPS = 1e-6

/** contentごとの基準ベロシティ。伴奏側パートは控えめにする */
const CONTENT_VELOCITY: Record<string, number> = {
  motif: 78,
  ostinato: 64,
  drone: 52,
  none: 70,
  melody: 80,
}

function makeNote(startBeat: number, durationBeats: number, pitch: Midi, velocity: number): MelodyNote {
  return {
    id: crypto.randomUUID(),
    startBeat: Number(startBeat.toFixed(6)),
    durationBeats: Number(durationBeats.toFixed(6)),
    pitch: Math.round(pitch),
    velocity,
    locks: [],
  }
}

/**
 * リードを鳴らして良い区間へノートを収める。
 * entryOffsetより前へは1音も置かず、セクション終端を超える音は末尾で切る。
 */
export function clipToWindow(notes: MelodyNote[], startBeat: number, endBeat: number): MelodyNote[] {
  const clipped: MelodyNote[] = []
  for (const note of notes) {
    if (note.startBeat < startBeat - EPS) continue
    if (note.startBeat >= endBeat - EPS) continue
    const maxDuration = endBeat - note.startBeat
    clipped.push({ ...note, durationBeats: Math.min(note.durationBeats, maxDuration) })
  }
  return clipped.filter((note) => note.durationBeats > EPS).sort((a, b) => a.startBeat - b.startBeat)
}

/** そのbeatで鳴っているコードの構成音(Droneの保持音を和声的に無害な高さへ置くため) */
function chordTonesAt(harmonicMap: HarmonicMapEntry[], beat: number): number[] {
  const entry = chordAtBeat(harmonicMap, beat)
  return entry ? chordTonePitchClasses(entry.parsed) : []
}

/**
 * Motif: 2〜5音の識別可能な核を、明確な余白を挟んで疎に再登場させる。
 *
 * 通常の歌唱フレーズへ展開しすぎないよう、核と核の間には必ず plan.restBeats の余白を置き、
 * 反復時の変形は fragment / interval change / rhythmic displacement のいずれかに限る。
 */
export function generateMotifNotes(
  rng: SeededRandom,
  plan: SectionContentPlan,
  ctx: ContentPlanContext,
): MelodyNote[] {
  const window = registerWindow(ctx.range, plan.register)
  const gap = plan.restBeats[0] ?? ctx.beatsPerBar
  const velocity = CONTENT_VELOCITY.motif
  const notes: MelodyNote[] = []

  let cursor = plan.entryOffsetBeats
  const limit = ctx.totalBeats - plan.pickupBeats

  for (let rep = 0; rep < plan.repetitionCount && cursor < limit - EPS; rep++) {
    // 反復ごとの変形。核そのものは保ったまま、1種類だけを適用する
    let intervals = [...plan.motifIntervals]
    let durations = [...plan.cellDurations]
    let displacement = 0

    if (rep > 0) {
      if (plan.developmentStrategy === "fragment") {
        // 末尾を落として断片化する(音数を減らすことで反復が同型にならない)
        const keep = Math.max(2, durations.length - rep)
        durations = durations.slice(0, keep)
        intervals = intervals.slice(0, Math.max(1, keep - 1))
      } else if (plan.developmentStrategy === "develop") {
        // 1つの音程だけを広げる/狭める
        const idx = rng.intBetween(0, Math.max(0, intervals.length - 1))
        if (intervals.length > 0) intervals[idx] = intervals[idx] + (rng.chance(0.5) ? 1 : -1)
      } else if (plan.developmentStrategy === "mutate-cycle") {
        // 拍位置をずらす(rhythmic displacement)
        displacement = rng.chance(0.5) ? 0.5 : 1
      }
    }

    const startBeat = cursor + displacement
    if (startBeat >= limit - EPS) break

    // 核の開始音は、その時点のコードの構成音へ寄せる(核の音程関係は保つ)
    const tonesHere = chordTonesAt(ctx.harmonicMap, startBeat)
    const vocabulary = tonesHere.length > 0 ? tonesHere : plan.pitchVocabulary
    const center = (window.low + window.high) / 2
    let pitch = snapToVocabulary(center, vocabulary, window)

    let beat = startBeat
    for (let n = 0; n < durations.length; n++) {
      if (beat >= limit - EPS) break
      if (n > 0) {
        const step = intervals[n - 1] ?? 0
        pitch = snapToVocabulary(pitch + step, plan.pitchVocabulary, window)
      }
      notes.push(makeNote(beat, durations[n], pitch, velocity))
      beat += durations[n]
    }

    cursor = beat + gap
  }

  return clipToWindow(notes, plan.entryOffsetBeats, limit)
}

/**
 * Ostinato: 1〜2小節以内の周期セルを、同じ周期位置へ最低2周期以上再出現させる。
 *
 * 音高セルとリズムセルを別々に計画済みなので、ここでは通常Melodyのsequence処理を通さず、
 * セルをそのまま周期配置する。変異は周期境界でのみ行う。
 */
export function generateOstinatoNotes(
  rng: SeededRandom,
  plan: SectionContentPlan,
  ctx: ContentPlanContext,
): MelodyNote[] {
  const window = registerWindow(ctx.range, plan.register)
  const velocity = CONTENT_VELOCITY.ostinato
  const onsets = plan.restBeats
  const durations = plan.cellDurations
  const pitchCell = plan.motifIntervals
  const period = plan.cellLengthBeats
  if (period <= EPS || onsets.length === 0) return []

  // 変異周期: 何周期ごとに1音だけ変えるか(周期性を壊さない範囲)
  const mutationPeriod = rng.intBetween(2, 3)
  const limit = ctx.totalBeats - plan.pickupBeats
  const notes: MelodyNote[] = []

  const unit = plan.pitchCellUnit ?? "semitone"
  if (unit !== "semitone") {
    // 反復音型は伴奏として書き出すので、主旋律の音域より下へははみ出してよい。
    // 低い型は1オクターブ下まで、ほかの型も5度下まで使い(折り返しで型の形を崩さないため)、
    // 高さの中心を型ごとに変えて3つの型を聞き分けられるようにする。
    // 上限はサビの頂点のために取っておいた高さ(ctx.range.high)を超えない
    const figureRange = { low: ctx.range.low - (plan.register === "low" ? 12 : 7), high: ctx.range.high }
    const center =
      plan.register === "low" ? ctx.range.low - 2 : plan.register === "high" ? ctx.range.high - 2 : (window.low + window.high) / 2
    const placeCache = new Map<string, FigurePlacement>()
    let previousMean: number | undefined
    for (let cycle = 0; cycle < plan.repetitionCount; cycle++) {
      const cycleStart = plan.entryOffsetBeats + cycle * period
      if (cycleStart >= limit - EPS) break
      const mutateIndex = cycle > 0 && cycle % mutationPeriod === 0 ? rng.intBetween(0, onsets.length - 1) : -1
      for (let k = 0; k < onsets.length; k++) {
        const beat = cycleStart + onsets[k]
        if (beat >= limit - EPS) break
        const duration = durations[k % durations.length]
        // anticipate: 1拍先のコードで鳴らす(小節の最後の音が次のコードへ先回りする)
        const harmonyBeat =
          plan.chordBoundaryResponse === "anticipate" ? Math.min(beat + 1, ctx.totalBeats - EPS) : beat
        const entry = chordAtBeat(
          ctx.harmonicMap,
          plan.chordBoundaryResponse === "hold-through" ? plan.entryOffsetBeats : harmonyBeat,
        )
        const key = entry?.chord.symbol ?? ""
        if (!placeCache.has(key)) placeCache.set(key, placeFigure(plan, ctx, entry, unit, center, figureRange, previousMean))
        const placement = placeCache.get(key)!
        previousMean = placement.mean
        let step = pitchCell[k % pitchCell.length]
        if (k === mutateIndex) step += rng.chance(0.5) ? 1 : -1
        let pitch = foldIntoRange(placement.pitchOf(step), figureRange)
        // 調の中で形を保つリフは、小節の頭でその場のコードと半音でぶつかるときだけ隣のコードトーンへ逃がす
        if (plan.chordBoundaryResponse === "hold-through" && beat % ctx.beatsPerBar < EPS) {
          pitch = avoidSemitoneClash(pitch, chordTonesAt(ctx.harmonicMap, beat))
        }
        notes.push(makeNote(beat, duration, pitch, velocity))
      }
    }
    return clipToWindow(notes, plan.entryOffsetBeats, limit)
  }

  const baseTones = chordTonesAt(ctx.harmonicMap, plan.entryOffsetBeats)
  const baseVocabulary = baseTones.length > 0 ? baseTones : plan.pitchVocabulary
  const basePitch = snapToVocabulary((window.low + window.high) / 2, baseVocabulary, window)

  for (let cycle = 0; cycle < plan.repetitionCount; cycle++) {
    const cycleStart = plan.entryOffsetBeats + cycle * period
    if (cycleStart >= limit - EPS) break
    // 周期境界でのみ変異させる音のindex
    const mutateIndex = cycle > 0 && cycle % mutationPeriod === 0 ? rng.intBetween(0, onsets.length - 1) : -1

    for (let k = 0; k < onsets.length; k++) {
      const beat = cycleStart + onsets[k]
      if (beat >= limit - EPS) break
      let offset = pitchCell[k % pitchCell.length]
      if (k === mutateIndex) offset += rng.chance(0.5) ? 2 : -2

      // コード境界への反応は計画に従う。followのときだけ、その場のコードトーンへ寄せる
      const vocabulary =
        plan.chordBoundaryResponse === "follow"
          ? (() => {
              const tones = chordTonesAt(ctx.harmonicMap, beat)
              return tones.length > 0 ? tones : plan.pitchVocabulary
            })()
          : plan.pitchVocabulary

      const pitch = snapToVocabulary(basePitch + offset, vocabulary, window)
      notes.push(makeNote(beat, durations[k % durations.length], pitch, velocity))
    }
  }

  return clipToWindow(notes, plan.entryOffsetBeats, limit)
}

interface FigurePlacement {
  pitchOf: (step: number) => Midi
  /** 型1周の平均の高さ(次のコードで近い高さを選ぶため) */
  mean: number
}

/** 3和音の段(根音・3度・5度)。9度などの付加音は段に入れない */
function triadOffsets(entry: HarmonicMapEntry | undefined): { rootPc: number; offsets: number[] } {
  if (!entry) return { rootPc: 0, offsets: [0, 4, 7] }
  const rootPc = entry.parsed.rootPc
  const intervals = [...new Set(chordTonePitchClasses(entry.parsed).map((pc) => (((pc - rootPc) % 12) + 12) % 12))]
    .filter((interval) => interval !== 1 && interval !== 2)
    .sort((a, b) => a - b)
  const offsets = intervals.length >= 3 ? intervals.slice(0, 3) : [0, 4, 7]
  return { rootPc, offsets }
}

/**
 * 型の段を実音へ置く。コードトーンの段なら根音から、音階の段なら軸の音から数える。
 * 軸の高さは、型全体が音域に収まり、平均が計画の音域(register)の中心に最も近いものを選ぶ。
 */
function placeFigure(
  plan: SectionContentPlan,
  ctx: ContentPlanContext,
  entry: HarmonicMapEntry | undefined,
  unit: "chord-tone" | "scale-step",
  center: number,
  range: { low: Midi; high: Midi },
  previousMean?: number,
): FigurePlacement {
  let anchorPc: number
  let offsetOf: (step: number) => number
  if (unit === "chord-tone") {
    const triad = triadOffsets(entry)
    anchorPc = triad.rootPc
    offsetOf = (step) => {
      const octave = Math.floor(step / 3)
      return triad.offsets[step - octave * 3] + octave * 12
    }
  } else {
    const rootPc = entry?.parsed.rootPc ?? 0
    const scale = ctx.keyScale.length > 0 ? ctx.keyScale : [0, 2, 4, 5, 7, 9, 11].map((s) => (s + rootPc) % 12)
    const tonic = scale[0]
    const degrees = scale.map((pc) => (((pc - tonic) % 12) + 12) % 12)
    // hold-through は調の主音、それ以外はその場のコードの根音(音階に無ければ最も近い音階音)を軸にする
    const wanted = plan.chordBoundaryResponse === "hold-through" ? tonic : rootPc
    const anchorDegree = nearestDegree(degrees, (((wanted - tonic) % 12) + 12) % 12)
    anchorPc = (tonic + degrees[anchorDegree]) % 12
    const n = degrees.length
    offsetOf = (step) => {
      const target = anchorDegree + step
      const octave = Math.floor(target / n)
      return degrees[target - octave * n] + octave * 12 - degrees[anchorDegree]
    }
  }
  const figureOffsets = plan.motifIntervals.map(offsetOf)
  // 音域の中心へ寄せつつ、前のコードの型から離れすぎない高さを選ぶ(コードの変わり目で大きく跳ばない)
  let best = { anchor: 60, score: Infinity, mean: center }
  for (let anchor = range.low - 24; anchor <= range.high + 12; anchor++) {
    if (pitchClass(anchor) !== anchorPc) continue
    const pitches = figureOffsets.map((offset) => anchor + offset)
    const outside = pitches.filter((pitch) => pitch < range.low || pitch > range.high).length
    const mean = pitches.reduce((sum, pitch) => sum + pitch, 0) / Math.max(1, pitches.length)
    const score =
      outside * 100 +
      (previousMean === undefined ? Math.abs(mean - center) : Math.abs(mean - center) * 0.35 + Math.abs(mean - previousMean) * 0.65)
    if (score < best.score) best = { anchor, score, mean }
  }
  return { pitchOf: (step) => best.anchor + offsetOf(step), mean: best.mean }
}

function nearestDegree(degrees: number[], interval: number): number {
  let best = 0
  let bestDistance = Infinity
  degrees.forEach((degree, index) => {
    const distance = Math.min(Math.abs(degree - interval), 12 - Math.abs(degree - interval))
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

function foldIntoRange(pitch: Midi, range: { low: Midi; high: Midi }): Midi {
  let folded = pitch
  while (folded > range.high && folded - 12 >= range.low) folded -= 12
  while (folded < range.low && folded + 12 <= range.high) folded += 12
  return folded
}

function avoidSemitoneClash(pitch: Midi, chordTones: number[]): Midi {
  if (chordTones.length === 0 || chordTones.includes(pitchClass(pitch))) return pitch
  for (const delta of [-1, 1]) {
    if (chordTones.includes(pitchClass(pitch + delta))) return pitch + delta
  }
  return pitch
}

/**
 * Drone: 1〜2種類のピッチクラスを長く保持する。
 *
 * コード境界での分割・再スナップは行わない(hold-through)。
 * 短い同音反復でDroneを代用しないため、保持数は plan.repetitionCount(=1〜3)に限り、
 * 1音あたりの長さはセクションを割り切った長さになる。
 */
export function generateDroneNotes(
  _rng: SeededRandom,
  plan: SectionContentPlan,
  ctx: ContentPlanContext,
): MelodyNote[] {
  // Droneも伴奏として書き出すので、低い型は主旋律の音域より1オクターブ下まで使う(低い主音の保続など)
  const lowest = ctx.range.low - 12
  const window =
    plan.register === "low" ? { low: lowest, high: ctx.range.low - 2 } : registerWindow(ctx.range, plan.register)
  const fullRange = { low: lowest, high: ctx.range.high }
  const velocity = CONTENT_VELOCITY.drone
  const start = plan.entryOffsetBeats
  const limit = ctx.totalBeats
  const span = limit - start
  if (span <= EPS || plan.pitchVocabulary.length === 0) return []

  const holdCount = Math.max(1, plan.repetitionCount)
  const holdLength = span / holdCount
  const notes: MelodyNote[] = []

  for (let i = 0; i < holdCount; i++) {
    const beat = start + i * holdLength
    if (beat >= limit - EPS) break
    // 保持音は計画したピッチクラスのみを使う。コードが変わっても差し替えない
    const pc = plan.pitchVocabulary[i % plan.pitchVocabulary.length]
    notes.push(makeNote(beat, holdLength, pitchOfClassNear(pc, window, fullRange), velocity))
  }

  // 境界で切らないため clipToWindow は終端のみに効かせる
  return clipToWindow(notes, start, limit)
}

/**
 * 指定ピッチクラスを、registerの中心へ最も近いオクターブで置く。
 *
 * register区画が12半音より狭いと、そのピッチクラスが区画内に存在しないことがある。
 * その場合に区画内の別のクラスへ落とすと、計画した保持音とは違う音が鳴ってしまうため、
 * オクターブ移動で必ず「計画したクラス」を保ち、収まらないときだけ全体音域へ広げる。
 */
function pitchOfClassNear(pc: number, window: { low: Midi; high: Midi }, fullRange: { low: Midi; high: Midi }): Midi {
  const target = ((pc % 12) + 12) % 12
  const center = (window.low + window.high) / 2
  // そのクラスの全オクターブを、centerに近い順に並べる
  const octaves: Midi[] = []
  for (let pitch = target; pitch <= 127; pitch += 12) octaves.push(pitch)
  const byDistance = octaves.sort((a, b) => Math.abs(a - center) - Math.abs(b - center))

  // まずregister区画、収まらなければ全体音域を試す
  for (const bounds of [window, fullRange]) {
    const hit = byDistance.find((pitch) => pitch >= bounds.low && pitch <= bounds.high)
    if (hit !== undefined) return hit
  }
  // どちらにも該当オクターブが無い場合(クライマックス予約で音域が12半音未満に
  // 狭まったときに起こる)。上限を超えるのはクライマックス予約を破ることになるため、
  // ピッチクラスを保ったまま上限以下で最も中心に近いオクターブへ落とす。
  const belowCeiling = byDistance.filter((pitch) => pitch <= fullRange.high && pitch >= 0)
  if (belowCeiling.length > 0) return belowCeiling[0]
  return Math.max(0, byDistance[byDistance.length - 1])
}

/**
 * 次セクションへの弱起。セクション末尾の pickupBeats ぶんだけに置く。
 * entryOffsetより前には決して置かない(無音区間へノートを侵入させない)。
 */
export function generatePickupNotes(
  rng: SeededRandom,
  plan: SectionContentPlan,
  ctx: ContentPlanContext,
): MelodyNote[] {
  if (plan.pickupBeats <= EPS) return []
  const windowStart = Math.max(plan.entryOffsetBeats, ctx.totalBeats - plan.pickupBeats)
  if (windowStart >= ctx.totalBeats - EPS) return []

  const register = registerWindow(ctx.range, plan.register)
  const available = ctx.totalBeats - windowStart
  // 弱起は1〜3音の短い上昇/下降。音数は利用可能な長さから決める
  const noteCount = Math.max(1, Math.min(3, Math.round(available / 0.5)))
  const step = available / noteCount
  const tones = chordTonesAt(ctx.harmonicMap, windowStart)
  const vocabulary = tones.length > 0 ? tones : plan.pitchVocabulary
  const ascending = rng.chance(0.7)

  const notes: MelodyNote[] = []
  let pitch = snapToVocabulary((register.low + register.high) / 2, vocabulary, register)
  for (let i = 0; i < noteCount; i++) {
    const beat = windowStart + i * step
    if (i > 0) pitch = snapToVocabulary(pitch + (ascending ? 2 : -2), plan.pitchVocabulary, register)
    notes.push(makeNote(beat, step, pitch, CONTENT_VELOCITY.none))
  }
  return clipToWindow(notes, windowStart, ctx.totalBeats)
}

/**
 * 計画から、そのcontent専用のGeneratorを通してLayerを組み立てる。
 * melody は既存Melody Engineが実音を作るため、ここでは扱わない(呼び出し側で分岐する)。
 */
export function buildContentLayers(
  rng: SeededRandom,
  plan: SectionContentPlan,
  ctx: ContentPlanContext,
  idPrefix: string,
): SectionLayer[] {
  let notes: MelodyNote[] = []
  if (plan.content === "motif") notes = generateMotifNotes(rng, plan, ctx)
  else if (plan.content === "ostinato") notes = generateOstinatoNotes(rng, plan, ctx)
  else if (plan.content === "drone") notes = generateDroneNotes(rng, plan, ctx)
  // content === "none" は primary のノート数0のまま

  const layers: SectionLayer[] = [
    {
      id: `${idPrefix}:primary`,
      partRole: partRoleFor(plan.content),
      content: plan.content,
      plan,
      notes,
      kind: "primary",
    },
  ]

  // 弱起は本体とは別Layerとして持つ(content="none"でも弱起だけを鳴らせるようにする)
  const pickupNotes = generatePickupNotes(rng, plan, ctx)
  if (pickupNotes.length > 0) {
    layers.push({
      id: `${idPrefix}:pickup`,
      partRole: "lead",
      content: plan.content,
      plan,
      notes: pickupNotes,
      kind: "pickup",
    })
  }

  return layers
}
