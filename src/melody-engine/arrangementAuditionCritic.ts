import type { ArrangementAuditionReport, ArrangementPlan, GeneratedArrangementNote, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import type { MelodyNote } from "@/core/melody"
import type { ComposerProject } from "@/core/project"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { parseTimeSignature } from "@/core/section"

const LAYER_TRACKS = new Set([
  "dr-kick-sub", "dr-kick-click", "dr-snare-body", "dr-clap", "dr-shaker", "dr-ride",
  "dr-percussion-high", "dr-cymbal-swell", "dr-impact", "syn-sub-bass", "syn-bass-mid",
  "syn-arp-low", "syn-arp-high", "syn-chord-wide", "syn-pad-air", "syn-pad-motion",
  "str-contrabass", "str-spiccato", "str-high-octave",
])

const FOREGROUND_SUPPORT = new Set([
  "syn-pulse", "syn-stabs", "syn-high-glass", "syn-transition-phrase", "syn-final-lift",
  "str-viola", "str-violin-2", "str-violin-1", "str-upper",
])

const LOW_SUPPORT = new Set(["str-cello", "str-contrabass", "syn-pad-motion"])

function clamp(value: number, low = 0, high = 100): number {
  return Math.max(low, Math.min(high, Number.isFinite(value) ? value : low))
}

function correlation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 0
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  let numerator = 0
  let leftSquare = 0
  let rightSquare = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean
    const rightDelta = right[index] - rightMean
    numerator += leftDelta * rightDelta
    leftSquare += leftDelta * leftDelta
    rightSquare += rightDelta * rightDelta
  }
  const denominator = Math.sqrt(leftSquare * rightSquare)
  return denominator > 0 ? clamp(numerator / denominator, -1, 1) : 0
}

function overlaps(left: MelodyNote, right: MelodyNote): boolean {
  return left.startBeat < right.startBeat + right.durationBeats
    && left.startBeat + left.durationBeats > right.startBeat
}

function isTonal(track: GeneratedArrangementTrack): boolean {
  return track.family !== "drums"
}

function targetRegisterShare(plan: ArrangementPlan["sections"][number]) {
  const weight = (value: "open" | "medium" | "strong") => value === "strong" ? 1 : value === "medium" ? .62 : .24
  const raw = [weight(plan.register.low), weight(plan.register.mid), weight(plan.register.high)]
  const sum = raw.reduce((total, value) => total + value, 0)
  return raw.map((value) => value / Math.max(.01, sum))
}

function registerIndex(pitch: number): 0 | 1 | 2 {
  return pitch < 52 ? 0 : pitch < 73 ? 1 : 2
}

