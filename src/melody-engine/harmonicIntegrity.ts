import { allUsablePitchClasses, chordTonePitchClasses, isChordTone, isTensionTone, parseChordSymbol } from "@/core/chord"
import type { MelodyNote, PlannedResolution, PlannedToneRole } from "@/core/melody"
import type { ChordEvent } from "@/core/project"
import { pitchClass } from "@/core/note"

export interface HarmonicIntegrityDiagnostics {
  correctedPitchCount: number
  shortenedAcrossBoundaryCount: number
  repairedResolutionCount: number
  staleResolutionCount: number
}

export interface HarmonicIntegrityResult {
  notes: MelodyNote[]
  diagnostics: HarmonicIntegrityDiagnostics
}

export interface HarmonicIntegrityOptions {
  /** 次Sectionのコードが入力外にあるDecoration終端など、明示的な先取音だけに使用する。 */
  preserveTerminalTension?: boolean
  /** Profile表情設計の検証用に、協和音へ到達済みでも元の表情ラベルを保持する。 */
  preserveExpressiveChordRoles?: boolean
}

const EPSILON = 0.06

function chordAtBeatStrict(chords: readonly ChordEvent[], beat: number): ChordEvent | undefined {
  return chords.find(
    (chord) => beat >= chord.startBeat && beat < chord.startBeat + chord.durationBeats,
  )
}

function nearestPitchForClasses(
  desired: number,
  pitchClasses: readonly number[],
  low: number,
  high: number,
): number {
  const candidates: number[] = []
  for (let pitch = low; pitch <= high; pitch++) {
    if (pitchClasses.includes(pitchClass(pitch))) candidates.push(pitch)
  }
  if (candidates.length === 0) return Math.max(0, Math.min(127, Math.round(desired)))
  return candidates.reduce((best, candidate) => {
    const distance = Math.abs(candidate - desired)
    const bestDistance = Math.abs(best - desired)
    return distance < bestDistance || (distance === bestDistance && candidate < best) ? candidate : best
  }, candidates[0])
}

function isStrongBeat(note: MelodyNote, chord: ChordEvent): boolean {
  return (
    Math.abs(note.startBeat - chord.startBeat) < EPSILON ||
    Math.abs(note.startBeat - Math.round(note.startBeat)) < EPSILON
  )
}

function actualResolution(
  note: MelodyNote,
  notes: readonly MelodyNote[],
  chords: readonly ChordEvent[],
): { resolution: PlannedResolution; role: PlannedToneRole } | null {
  const planned = note.plannedResolution
  const later = notes.filter((candidate) => candidate.startBeat > note.startBeat + EPSILON)
  const plannedTarget = planned
    ? later.find(
        (candidate) =>
          candidate.startBeat >= note.startBeat + note.durationBeats - EPSILON &&
          candidate.startBeat <= planned.targetBeat + planned.maximumDelayBeats + EPSILON &&
          pitchClass(candidate.pitch) === planned.targetPitchClass &&
          candidate.startBeat - note.startBeat <= planned.maximumDelayBeats + EPSILON,
      )
    : undefined
  // 後段の輪郭処理でpitchだけが変わり、解決メタデータが古くなる場合がある。
  // その場合も、実音として順次進行する直近のコードトーンなら解決として再結合する。
  const target =
    plannedTarget ??
    later.find(
      (candidate) =>
        candidate.startBeat - note.startBeat <= 1.5 + EPSILON &&
        Math.abs(candidate.pitch - note.pitch) <= 2,
    )
  if (!target || Math.abs(target.pitch - note.pitch) > 2) return null
  const targetChord = chordAtBeatStrict(chords, target.startBeat)
  if (!targetChord) return null
  const parsedTarget = parseChordSymbol(targetChord.symbol, targetChord.bass ?? undefined)
  if (!parsedTarget || !allUsablePitchClasses(parsedTarget).includes(pitchClass(target.pitch))) return null
  const resolution: PlannedResolution = {
    targetPitchClass: pitchClass(target.pitch),
    targetBeat: target.startBeat,
    maximumDelayBeats: Math.max(0.25, target.startBeat - note.startBeat),
  }
  return {
    resolution,
    role: isStrongBeat(note, chordAtBeatStrict(chords, note.startBeat) ?? targetChord)
      ? "appoggiatura"
      : "approach-tone",
  }
}

