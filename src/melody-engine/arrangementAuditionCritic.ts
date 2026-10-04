import type { ArrangementAuditionReport, ArrangementPlan, GeneratedArrangementNote, GeneratedArrangementTrack } from "@/core/arrangementGeneration"
import type { MelodyNote } from "@/core/melody"
import type { ComposerProject } from "@/core/project"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { parseTimeSignature } from "@/core/section"
import { parseChordSymbol } from "@/core/chord"

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
const LOW_DRUM_TRACKS = new Set(["dr-kick", "dr-kick-sub", "dr-low-tom", "dr-gran-cassa", "dr-impact"])

const TRACK_RANGES: Record<string, readonly [number, number]> = {
  "syn-pulse": [48, 84],
  "syn-stabs": [48, 88],
  "syn-dark-pad": [43, 84],
  "syn-high-glass": [72, 104],
  "syn-transition-phrase": [52, 92],
  "syn-final-lift": [60, 104],
  "syn-arp-low": [48, 72],
  "syn-arp-high": [60, 96],
  "syn-chord-wide": [48, 92],
  "syn-pad-air": [60, 100],
  "syn-pad-motion": [52, 84],
  "str-cello": [36, 72],
  "str-contrabass": [28, 60],
  "str-viola": [48, 84],
  "str-spiccato": [48, 84],
  "str-violin-2": [55, 96],
  "str-violin-1": [55, 100],
  "str-upper": [67, 104],
  "str-high-octave": [67, 104],
}

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

function playbackMaterial(project: ComposerProject, plan: ArrangementPlan) {
  return buildSongPlaybackMaterial(project, plan.directive?.timelineConstraints)
}

function protectedForeground(project: ComposerProject, plan: ArrangementPlan): MelodyNote[] {
  const material = playbackMaterial(project, plan)
  return [
    ...material.lead,
    ...material.counterLayers,
    ...material.decorationLayers,
    ...material.phraseLayers,
    ...material.signaturePhraseLayers,
  ]
}

function chordPitchClassesAt(project: ComposerProject, note: GeneratedArrangementNote): Set<number> | null {
  const section = project.sections.find((candidate) => candidate.id === note.sectionId)
  if (!section) return null
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const localBeat = note.startBeat - (section.startBar - 1) * beatsPerBar
  const chord = project.chords
    .filter((candidate) => candidate.sectionId === section.id)
    .find((candidate) => localBeat >= candidate.startBeat && localBeat < candidate.startBeat + candidate.durationBeats)
  const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
  return parsed ? new Set([...parsed.tones, ...parsed.tensions].map((tone) => tone.pitchClass)) : null
}

function nearestAllowedPitch(pitch: number, allowed: Set<number>, low: number, high: number): number | null {
  const candidates: number[] = []
  for (let candidate = low; candidate <= high; candidate += 1) {
    if (allowed.has(((candidate % 12) + 12) % 12)) candidates.push(candidate)
  }
  return candidates.sort((left, right) => Math.abs(left - pitch) - Math.abs(right - pitch))[0] ?? null
}

function withRepair(
  note: GeneratedArrangementNote,
  pass: number,
  action: NonNullable<GeneratedArrangementNote["auditionRepair"]>["actions"][number],
  changes: Partial<GeneratedArrangementNote>,
): GeneratedArrangementNote {
  return {
    ...note,
    ...changes,
    auditionRepair: {
      pass,
      actions: [...new Set([...(note.auditionRepair?.actions ?? []), action])],
    },
  }
}