function auditionMetrics(
  project: ComposerProject,
  plan: ArrangementPlan,
  tracks: GeneratedArrangementTrack[],
): Omit<ArrangementAuditionReport, "repairPasses" | "removedNotes" | "shiftedNotes" | "velocityAdjustments"> {
  const lead = buildSongPlaybackMaterial(project).lead
  const tonal = tracks.filter((track) => !track.muted && isTonal(track))
  const tonalNotes = tonal.flatMap((track) => track.notes.map((note) => ({ track, note })))
  const masking = tonalNotes.filter(({ track, note }) =>
    note.character === "safe"
    && (FOREGROUND_SUPPORT.has(track.id) || LAYER_TRACKS.has(track.id))
    && lead.some((leadNote) => overlaps(note, leadNote) && Math.abs(note.pitch - leadNote.pitch) <= 5 && note.velocity >= leadNote.velocity - 22),
  )
  const melodicClarity = clamp(100 - masking.length / Math.max(1, lead.length) * 75)

  const attackGroups = new Map<number, Set<string>>()
  for (const track of tracks.filter((candidate) => !candidate.muted)) for (const note of track.notes) {
    const key = Math.round(note.startBeat * 8)
    const group = attackGroups.get(key) ?? new Set<string>()
    group.add(track.id)
    attackGroups.set(key, group)
  }
  const congestedAttacks = [...attackGroups.values()].filter((group) => group.size > 9)
  const transientClarity = clamp(100 - congestedAttacks.reduce((sum, group) => sum + group.size - 9, 0) * 2.5)

  const lowFrames = new Map<number, Set<string>>()
  for (const track of tracks.filter((candidate) => !candidate.muted)) for (const note of track.notes) {
    if (track.family === "drums" ? ![35, 36, 41, 45].includes(note.pitch) : note.pitch >= 52) continue
    const first = Math.floor(note.startBeat * 2)
    const last = Math.max(first, Math.ceil((note.startBeat + Math.min(note.durationBeats, 4)) * 2) - 1)
    for (let frame = first; frame <= last; frame += 1) {
      const group = lowFrames.get(frame) ?? new Set<string>()
      group.add(track.id)
      lowFrames.set(frame, group)
    }
  }
  const crowdedLowFrames = [...lowFrames.values()].filter((group) => group.size > 5)
  const lowEndClarity = clamp(100 - crowdedLowFrames.length / Math.max(1, lowFrames.size) * 125)

  let registerError = 0
  let registerSections = 0
  const perceivedDensity: number[] = []
  const targetEnergy: number[] = []
  for (const sectionPlan of plan.sections) {
    const sectionNotes = tonalNotes.filter(({ note }) => note.sectionId === sectionPlan.sectionId)
    const bands = [0, 0, 0]
    for (const { note } of sectionNotes) bands[registerIndex(note.pitch)] += note.velocity / 127 * Math.min(2, note.durationBeats)
    const total = bands.reduce((sum, value) => sum + value, 0)
    if (total > 0) {
      const actual = bands.map((value) => value / total)
      const target = targetRegisterShare(sectionPlan)
      registerError += actual.reduce((sum, value, index) => sum + Math.abs(value - target[index]), 0) / 2
      registerSections += 1
    }
    const source = project.sections.find((section) => section.id === sectionPlan.sectionId)
    const length = Math.max(1, (source?.lengthBars ?? 1) * parseTimeSignature(project.song.timeSignature).beatsPerBar)
    const sectionTracks = new Set(tracks.flatMap((track) => track.notes.some((note) => note.sectionId === sectionPlan.sectionId) ? [track.id] : []))
    const velocityEnergy = tracks.reduce((sum, track) => sum + track.notes
      .filter((note) => note.sectionId === sectionPlan.sectionId)
      .reduce((noteSum, note) => noteSum + note.velocity / 127, 0), 0)
    perceivedDensity.push((velocityEnergy / length) * Math.sqrt(Math.max(1, sectionTracks.size)))
    targetEnergy.push(sectionPlan.energy)
  }
  const registerBalance = clamp(100 - registerError / Math.max(1, registerSections) * 100)
  const dynamicArc = clamp((correlation(targetEnergy, perceivedDensity) + .2) / 1.2 * 100)

  const boundaryValues = plan.sections.slice(1).map((section, index) => {
    const previous = plan.sections[index]
    const previousDensity = perceivedDensity[index] ?? 0
    const density = perceivedDensity[index + 1] ?? 0
    const audibleDifference = Math.abs(density - previousDensity) / Math.max(1, density, previousDensity)
    const intendedDifference = Math.abs(section.energy - previous.energy) / 100
    return intendedDifference < .08 ? 1 : clamp(audibleDifference / Math.max(.12, intendedDifference), 0, 1)
  })
  const sectionContrast = boundaryValues.length > 0
    ? boundaryValues.reduce((sum, value) => sum + value, 0) / boundaryValues.length * 100
    : 100
  const score = clamp(
    melodicClarity * .28
    + lowEndClarity * .18
    + transientClarity * .18
    + registerBalance * .13
    + dynamicArc * .13
    + sectionContrast * .10,
  )
  const issues: string[] = []
  if (melodicClarity < 82) issues.push("主旋律と補助パートの中域が重なりすぎています")
  if (lowEndClarity < 82) issues.push("低域の持続パートが同時に重なりすぎています")
  if (transientClarity < 82) issues.push("同時に始まるパートが多く、アタックが一塊になっています")
  if (registerBalance < 68) issues.push("Sectionで予定した音域配分と実音の分布が一致していません")
  if (dynamicArc < 68) issues.push("曲の強弱設計が実際の発音密度へ十分に現れていません")
  if (sectionContrast < 62) issues.push("Section境界の変化が聴感上弱くなっています")
  return {
    version: "1.0.0",
    score: Math.round(score * 10) / 10,
    passed: score >= 78 && melodicClarity >= 72 && lowEndClarity >= 68,
    melodicClarity: Math.round(melodicClarity),
    lowEndClarity: Math.round(lowEndClarity),
    transientClarity: Math.round(transientClarity),
    registerBalance: Math.round(registerBalance),
    dynamicArc: Math.round(dynamicArc),
    sectionContrast: Math.round(sectionContrast),
    issues,
  }
}