/**
 * 全Generator共通の最終和声検査。
 *
 * 生成意図を保つためコードトーンへの一律スナップは行わない。一方で、後処理後に
 * 解決先が消えた非和声音と、次コードまで無根拠に伸びた持続音はここで確実に修復する。
 */
export function enforceHarmonicIntegrity(
  sourceNotes: readonly MelodyNote[],
  sourceChords: readonly ChordEvent[],
  range?: { low: number; high: number },
  options: HarmonicIntegrityOptions = {},
): HarmonicIntegrityResult {
  const chords = [...sourceChords].sort((left, right) => left.startBeat - right.startBeat)
  const notes = sourceNotes
    .map((note) => ({ ...note, plannedResolution: note.plannedResolution ? { ...note.plannedResolution } : undefined }))
    .sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch)
  const diagnostics: HarmonicIntegrityDiagnostics = {
    correctedPitchCount: 0,
    shortenedAcrossBoundaryCount: 0,
    repairedResolutionCount: 0,
    staleResolutionCount: 0,
  }
  const correctedNoteIds = new Set<string>()
  if (chords.length === 0 || notes.length === 0) return { notes, diagnostics }

  for (const [noteIndex, note] of notes.entries()) {
    const originalRole = note.plannedToneRole
    const chord = chordAtBeatStrict(chords, note.startBeat)
    if (!chord) continue
    const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    if (!parsed) continue
    const pc = pitchClass(note.pitch)
    const chordTones = chordTonePitchClasses(parsed)
    const usable = allUsablePitchClasses(parsed)
    const resolution = actualResolution(note, notes, chords)
    if (note.plannedResolution && !resolution) diagnostics.staleResolutionCount++

    const nextChord = chords.find(
      (candidate) => candidate.startBeat > note.startBeat + EPSILON && candidate.startBeat < note.startBeat + note.durationBeats - EPSILON,
    )
    if (nextChord) {
      const nextParsed = parseChordSymbol(nextChord.symbol, nextChord.bass ?? undefined)
      const safeAcrossBoundary = nextParsed && allUsablePitchClasses(nextParsed).includes(pc)
      const resolvesAfterBoundary = resolution && resolution.resolution.targetBeat >= nextChord.startBeat - EPSILON
      if (!safeAcrossBoundary && !resolvesAfterBoundary) {
        // 開始音の輪郭を別音へ置き換えるより、境界で音価を止める方が生成意図を保てる。
        note.durationBeats = Math.max(0.125, nextChord.startBeat - note.startBeat)
        diagnostics.shortenedAcrossBoundaryCount++
      }
    }

    const updatedPc = pitchClass(note.pitch)
    const updatedIsChordTone = isChordTone(parsed, updatedPc)
    const updatedIsTension = isTensionTone(parsed, updatedPc)
    if (updatedIsChordTone) {
      if (!resolution) {
        if (
          note.plannedToneRole !== "common-tone" &&
          note.plannedToneRole !== "tension-hold" &&
          !(
            options.preserveExpressiveChordRoles &&
            (note.plannedToneRole === "suspension" ||
              note.plannedToneRole === "appoggiatura" ||
              note.plannedToneRole === "anticipation")
          )
        ) {
          note.plannedToneRole = "chord-tone"
        }
        note.plannedResolution = undefined
      }
      continue
    }

    // tension-holdは「解決を急がず色彩を保持する」という明示的な生成判断。
    // Transition終端では次Sectionの先取音もこの役割で表現されるため、現在コードだけで潰さない。
    if (
      note.plannedToneRole === "tension-hold" &&
      (updatedIsTension ||
        (options.preserveTerminalTension && noteIndex === notes.length - 1))
    ) {
      note.plannedResolution = undefined
      continue
    }

    if (resolution) {
      note.plannedToneRole =
        options.preserveExpressiveChordRoles &&
        (originalRole === "suspension" ||
          originalRole === "appoggiatura" ||
          originalRole === "anticipation")
          ? originalRole
          : resolution.role
      note.plannedResolution = resolution.resolution
      diagnostics.repairedResolutionCount++
      continue
    }

    const intentionalTension =
      updatedIsTension &&
      (note.plannedToneRole === "suspension" ||
        note.plannedToneRole === "anticipation")
    if (intentionalTension && !isStrongBeat(note, chord)) {
      note.plannedResolution = undefined
      continue
    }
    const correctionClasses = chordTones.length > 0 ? chordTones : usable
    const previous = notes[noteIndex - 1]
    const next = notes[noteIndex + 1]
    const low = Math.max(0, range?.low ?? note.pitch - 12)
    const high = Math.min(127, range?.high ?? note.pitch + 12)
    const candidates = Array.from({ length: high - low + 1 }, (_, index) => low + index)
      .filter((candidate) => correctionClasses.includes(pitchClass(candidate)))
    const corrected = candidates.length > 0
      ? candidates.reduce((best, candidate) => {
          const score =
            Math.abs(candidate - note.pitch) * 1.5 +
            (previous ? Math.abs(candidate - previous.pitch) * 0.75 : 0) +
            (next ? Math.abs(next.pitch - candidate) * 0.35 : 0) +
            (previous && Math.abs(candidate - previous.pitch) > 4 ? 12 : 0)
          const bestScore =
            Math.abs(best - note.pitch) * 1.5 +
            (previous ? Math.abs(best - previous.pitch) * 0.75 : 0) +
            (next ? Math.abs(next.pitch - best) * 0.35 : 0) +
            (previous && Math.abs(best - previous.pitch) > 4 ? 12 : 0)
          return score < bestScore ? candidate : best
        }, candidates[0])
      : nearestPitchForClasses(note.pitch, correctionClasses, low, high)
    if (corrected !== note.pitch) {
      diagnostics.correctedPitchCount++
      correctedNoteIds.add(note.id)
    }
    note.pitch = corrected
    note.plannedToneRole =
      options.preserveExpressiveChordRoles &&
      (originalRole === "suspension" ||
        originalRole === "appoggiatura" ||
        originalRole === "anticipation")
        ? originalRole
        : "chord-tone"
    note.plannedResolution = undefined
  }

  // 和声補正そのものが「跳躍後の反対方向への順次回収」を壊さないようにする。
  // 補正に関与した箇所だけを対象にし、Generatorが意図した連続跳躍には触れない。
  for (let index = 2; index < notes.length; index++) {
    const before = notes[index - 2]
    const previous = notes[index - 1]
    const current = notes[index]
    if (!correctedNoteIds.has(previous.id) && !correctedNoteIds.has(current.id)) continue
    const leap = previous.pitch - before.pitch
    const recovery = current.pitch - previous.pitch
    if (Math.abs(leap) < 8) continue
    if (Math.abs(recovery) <= 3 && Math.sign(recovery) === -Math.sign(leap)) continue
    const chord = chordAtBeatStrict(chords, current.startBeat)
    const parsed = chord ? parseChordSymbol(chord.symbol, chord.bass ?? undefined) : null
    if (!parsed) continue
    const low = Math.max(0, range?.low ?? previous.pitch - 12)
    const high = Math.min(127, range?.high ?? previous.pitch + 12)
    const recoveryCandidates = Array.from({ length: high - low + 1 }, (_, offset) => low + offset)
      .filter((candidate) => chordTonePitchClasses(parsed).includes(pitchClass(candidate)))
      .filter((candidate) => {
        const interval = candidate - previous.pitch
        return Math.abs(interval) >= 1 && Math.abs(interval) <= 3 && Math.sign(interval) === -Math.sign(leap)
      })
    if (recoveryCandidates.length === 0) continue
    const corrected = recoveryCandidates.reduce((best, candidate) =>
      Math.abs(candidate - current.pitch) < Math.abs(best - current.pitch) ? candidate : best,
    )
    if (corrected !== current.pitch) {
      const expressiveRole = current.plannedToneRole
      current.pitch = corrected
      current.plannedToneRole =
        options.preserveExpressiveChordRoles &&
        (expressiveRole === "suspension" ||
          expressiveRole === "appoggiatura" ||
          expressiveRole === "anticipation")
          ? expressiveRole
          : "chord-tone"
      current.plannedResolution = undefined
      diagnostics.correctedPitchCount++
    }
  }

  return { notes, diagnostics }
}
