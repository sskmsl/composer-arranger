import type { SeededRandom } from "@/core/rng"
import type { MelodyNote } from "@/core/melody"
import type { Midi } from "@/core/note"
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
  const window = registerWindow(ctx.range, plan.register)
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
    notes.push(makeNote(beat, holdLength, pitchOfClassNear(pc, window, ctx.range), velocity))
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