function auditionMetrics(
  project: ComposerProject,
  plan: ArrangementPlan,
  tracks: GeneratedArrangementTrack[],
): Omit<ArrangementAuditionReport, "repairPasses" | "removedNotes" | "shiftedNotes" | "velocityAdjustments"> {
  const material = playbackMaterial(project, plan)
  const foreground = protectedForeground(project, plan)
  const tonal = tracks.filter((track) => !track.muted && isTonal(track))
  const tonalNotes = tonal.flatMap((track) => track.notes.map((note) => ({ track, note })))
  const masking = tonalNotes.filter(({ track, note }) =>
    note.character === "safe"
    && (FOREGROUND_SUPPORT.has(track.id) || LAYER_TRACKS.has(track.id))
    && foreground.some((leadNote) => overlaps(note, leadNote) && Math.abs(note.pitch - leadNote.pitch) <= 5 && note.velocity >= leadNote.velocity - 22),
  )
  const melodicClarity = clamp(100 - masking.length / Math.max(1, foreground.length) * 75)

  const attackGroups = new Map<number, Set<string>>()
  for (const track of tracks.filter((candidate) => !candidate.muted)) for (const note of track.notes) {
    const key = Math.round(note.startBeat * 8)
    const group = attackGroups.get(key) ?? new Set<string>()
    group.add(track.id)
    attackGroups.set(key, group)
  }
  const fixedLayers = [
    material.counterLayers,
    material.decorationLayers,
    material.phraseLayers,
    material.signaturePhraseLayers,
  ]
  fixedLayers.forEach((notes, index) => notes.forEach((note) => {
    const key = Math.round(note.startBeat * 8)
    const group = attackGroups.get(key) ?? new Set<string>()
    group.add(`selected:${index}`)
    attackGroups.set(key, group)
  }))
  const congestedAttacks = [...attackGroups.values()].filter((group) => group.size > 9)
  const transientClarity = clamp(100 - congestedAttacks.reduce((sum, group) => sum + group.size - 9, 0) * 2.5)

  const lowFrames = new Map<number, Set<string>>()
  for (const track of tracks.filter((candidate) => !candidate.muted)) for (const note of track.notes) {
    if (track.family === "drums" ? !LOW_DRUM_TRACKS.has(track.id) : note.pitch >= 52) continue
    const first = Math.floor(note.startBeat * 2)
    const last = Math.max(first, Math.ceil((note.startBeat + Math.min(note.durationBeats, 4)) * 2) - 1)
    for (let frame = first; frame <= last; frame += 1) {
      const group = lowFrames.get(frame) ?? new Set<string>()
      group.add(track.id)
      lowFrames.set(frame, group)
    }
  }
  fixedLayers.forEach((notes, index) => notes.filter((note) => note.pitch < 52).forEach((note) => {
    const first = Math.floor(note.startBeat * 2)
    const last = Math.max(first, Math.ceil((note.startBeat + Math.min(note.durationBeats, 4)) * 2) - 1)
    for (let frame = first; frame <= last; frame += 1) {
      const group = lowFrames.get(frame) ?? new Set<string>()
      group.add(`selected:${index}`)
      lowFrames.set(frame, group)
    }
  }))
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
  const dynamicArc = plan.sections.length < 2
    ? 100
    : clamp((correlation(targetEnergy, perceivedDensity) + .2) / 1.2 * 100)

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
  const layerHarmonyViolations = tonalNotes.filter(({ track, note }) => {
    if (!LAYER_TRACKS.has(track.id) || note.character !== "safe") return false
    const allowed = chordPitchClassesAt(project, note)
    return allowed !== null && !allowed.has(((note.pitch % 12) + 12) % 12)
  }).length
  const issues: string[] = []
  if (layerHarmonyViolations > 0) issues.push("補助層に現在のコードから外れる音があります")
  if (melodicClarity < 82) issues.push("主旋律と補助パートの中域が重なりすぎています")
  if (lowEndClarity < 82) issues.push("低域の持続パートが同時に重なりすぎています")
  if (transientClarity < 82) issues.push("同時に始まるパートが多く、アタックが一塊になっています")
  if (registerBalance < 68) issues.push("Sectionで予定した音域配分と実音の分布が一致していません")
  if (dynamicArc < 68) issues.push("曲の強弱設計が実際の発音密度へ十分に現れていません")
  if (sectionContrast < 62) issues.push("Section境界の変化が聴感上弱くなっています")
  return {
    version: "1.0.0",
    score: Math.round(score * 10) / 10,
    passed: layerHarmonyViolations === 0
      && score >= 78
      && melodicClarity >= 72
      && lowEndClarity >= 68
      && transientClarity >= 68
      && registerBalance >= 55
      && dynamicArc >= 55
      && sectionContrast >= 55,
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
  pass: number,
  issues: readonly string[],
  editableTrackIds?: ReadonlySet<string>,
  editableSectionIds?: ReadonlySet<string>,
): { tracks: GeneratedArrangementTrack[]; removedNotes: number; shiftedNotes: number; velocityAdjustments: number } {
  const foreground = protectedForeground(project, plan)
  const attackCounts = new Map<number, Set<string>>()
  for (const track of tracks.filter((candidate) => !candidate.muted)) for (const note of track.notes) {
    const key = Math.round(note.startBeat * 8)
    const group = attackCounts.get(key) ?? new Set<string>()
    group.add(track.id)
    attackCounts.set(key, group)
  }
  const material = playbackMaterial(project, plan)
  ;[material.counterLayers, material.decorationLayers, material.phraseLayers, material.signaturePhraseLayers]
    .forEach((notes, index) => notes.forEach((note) => {
      const key = Math.round(note.startBeat * 8)
      const group = attackCounts.get(key) ?? new Set<string>()
      group.add(`selected:${index}`)
      attackCounts.set(key, group)
    }))
  const bass = tracks.find((track) => track.id === "syn-bass")?.notes ?? []
  let removedNotes = 0
  let shiftedNotes = 0
  let velocityAdjustments = 0
  const repaired = tracks.map((track): GeneratedArrangementTrack => ({
    ...track,
    notes: track.notes.flatMap((note, noteIndex): GeneratedArrangementNote[] => {
      if (track.muted || editableTrackIds && !editableTrackIds.has(track.id) || editableSectionIds && !editableSectionIds.has(note.sectionId)) return [note]
      let next = note
      const actions = new Set(note.auditionRepair?.actions ?? [])
      if (LAYER_TRACKS.has(track.id) && note.character === "safe") {
        const allowed = chordPitchClassesAt(project, next)
        const pitchClass = ((next.pitch % 12) + 12) % 12
        if (allowed && !allowed.has(pitchClass)) {
          const [low, high] = TRACK_RANGES[track.id] ?? [31, 100]
          const pitch = nearestAllowedPitch(next.pitch, allowed, low, high)
          if (pitch !== null && pitch !== next.pitch) {
            next = withRepair(next, pass, "harmony", {
              pitch,
              reason: `${next.reason}。現在のコードへ合わせて補助層を修正`,
            })
            shiftedNotes += 1
          }
        }
      }
      const sectionPlan = plan.sections.find((section) => section.sectionId === next.sectionId)
      if (sectionPlan && LAYER_TRACKS.has(track.id) && issues.some((issue) => issue.includes("音域配分")) && !actions.has("register")) {
        const [low, high] = TRACK_RANGES[track.id] ?? [31, 100]
        const strongest = [...(["low", "mid", "high"] as const)].sort((left, right) => {
          const weight = (value: "open" | "medium" | "strong") => value === "strong" ? 2 : value === "medium" ? 1 : 0
          return weight(sectionPlan.register[right]) - weight(sectionPlan.register[left])
        })[0]
        const wanted = strongest === "low" && next.pitch > 60
          ? next.pitch - 12
          : strongest === "high" && next.pitch < 72
            ? next.pitch + 12
            : strongest === "mid" && next.pitch < 52
              ? next.pitch + 12
              : strongest === "mid" && next.pitch >= 73
                ? next.pitch - 12
                : next.pitch
        if (wanted !== next.pitch && wanted >= low && wanted <= high) {
          next = withRepair(next, pass, "register", { pitch: wanted, reason: `${next.reason}。Sectionの音域配分へ合わせる` })
          shiftedNotes += 1
        }
      }
      if (sectionPlan && LAYER_TRACKS.has(track.id)
        && issues.some((issue) => issue.includes("強弱設計") || issue.includes("Section境界"))
        && !actions.has("energy")) {
        const targetVelocity = 28 + sectionPlan.energy * .68
        const difference = targetVelocity - next.velocity
        if (Math.abs(difference) >= 5) {
          next = withRepair(next, pass, "energy", {
            velocity: Math.max(1, Math.min(127, Math.round(next.velocity + Math.max(-8, Math.min(8, difference))))),
            reason: `${next.reason}。曲の強弱へ発音の存在感を合わせる`,
          })
          velocityAdjustments += 1
        }
      }
      const leadCollision = track.family !== "drums" && track.family !== "bass" && note.character === "safe"
        ? foreground.find((leadNote) => overlaps(next, leadNote) && Math.abs(next.pitch - leadNote.pitch) <= 5 && next.velocity >= leadNote.velocity - 22)
        : undefined
      if (leadCollision) {
        const [low, high] = TRACK_RANGES[track.id] ?? [31, 100]
        const previousPitch = track.notes.slice(0, noteIndex).reverse()
          .find((candidate) => candidate.sectionId === note.sectionId && Math.abs(candidate.pitch - note.pitch) <= 7)?.pitch
        const followingPitch = track.notes.slice(noteIndex + 1)
          .find((candidate) => candidate.sectionId === note.sectionId && Math.abs(candidate.pitch - note.pitch) <= 7)?.pitch
        const candidates = [next.pitch + 12, next.pitch - 12]
          .filter((candidate) => candidate >= low && candidate <= high
            && Math.abs(candidate - leadCollision.pitch) >= 9
            && (previousPitch === undefined || Math.abs(candidate - previousPitch) <= 10)
            && (followingPitch === undefined || Math.abs(candidate - followingPitch) <= 10))
          .sort((left, right) => {
            const cost = (pitch: number) => Math.abs(pitch - next.pitch)
              + (previousPitch === undefined ? 0 : Math.max(0, Math.abs(pitch - previousPitch) - 9) * 4)
              + (followingPitch === undefined ? 0 : Math.max(0, Math.abs(pitch - followingPitch) - 9) * 4)
            return cost(left) - cost(right)
          })
        const pitch = !actions.has("melody-space") ? candidates[0] : undefined
        if (pitch !== undefined) {
          next = withRepair(next, pass, "melody-space", {
            pitch,
            reason: `${next.reason}。主旋律の音域を空ける`,
          })
          shiftedNotes += 1
        } else {
          const velocity = Math.max(1, Math.min(next.velocity - 8, leadCollision.velocity - 24))
          next = withRepair(next, pass, actions.has("shorten") ? "melody-space" : "shorten", {
            velocity,
            durationBeats: actions.has("shorten") ? next.durationBeats : Math.min(next.durationBeats, .5),
            reason: `${next.reason}。主旋律の前を空ける`,
          })
          velocityAdjustments += 1
        }
      }
      if (LOW_SUPPORT.has(track.id) && next.pitch < 52 && bass.some((bassNote) => overlaps(next, bassNote))) {
        if (!actions.has("low-end")) {
          const [, high] = TRACK_RANGES[track.id] ?? [31, 100]
          next = withRepair(next, pass, "low-end", {
            pitch: Math.min(high, next.pitch + 12),
            reason: `${next.reason}。Bassと低域を分ける`,
          })
          shiftedNotes += 1
        } else if (LAYER_TRACKS.has(track.id) && next.velocity < 58) {
          removedNotes += 1
          return []
        }
      }
      const attackSize = attackCounts.get(Math.round(next.startBeat * 8))?.size ?? 0
      if (attackSize > 9 && (LAYER_TRACKS.has(track.id) || FOREGROUND_SUPPORT.has(track.id))) {
        if (actions.has("attack") && LAYER_TRACKS.has(track.id) && next.velocity < 64) {
          removedNotes += 1
          return []
        }
        const slot = [...`${track.id}:${note.id}`].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 3 + 1
        const shift = .25 * slot
        next = withRepair(next, pass, "attack", {
          startBeat: next.startBeat + shift,
          velocity: Math.max(1, next.velocity - Math.min(12, (attackSize - 8) * 2)),
          reason: `${next.reason}。同時アタックを前後へ分ける`,
        })
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
  options: {
    editableTrackIds?: ReadonlySet<string>
    editableSectionIds?: ReadonlySet<string>
  } = {},
): { tracks: GeneratedArrangementTrack[]; report: ArrangementAuditionReport } {
  let tracks = sourceTracks
  let metrics = auditionMetrics(project, plan, tracks)
  let repairPasses = 0
  let removedNotes = 0
  let shiftedNotes = 0
  let velocityAdjustments = 0
  for (let pass = 0; pass < maximumPasses && (!metrics.passed || metrics.issues.length > 0); pass += 1) {
    const repaired = repairPass(project, plan, tracks, pass + 1, metrics.issues, options.editableTrackIds, options.editableSectionIds)
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
