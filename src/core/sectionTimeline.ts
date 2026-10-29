import type { ChordEvent, ComposerProject } from "./project"
import type { MelodyNote, MelodyVariant } from "./melody"
import type { Section } from "./section"
import { parseTimeSignature } from "./section"
import { layersOf } from "./sectionLayers"
import { parseChordSymbol } from "./chord"
import { accompanimentEnabled } from "./sectionContent"
import { applyAccompanimentPattern } from "./accompanimentPattern"
import { decorationStructureFingerprint } from "./reactiveLayer"
import {
  applyPerformanceExecution,
  buildDefaultPerformancePlan,
} from "./performanceExecution"
import type { ArrangementTimelineConstraints } from "./arrangementGeneration"
import { applyArrangementTimelineToMelody, applySilenceRanges } from "./arrangementTimelineConstraints"

/** 配列順を曲順として扱い、startBarを1始まりで隙間なく再計算する。 */
export function normalizeSectionTimeline(sections: Section[]): Section[] {
  let startBar = 1
  return sections.map((section) => {
    const normalized = { ...section, startBar }
    startBar += Math.max(1, section.lengthBars)
    return normalized
  })
}

export function moveSectionInTimeline(sections: Section[], sectionId: string, targetIndex: number): Section[] {
  const sourceIndex = sections.findIndex((section) => section.id === sectionId)
  if (sourceIndex < 0) return normalizeSectionTimeline(sections)
  const boundedTarget = Math.max(0, Math.min(sections.length - 1, targetIndex))
  const reordered = [...sections]
  const [moved] = reordered.splice(sourceIndex, 1)
  reordered.splice(boundedTarget, 0, moved)
  return normalizeSectionTimeline(reordered)
}

/**
 * 生成した主旋律を1本の線にする。以前に作った候補には、同じ瞬間に始まる音や、
 * 次の音を越えて伸びる音が残っていることがあり、書き出すと音が重なって見える。
 * 同時に始まる音は和声音→固定した音→強さの順で1つ残し、次の音を越える音はその頭で切る。
 */
export function toSingleMelodyLine(source: readonly MelodyNote[], chords: readonly ChordEvent[]): MelodyNote[] {
  const sorted = [...source].sort((a, b) => a.startBeat - b.startBeat)
  const chosen: MelodyNote[] = []
  for (const note of sorted) {
    const previous = chosen.at(-1)
    if (!previous || Math.abs(previous.startBeat - note.startBeat) > 1e-9) {
      chosen.push({ ...note })
      continue
    }
    const chord = chords.find((c) => note.startBeat >= c.startBeat && note.startBeat < c.startBeat + c.durationBeats)
    const parsed = chord && parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    const priority = (n: MelodyNote) => (parsed && (parsed.bassPc === n.pitch % 12 || parsed.tones.some((t) => t.pitchClass === n.pitch % 12)) ? 1000 : 0)
      + (n.locks.includes("pitch") ? 200 : 0) + n.velocity + n.pitch / 1000
    if (priority(note) > priority(previous)) chosen[chosen.length - 1] = { ...note }
  }
  for (let index = 0; index + 1 < chosen.length; index++) {
    const gap = chosen[index + 1].startBeat - chosen[index].startBeat
    if (chosen[index].durationBeats > gap) chosen[index].durationBeats = gap
  }
  return chosen
}

/**
 * MIDI書き出し用の主旋律。取り込んだ原曲のメロディは再生・生成では触らないが、
 * 2声が重なったまま書き出すとDAW上で音が重なるため、書き出しだけ1本の線にする。
 */
export function exportableLead(material: Pick<SongPlaybackMaterial, "lead" | "chords">): MelodyNote[] {
  return toSingleMelodyLine(material.lead, material.chords)
}

export interface SongPlaybackMaterial {
  chords: ChordEvent[]
  /** 再生用: lead と accompaniment を合わせた全ノート */
  melody: MelodyNote[]
  /** Issue #41: MIDIのトラック分割用に partRole ごとへ分けたノート */
  lead: MelodyNote[]
  accompaniment: MelodyNote[]
  /** Issue #45: コードから導出した独立Accompaniment Patternレイヤー。 */
  accompanimentPattern: MelodyNote[]
  /** Imported MIDIに実在する、主旋律以外の原演奏。比較試聴では推定コードの代わりに使う。 */
  importedBacking: MelodyNote[]
  /** Issue #42: 採用中のCounter / Decoration独立レイヤー。 */
  reactiveLayers: MelodyNote[]
  counterLayers: MelodyNote[]
  decorationLayers: MelodyNote[]
  /** 採用済みの短いフレーズ／イントロフレーズ。 */
  phraseLayers: MelodyNote[]
  signaturePhraseLayers: MelodyNote[]
  totalBeats: number
}