function repairPass(
  project: ComposerProject,
  plan: ArrangementPlan,
  tracks: GeneratedArrangementTrack[],
): { tracks: GeneratedArrangementTrack[]; removedNotes: number; shiftedNotes: number; velocityAdjustments: number } {
  const lead = buildSongPlaybackMaterial(project).lead
  const attackCounts = new Map<number, Set<string>>()
  for (const track of tracks) for (const note of track.notes) {
    const key = Math.round(note.startBeat * 8)
    const group = attackCounts.get(key) ?? new Set<string>()
    group.add(track.id)
    attackCounts.set(key, group)
  }
  const bass = tracks.find((track) => track.id === "syn-bass")?.notes ?? []
  let removedNotes = 0
  let shiftedNotes = 0
  let velocityAdjustments = 0
  const repaired = tracks.map((track): GeneratedArrangementTrack => ({
    ...track,
    notes: track.notes.flatMap((note): GeneratedArrangementNote[] => {
      if (note.reason.includes("聴感調整済み")) return [note]
      let next = note
      const leadCollision = track.family !== "drums" && track.family !== "bass" && note.character === "safe"
        ? lead.find((leadNote) => overlaps(note, leadNote) && Math.abs(note.pitch - leadNote.pitch) <= 5 && note.velocity >= leadNote.velocity - 22)
        : undefined
      if (leadCollision && (FOREGROUND_SUPPORT.has(track.id) || LAYER_TRACKS.has(track.id))) {
        const candidates = note.pitch >= leadCollision.pitch
          ? [note.pitch + 12, note.pitch - 12]
          : [note.pitch - 12, note.pitch + 12]
        const pitch = candidates.find((candidate) => candidate >= 31 && candidate <= 100 && Math.abs(candidate - leadCollision.pitch) >= 9)
        if (pitch !== undefined) {
          next = { ...next, pitch, reason: `${next.reason}。主旋律の音域を空ける聴感調整済み` }
          shiftedNotes += 1
        } else {
          next = { ...next, velocity: Math.max(1, next.velocity - 12), reason: `${next.reason}。主旋律の手前を空ける聴感調整済み` }
          velocityAdjustments += 1
        }
      }
      if (LOW_SUPPORT.has(track.id) && next.pitch < 52 && bass.some((bassNote) => overlaps(next, bassNote))) {
        next = { ...next, pitch: Math.min(100, next.pitch + 12), reason: `${next.reason}。Bassと低域を分ける聴感調整済み` }
        shiftedNotes += 1
      }
      const attackSize = attackCounts.get(Math.round(next.startBeat * 8))?.size ?? 0
      if (attackSize > 9 && (LAYER_TRACKS.has(track.id) || FOREGROUND_SUPPORT.has(track.id))) {
        if (LAYER_TRACKS.has(track.id) && next.velocity < 48 && (Math.round(next.startBeat * 8) + track.id.length) % 3 === 0) {
          removedNotes += 1
          return []
        }
        next = { ...next, velocity: Math.max(1, next.velocity - Math.min(14, (attackSize - 8) * 2)), reason: `${next.reason}。同時アタックを整理する聴感調整済み` }
        velocityAdjustments += 1
      }
      const sectionPlan = plan.sections.find((section) => section.sectionId === next.sectionId)
      if (sectionPlan?.sectionShape === "release" && !LAYER_TRACKS.has(track.id) && next.velocity < 116) {
        next = { ...next, velocity: Math.min(127, next.velocity + 4), reason: `${next.reason}。曲の頂点を明確にする聴感調整済み` }
        velocityAdjustments += 1
      } else if ((sectionPlan?.sectionShape === "drop" || sectionPlan?.sectionShape === "withdraw") && next.velocity > 22) {
        next = { ...next, velocity: Math.max(1, next.velocity - 4), reason: `${next.reason}。前後の落差を作る聴感調整済み` }
        velocityAdjustments += 1
      }
      return [next]
    }),
  }))
  return { tracks: repaired, removedNotes, shiftedNotes, velocityAdjustments }
}

/**
 * 音色そのものを生成しないMIDI段階でも確認できる、聴感上のマスキングと起伏を反復評価する。
 * 修正後の点が下がる場合は採用せず、最大3回で収束させる。
 */
export function refineArrangementByAudition(
  project: ComposerProject,
  plan: ArrangementPlan,
  sourceTracks: GeneratedArrangementTrack[],
  maximumPasses = 3,
): { tracks: GeneratedArrangementTrack[]; report: ArrangementAuditionReport } {
  let tracks = sourceTracks
  let metrics = auditionMetrics(project, plan, tracks)
  let repairPasses = 0
  let removedNotes = 0
  let shiftedNotes = 0
  let velocityAdjustments = 0
  for (let pass = 0; pass < maximumPasses && (!metrics.passed || metrics.issues.length > 0); pass += 1) {
    const repaired = repairPass(project, plan, tracks)
    if (repaired.removedNotes + repaired.shiftedNotes + repaired.velocityAdjustments === 0) break
    const nextMetrics = auditionMetrics(project, plan, repaired.tracks)
    if (nextMetrics.score + .01 < metrics.score) break
    tracks = repaired.tracks
    metrics = nextMetrics
    repairPasses += 1
    removedNotes += repaired.removedNotes
    shiftedNotes += repaired.shiftedNotes
    velocityAdjustments += repaired.velocityAdjustments
  }
  return {
    tracks,
    report: { ...metrics, repairPasses, removedNotes, shiftedNotes, velocityAdjustments },
  }
}

export function evaluateArrangementAudition(
  project: ComposerProject,
  plan: ArrangementPlan,
  tracks: GeneratedArrangementTrack[],
): ArrangementAuditionReport {
  return { ...auditionMetrics(project, plan, tracks), repairPasses: 0, removedNotes: 0, shiftedNotes: 0, velocityAdjustments: 0 }
}