function importedBackingNotes(project: ComposerProject): MelodyNote[] {
  if (project.sourceImport?.type !== "midi" || !project.importedArrangement) return []
  const sourceName = project.sourceImport.melodyTrackName.trim().toLocaleLowerCase()
  return project.importedArrangement.tracks
    .filter((track) =>
      track.role !== "melody" &&
      (sourceName.length === 0 || track.name.trim().toLocaleLowerCase() !== sourceName),
    )
    .flatMap((track, trackIndex) => track.notes.map((note, noteIndex): MelodyNote => ({
      id: `imported-backing:${trackIndex}:${noteIndex}`,
      startBeat: note[0],
      durationBeats: note[1],
      pitch: note[2],
      velocity: note[3],
      locks: [],
    })))
    .sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch)
}

function importedProtectedMelody(project: ComposerProject): MelodyNote[] {
  if (project.sourceImport?.type !== "midi" || !project.importedArrangement) return []
  const sourceName = project.sourceImport.melodyTrackName.trim().toLocaleLowerCase()
  const seen = new Set<string>()
  return project.importedArrangement.tracks
    .filter((track) =>
      track.role === "melody" ||
      (sourceName.length > 0 && track.name.trim().toLocaleLowerCase() === sourceName),
    )
    .flatMap((track, trackIndex) => track.notes.map((note, noteIndex): MelodyNote => ({
      id: `imported-source:${trackIndex}:${noteIndex}`,
      startBeat: note[0],
      durationBeats: note[1],
      pitch: note[2],
      velocity: note[3],
      locks: [],
    })))
    .filter((note) => {
      const key = `${note.startBeat}:${note.durationBeats}:${note.pitch}:${note.velocity}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch)
}

/** セクション相対イベントを曲全体の絶対拍へ変換する。 */
export function buildSongPlaybackMaterial(
  project: ComposerProject,
  timelineConstraints?: ArrangementTimelineConstraints,
): SongPlaybackMaterial {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const chords: ChordEvent[] = []
  const lead: MelodyNote[] = []
  const accompaniment: MelodyNote[] = []
  const accompanimentPattern: MelodyNote[] = []
  const reactiveLayers: MelodyNote[] = []
  const counterLayers: MelodyNote[] = []
  const decorationLayers: MelodyNote[] = []
  const phraseLayers: MelodyNote[] = []
  const signaturePhraseLayers: MelodyNote[] = []
  const protectedImportedLead = importedProtectedMelody(project)
  const importedBacking = importedBackingNotes(project)
  const sections = normalizeSectionTimeline(project.sections)

  for (const [sectionIndex, section] of sections.entries()) {
    const offset = (section.startBar - 1) * beatsPerBar
    const sectionChords = project.chords
      .filter((candidate) => candidate.sectionId === section.id)
      .sort((a, b) => a.startBeat - b.startBeat)
    const variantId = project.sectionMelodyAssignments[section.id]
    const variant = variantId
      ? project.melodyVariants.find((candidate) => candidate.id === variantId && candidate.sectionId === section.id)
      : undefined
    const sectionLeadNotes = variant
      ? layersOf(variant)
          .filter((layer) => layer.partRole === "lead")
          .flatMap((layer) => layer.notes)
      : []
    // Issue #30: 接続計画は曲全体Preview/MIDIで同じ材料へ実音化する。
    // 前セクション本体は保存時に書き換えず、採用中の組み合わせに対してだけ境界を組み立てる。
    const transitionContextIsCurrent =
      variant?.transitionPlan &&
      project.sectionMelodyAssignments[variant.transitionPlan.sourceSectionId] ===
        variant.transitionPlan.sourceVariantId &&
      sections[sectionIndex - 1]?.id === variant.transitionPlan.sourceSectionId
    if (variant?.transitionPlan && transitionContextIsCurrent) {
      const plan = variant.transitionPlan
      const sourceNotes = lead
        .filter((note) => note.id.startsWith(`${plan.sourceSectionId}:`))
        .sort((a, b) => a.startBeat - b.startBeat)
      const sourceLast = sourceNotes[sourceNotes.length - 1]
      const firstCurrentBeat = sectionLeadNotes.length > 0
        ? offset + Math.min(...sectionLeadNotes.map((note) => note.startBeat))
        : offset
      if (sourceLast && plan.sustainAcrossBoundaryBeats > 0) {
        const heldUntil = Math.min(offset + plan.sustainAcrossBoundaryBeats, firstCurrentBeat)
        sourceLast.durationBeats = Math.max(
          sourceLast.durationBeats,
          heldUntil - sourceLast.startBeat,
        )
      }
      if (plan.pickup) {
        const pickupStart = offset - plan.pickup.durationBeats
        // 弱起が鳴る区間は前セクションの音と重ねない。弱起より前に始まる音は弱起の頭で切り、
        // 弱起の区間に始まる音(前セクション自身の終音や弱起)は弱起へ置き換える。
        for (let index = lead.length - 1; index >= 0; index--) {
          const note = lead[index]
          if (!note.id.startsWith(`${plan.sourceSectionId}:`)) continue
          if (note.startBeat >= pickupStart) lead.splice(index, 1)
          else if (note.startBeat + note.durationBeats > pickupStart) note.durationBeats = pickupStart - note.startBeat
        }
        lead.push({
          id: `${section.id}:transition-pickup:${variant.id}`,
          startBeat: Math.max(0, pickupStart),
          durationBeats: plan.pickup.durationBeats,
          pitch: plan.pickup.pitch,
          velocity: plan.pickup.velocity,
          locks: [],
          plannedToneRole: "anticipation",
          plannedResolution: sectionLeadNotes[0]
            ? {
                targetPitchClass: ((sectionLeadNotes[0].pitch % 12) + 12) % 12,
                targetBeat: offset + sectionLeadNotes[0].startBeat,
                maximumDelayBeats: 1,
              }
            : undefined,
        })
      }
    }
    // Issue #41: accompaniment="none"(Silence)のセクションは伴奏を鳴らさない。
    // ここで除外しないと Silence と Chords Only が曲全体再生・曲全体MIDIで同じ結果になる。
    if (accompanimentEnabled(section)) {
      for (const chord of sectionChords) {
        chords.push({ ...chord, startBeat: offset + chord.startBeat })
      }
    }
    const patternId = project.sectionAccompanimentPatternAssignments?.[section.id]
    const pattern = patternId
      ? project.accompanimentPatterns?.find((candidate) => candidate.id === patternId)
      : undefined
    if (pattern) {
      const generatedPatternNotes = applyAccompanimentPattern(
        pattern,
        sectionChords,
        section.lengthBars * beatsPerBar,
        { melodyNotes: sectionLeadNotes },
      )
      const performancePlan =
        project.sectionPerformancePlans?.[section.id]?.["pulse-foundation"] ??
        project.sectionPerformancePlans?.[section.id]?.["harmonic-space"] ??
        buildDefaultPerformancePlan("pulse-foundation", section.role)
      const patternNotes = applyPerformanceExecution(
        generatedPatternNotes,
        performancePlan,
        {
          totalBeats: section.lengthBars * beatsPerBar,
          beatsPerBar,
          bpm: project.song.tempo,
          chordBoundaryBeats: sectionChords.map((chord) => chord.startBeat),
          melodyNotes: sectionLeadNotes,
        },
      ).notes
      for (const note of patternNotes) {
        accompanimentPattern.push({
          ...note,
          id: `${section.id}:${note.id}`,
          startBeat: offset + note.startBeat,
        })
      }
    }
    const reactiveIds = [
      project.sectionReactiveLayerAssignments?.[section.id],
      project.sectionDecorationLayerAssignments?.[section.id],
    ].filter((id): id is string => Boolean(id))
    const previousSection = sectionIndex > 0 ? sections[sectionIndex - 1] : undefined
    const nextSection = sections[sectionIndex + 1]
    const nextSectionFirstChord = nextSection
      ? project.chords
          .filter((chord) => chord.sectionId === nextSection.id)
          .sort((a, b) => a.startBeat - b.startBeat)[0]?.symbol
      : undefined
    const currentDecorationFingerprint = decorationStructureFingerprint({
      sectionId: section.id,
      sectionRole: section.role,
      chords: sectionChords,
      totalBeats: section.lengthBars * beatsPerBar,
      previousSectionRole: previousSection?.role,
      nextSectionRole: nextSection?.role,
      nextSectionFirstChord,
      isLastSection: !nextSection,
    })
    const reactiveCandidates = reactiveIds
      .map((reactiveId) =>
        project.reactiveLayerCandidates?.find(
          (candidate) =>
            candidate.id === reactiveId &&
            candidate.sectionId === section.id &&
            (candidate.kind === "decoration" ||
              candidate.targetMelodyVariantId === variant?.id),
        ),
      )
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .filter(
        (candidate) =>
          candidate.kind !== "decoration" ||
          candidate.structureFingerprint === currentDecorationFingerprint,
      )
    for (const reactive of reactiveCandidates) {
      const roleTarget = reactive.kind === "decoration" ? decorationLayers : counterLayers
      for (const note of reactive.notes) {
        const absoluteNote = {
          ...note,
          id: `${section.id}:reactive:${note.id}`,
          startBeat: offset + note.startBeat,
        }
        reactiveLayers.push(absoluteNote)
        roleTarget.push(absoluteNote)
      }
    }
    const phraseId = project.sectionPhraseAssignments?.[section.id]
    const phrase = phraseId
      ? project.phraseCandidates.find(
          (candidate) => candidate.id === phraseId && candidate.sectionId === section.id,
        )
      : undefined
    if (phrase) {
      for (const note of phrase.notes) {
        phraseLayers.push({
          ...note,
          id: `${section.id}:phrase:${note.id}`,
          startBeat: offset + note.startBeat,
        })
      }
    }
    const signaturePhraseId = project.sectionSignaturePhraseAssignments?.[section.id]
    const signaturePhrase = signaturePhraseId
      ? project.signaturePhraseCandidates.find(
          (candidate) =>
            candidate.id === signaturePhraseId && candidate.sectionId === section.id,
        )
      : undefined
    if (signaturePhrase) {
      for (const note of signaturePhrase.notes) {
        signaturePhraseLayers.push({
          ...note,
          id: `${section.id}:signature:${note.id}`,
          startBeat: offset + note.startBeat,
        })
      }
    }
    if (!variant) continue
    // Issue #41: partRoleの正はLayer。曲全体へ展開する際も役割ごとに分けて持つ
    for (const layer of layersOf(variant)) {
      if (layer.partRole === "lead" && protectedImportedLead.length > 0) continue
      const target = layer.partRole === "accompaniment" ? accompaniment : lead
      for (const note of layer.notes) {
        target.push({ ...note, id: `${section.id}:${note.id}`, startBeat: offset + note.startBeat })
      }
    }
  }

  const byBeat = (a: MelodyNote, b: MelodyNote) => a.startBeat - b.startBeat
  // 取り込んだ原曲の主旋律は保護して触らない。生成した主旋律だけを1本の線に整える。
  const singleLine = toSingleMelodyLine(lead, chords)
  lead.length = 0
  lead.push(...singleLine)
  if (protectedImportedLead.length > 0) lead.push(...protectedImportedLead)
  const totalBars = project.sections.reduce((sum, section) => sum + Math.max(1, section.lengthBars), 0)
  const constrainedLead = applyArrangementTimelineToMelody(lead, timelineConstraints, beatsPerBar).sort(byBeat)
  const fullSilenceRanges = timelineConstraints?.fullSilenceRanges ?? []
  const constrainedChords = applySilenceRanges(chords, fullSilenceRanges, beatsPerBar)
    .sort((a, b) => a.startBeat - b.startBeat)
  const constrainedAccompaniment = applySilenceRanges(accompaniment, fullSilenceRanges, beatsPerBar).sort(byBeat)
  const constrainedPattern = applySilenceRanges(accompanimentPattern, fullSilenceRanges, beatsPerBar).sort(byBeat)
  const constrainedBacking = applySilenceRanges(importedBacking, fullSilenceRanges, beatsPerBar).sort(byBeat)
  const constrainedReactive = applySilenceRanges(reactiveLayers, fullSilenceRanges, beatsPerBar).sort(byBeat)
  const constrainedCounter = applySilenceRanges(counterLayers, fullSilenceRanges, beatsPerBar).sort(byBeat)
  const constrainedDecoration = applySilenceRanges(decorationLayers, fullSilenceRanges, beatsPerBar).sort(byBeat)
  const constrainedPhrases = applySilenceRanges(phraseLayers, fullSilenceRanges, beatsPerBar).sort(byBeat)
  const constrainedSignaturePhrases = applySilenceRanges(signaturePhraseLayers, fullSilenceRanges, beatsPerBar).sort(byBeat)
  return {
    chords: constrainedChords,
    melody: [
      ...constrainedLead,
      ...constrainedAccompaniment,
      ...constrainedReactive,
      ...constrainedPhrases,
      ...constrainedSignaturePhrases,
    ].sort(byBeat),
    lead: constrainedLead,
    accompaniment: constrainedAccompaniment,
    accompanimentPattern: constrainedPattern,
    importedBacking: constrainedBacking,
    reactiveLayers: constrainedReactive,
    counterLayers: constrainedCounter,
    decorationLayers: constrainedDecoration,
    phraseLayers: constrainedPhrases,
    signaturePhraseLayers: constrainedSignaturePhrases,
    totalBeats: totalBars * beatsPerBar,
  }
}

export function assignedVariantForSection(project: ComposerProject, sectionId: string): MelodyVariant | undefined {
  const assignedId = project.sectionMelodyAssignments[sectionId]
  if (!assignedId) return undefined
  return project.melodyVariants.find((variant) => variant.id === assignedId && variant.sectionId === sectionId)
}
