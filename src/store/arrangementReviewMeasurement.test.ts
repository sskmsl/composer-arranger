import { afterEach, describe, expect, it, vi } from "vitest"
import { writeFileSync } from "node:fs"
import { arrangementReviewSong } from "./arrangementReviewFixtures"
import { useProjectStore } from "./useProjectStore"
import { notesByPartRole } from "@/core/sectionLayers"
import type { MelodyNote } from "@/core/melody"
import { arrangementQualityDiagnostics, generateFullSongArrangement, reviewGeneratedArrangement } from "@/melody-engine/arrangementGenerator"
import { allUsablePitchClasses, parseChordSymbol } from "@/core/chord"
import { keyScalePitchClasses, parseKey } from "@/core/scale"
import { effectiveSectionKey, normalizeProject } from "@/core/project"
import { measureBass, measureBreathing, measureLowEnd, measurePadMotion } from "./arrangementPerformanceMeasurements"
import { chorusBassActivity } from "@/melody-engine/chorusBassActivity"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"

function lcs(a: number[], b: number[]) {
  let row = Array(b.length + 1).fill(0) as number[]
  for (const x of a) {
    const next = [0]
    for (let j = 0; j < b.length; j++) next.push(x === b[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]))
    row = next
  }
  return row[b.length] / Math.max(1, a.length, b.length)
}
function similarity(a: MelodyNote[], b: MelodyNote[]) {
  const set = (notes: MelodyNote[], pitch = false) => new Set(notes.map((n) => `${Math.round(n.startBeat * 4)}${pitch ? `:${n.pitch}` : ""}`))
  const jaccard = (x: Set<string>, y: Set<string>) => [...x].filter((v) => y.has(v)).length / Math.max(1, new Set([...x, ...y]).size)
  const contour = (notes: MelodyNote[]) => notes.slice(1).map((n, i) => Math.sign(n.pitch - notes[i].pitch))
  return { rhythm: jaccard(set(a), set(b)), exact: jaccard(set(a, true), set(b, true)), contour: lcs(contour(a), contour(b)) }
}
afterEach(() => vi.restoreAllMocks())

describe("レビュー指定2曲の決定的測定", () => {
  it("各6seedで採用・全曲生成し、測定値を記録する", () => {
    const results = []
    for (const which of ["A", "B"] as const) for (let seed = 1; seed <= 6; seed++) {
      let randomState = seed
      let uuidIndex = 0
      vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++uuidIndex).padStart(12, "0")}`)
      vi.spyOn(Math, "random").mockImplementation(() => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
        return randomState / 4294967296
      })
      useProjectStore.setState({ project: arrangementReviewSong(which), persist: () => {}, history: [], future: [],
        generationSettings: { density: "balanced", rangePreset: "middle", customRange: { low: 60, high: 77 }, drama: "growing", selectedGeneratorProfiles: ["standard"], techniqueExperimentPresetId: null },
      })
      for (const section of useProjectStore.getState().project.sections) {
        useProjectStore.getState().generateForSection(section.id)
        const state = useProjectStore.getState()
        const candidate = state.project.melodyVariants.find((v) => v.sectionId === section.id && v.batchId === state.activeBatchId)!
        expect(candidate, `${which}/${seed}/${section.name}`).toBeDefined()
        expect(candidate.notes.every((n) => n.pitch >= 60 && n.pitch <= (section.role === "grand-chorus" ? 79 : 77))).toBe(true)
        state.assignVariantToSection(section.id, candidate.id)
      }
      const project = useProjectStore.getState().project
      const lead = (index: number) => notesByPartRole(project.melodyVariants.find((v) => v.id === project.sectionMelodyAssignments[project.sections[index].id])!, "lead")
      const avg = (notes: MelodyNote[]) => notes.reduce((s, n) => s + n.pitch, 0) / notes.length
      const peak = (notes: MelodyNote[]) => Math.max(...notes.map((n) => n.pitch))
      const protectedMelodies = structuredClone(project.melodyVariants)
      const arrangement = seed <= 3 ? generateFullSongArrangement(project, { seed }) : null
      expect(project.melodyVariants).toEqual(protectedMelodies)
      if (arrangement?.backgroundVoiceRepairs) {
        const report = arrangement.backgroundVoiceRepairs
        expect(report.records.length).toBeLessThanOrEqual(Math.floor(report.sourcePadNoteCount * .05))
        expect(new Set(report.records.map((r) => r.noteId)).size).toBe(report.records.length)
        const leadNotes = buildSongPlaybackMaterial(project, arrangement.plan.directive?.timelineConstraints).lead
        const padNotes = arrangement.tracks.find((t) => t.id === "syn-dark-pad")!.notes
        for (const record of report.records) {
          expect(record.trackId).toBe("syn-dark-pad")
          expect(leadNotes.some((n) => Math.abs(n.pitch - record.attemptedPitch) <= 2
            && n.startBeat < record.startBeat + record.originalDurationBeats
            && n.startBeat + n.durationBeats > record.startBeat)).toBe(true)
          const note = padNotes.find((n) => n.id === record.noteId)
          if (record.action === "shorten") {
            expect(note!.startBeat).toBe(record.startBeat)
            expect(note!.durationBeats).toBe(record.durationBeats)
            expect(note!.startBeat + note!.durationBeats).toBeCloseTo(record.collisionStartBeat, 8)
          } else expect(note).toBeUndefined()
          expect(padNotes.some((n) => n.sectionId === record.sectionId && n.id !== record.noteId
            && n.startBeat < record.startBeat + record.originalDurationBeats
            && n.startBeat + n.durationBeats > record.startBeat)).toBe(true)
        }
      }
      const gmDrumPitches = new Set([35, 36, 37, 38, 39, 40, 41, 42, 45, 46, 49, 50, 51, 52, 63, 82])
      const drumPitchViolations = arrangement?.tracks.filter((t) => t.family === "drums")
        .flatMap((t) => t.notes).filter((n) => !gmDrumPitches.has(n.pitch)).length ?? 0
      expect(drumPitchViolations).toBe(0)
      const legacy = arrangement ? structuredClone(arrangement) : null
      if (legacy) {
        legacy.tracks.forEach((t) => t.notes.forEach((n) => { delete n.voiceId }))
        const before = reviewGeneratedArrangement(legacy, project)
        const loaded = normalizeProject(JSON.parse(JSON.stringify({ ...project, fullSongArrangement: legacy })))
        expect(reviewGeneratedArrangement(loaded.fullSongArrangement!, loaded)).toEqual(before)
        expect(before.metrics.largeSupportLeapCount).toBe(arrangementQualityDiagnostics(project, legacy).legacyLeaps.length)
      }
      const repeated = [4, 5].map((index, pair) => {
        const section = project.sections[index], source = lead(pair === 0 ? 1 : 3)
        const candidates = project.melodyVariants.filter((v) => v.sectionId === section.id).slice(0, 3).map((v) => notesByPartRole(v, "lead"))
        const key = effectiveSectionKey(project, section.id), parsedKey = parseKey(key)
        const scale = new Set(keyScalePitchClasses(key))
        if (parsedKey?.isMinor) scale.add((parsedKey.rootPc + 11) % 12)
        const chords = project.chords.filter((c) => c.sectionId === section.id)
        const harmonic = (notes: MelodyNote[]) => {
          const tail = notes.filter((n) => n.startBeat >= section.lengthBars * 4 - 8)
          const chordOf = (n: MelodyNote) => parseChordSymbol(chords.find((c) => n.startBeat >= c.startBeat && n.startBeat < c.startBeat + c.durationBeats)?.symbol ?? chords.at(-1)!.symbol)!
          const strong = tail.filter((n) => Math.abs(n.startBeat / 2 - Math.round(n.startBeat / 2)) < 1e-6)
          const last = notes.at(-1)!
          return { count: tail.length, scaleOutside: tail.filter((n) => !scale.has(n.pitch % 12)).length,
            chordOutside: tail.filter((n) => !allUsablePitchClasses(chordOf(n)).includes(n.pitch % 12)).length,
            strongCount: strong.length, strongChord: strong.filter((n) => chordOf(n).tones.some((t) => t.pitchClass === n.pitch % 12)).length,
            cadence: last.durationBeats >= 1 && chordOf(last).tones.some((t) => t.pitchClass === last.pitch % 12),
          }
        }
        return { source: harmonic(source), candidates: candidates.map((notes) => ({ ...harmonic(notes), ...similarity(source, notes),
          hook: notes.filter((n) => n.startBeat < 8).map(({ pitch, startBeat, durationBeats, velocity }) => ({ pitch, startBeat, durationBeats, velocity })),
        })), sourceHook: source.filter((n) => n.startBeat < 8).map(({ pitch, startBeat, durationBeats, velocity }) => ({ pitch, startBeat, durationBeats, velocity })),
        candidatePairs: [[0, 1], [0, 2], [1, 2]].map(([a, b]) => similarity(candidates[a], candidates[b]).exact) }
      })
      results.push({ which, seed, pairs: [similarity(lead(1), lead(4)), similarity(lead(3), lead(5))],
        means: [avg(lead(3)), avg(lead(5)), avg(lead(7))], peaks: [peak(lead(3)), peak(lead(5)), peak(lead(7))],
        breathing: project.sections.map((s, i) => ({ name: s.name, bars: s.lengthBars, ...measureBreathing(lead(i), s.lengthBars * 4) })),
        lowEnd: arrangement ? measureLowEnd(arrangement.tracks, arrangement.analysis.totalBeats) : null, drumPitchViolations,
        bass: arrangement ? measureBass(project, arrangement) : null,
        padMotion: arrangement ? measurePadMotion(arrangement.tracks) : null,
        backgroundRepairs: arrangement?.backgroundVoiceRepairs,
        bassSignals: project.sections.flatMap((s, i) => ["chorus", "grand-chorus"].includes(s.role)
          ? [{ name: s.name, ...chorusBassActivity(project, s.id, lead(i).reduce((sum, n) => sum + n.durationBeats, 0) / (s.lengthBars * 4)) }] : []),
        auditMaterial: arrangement && process.env.ARRANGEMENT_REVIEW_RESULT_PATH ? { project, arrangement } : undefined,
        repeated, sections: arrangement ? project.sections.map((s) => {
          const start = (s.startBar - 1) * 4, end = start + s.lengthBars * 4
          const tracks = arrangement.tracks.filter((t) => !t.muted && t.notes.some((n) => n.startBeat >= start && n.startBeat < end))
          const notes = tracks.filter((t) => t.family !== "drums").flatMap((t) => t.notes.filter((n) => n.startBeat >= start && n.startBeat < end))
          const finalTracks = tracks.filter((t) => t.notes.some((n) => n.startBeat < end && n.startBeat + n.durationBeats > end - 4))
          const lastChord = project.chords.filter((c) => c.sectionId === s.id).sort((a, b) => a.startBeat - b.startBeat).at(-1)
          const bassPc = lastChord ? parseChordSymbol(lastChord.symbol, lastChord.bass ?? undefined)?.bassPc : undefined
          return { name: s.name, role: s.role, layers: tracks.length, velocity: notes.reduce((a, n) => a + n.velocity, 0) / Math.max(1, notes.length),
            crash: arrangement.tracks.some((t) => t.id === "dr-crash" && t.notes.some((n) => Math.abs(n.startBeat - start) < 0.1)),
            fill: arrangement.tracks.some((t) => ["dr-low-tom", "dr-high-tom"].includes(t.id) && t.notes.some((n) => n.startBeat >= start - 4 && n.startBeat < start))
              || arrangement.tracks.some((t) => t.id === "dr-snare" && t.notes.filter((n) => n.startBeat >= start - 4 && n.startBeat < start).length >= 3),
            rise: arrangement.tracks.some((t) => ["dr-cymbal-swell", "dr-impact"].includes(t.id) && t.notes.some((n) => n.startBeat >= start - 8 && n.startBeat < start)),
            finalLayers: finalTracks.length, finalHeld: finalTracks.filter((t) => t.notes.some((n) => Math.abs(n.startBeat + n.durationBeats - end) <= 0.25)).length,
            finalBass: finalTracks.some((t) => t.family !== "drums" && t.notes.some((n) => n.pitch < 52 && n.pitch % 12 === bassPc && n.startBeat < end && n.startBeat + n.durationBeats > end - 4)),
            ending: s.role === "outro" ? finalTracks.map((t) => ({ id: t.id, notes: t.notes.filter((n) => n.sectionId === s.id && n.startBeat + n.durationBeats > end - 4) })) : undefined,
          }
        }) : null, quality: arrangement?.quality, audition: arrangement?.audition, selection: arrangement?.selection,
        diagnostics: arrangement ? arrangementQualityDiagnostics(project, arrangement) : null,
        legacyQuality: legacy ? reviewGeneratedArrangement(legacy, project) : null,
      })
      vi.restoreAllMocks()
    }
    const path = process.env.ARRANGEMENT_REVIEW_RESULT_PATH
    if (path) writeFileSync(path, JSON.stringify(results, null, 2))
    expect(results).toHaveLength(12)
    const breathingSections = results.flatMap((r) => r.breathing)
    expect(breathingSections.filter((s) => s.bars >= 8 && !s.hasBreath).length).toBeLessThanOrEqual(5)
    const breathingBlocks = breathingSections.flatMap((s) => s.blocks)
    expect(breathingBlocks.filter((b) => b.hasBreath).length / breathingBlocks.length).toBeGreaterThanOrEqual(0.9)
    expect(breathingSections.reduce((sum, s) => sum + s.noteCount, 0)).toBeGreaterThanOrEqual(2499 * 0.9)
    expect(results.filter((r) => r.means[2] > Math.max(...r.means.slice(0, 2))).length).toBeGreaterThanOrEqual(10)
    expect(results.filter((r) => r.peaks[2] >= Math.max(...r.peaks.slice(0, 2))).length).toBe(12)
    expect(results.filter((r) => r.peaks[2] >= Math.max(...r.peaks.slice(0, 2)) + 2).length).toBeGreaterThanOrEqual(8)
    const pairs = results.flatMap((r) => r.pairs)
    const arrangements = results.filter((r) => r.quality)
    expect(arrangements.every((r) => r.lowEnd!.ratio <= 0.01)).toBe(true)
    const motions = arrangements.map((r) => r.padMotion!)
    const motionSum = (key: "transitions" | "leaps" | "avoidable" | "octaves" | "notes") => motions.reduce((sum, m) => sum + m[key], 0)
    expect(motionSum("leaps") / motionSum("transitions")).toBeLessThanOrEqual(.05)
    expect(motionSum("avoidable"), "主旋律と声部の制約を守った場合も、単純な置き直し可能な跳躍を5件以下にする").toBeLessThanOrEqual(5)
    expect(motionSum("octaves")).toBeLessThanOrEqual(10)
    expect(motions.reduce((sum, m) => sum + m.mean * m.transitions, 0) / motionSum("transitions")).toBeLessThanOrEqual(2.5368589743589745 * .7)
    expect(motionSum("notes")).toBeGreaterThanOrEqual(756 * .95)
    expect(arrangements.reduce((sum, r) => sum + r.lowEnd!.padNotes, 0)).toBeGreaterThanOrEqual(744 * 0.9)
    for (const role of ["verse", "pre-chorus", "chorus", "grand-chorus", "intro", "bridge", "outro"]) {
      const sections = arrangements.flatMap((r) => r.bass!).filter((s) => s.role === role)
      const sum = (key: "approaches" | "changes" | "matchedKicks" | "kicks") => sections.reduce((n, s) => n + s[key], 0)
      const approachRatio = sum("approaches") / Math.max(1, sum("changes"))
      if (role === "verse") expect(approachRatio).toBeGreaterThanOrEqual(.12)
      else if (["pre-chorus", "chorus", "grand-chorus"].includes(role)) expect(approachRatio).toBeGreaterThanOrEqual(.25)
      else expect(approachRatio).toBeLessThanOrEqual(.05)
      if (role === "chorus") {
        expect(sum("matchedKicks") / sum("kicks")).toBeGreaterThanOrEqual(.6)
        expect(sections.every((s) => s.rhythmTypes >= 3)).toBe(true)
      }
      if (role === "verse") expect(sections.every((s) => s.rhythmTypes >= 2)).toBe(true)
      if (role === "grand-chorus") expect(sections.every((s) => s.rhythmTypes >= 4)).toBe(true)
    }
    for (const result of arrangements) {
      for (const section of result.bass!.filter((s) => ["chorus", "grand-chorus"].includes(s.role))) {
        const calm = result.which === "A"
        expect(section.approaches / section.changes).toBeGreaterThanOrEqual(calm ? .25 : .6)
        expect(section.approaches / section.changes).toBeLessThanOrEqual(calm ? .4 : .9)
        expect(section.layers[0].notesPerBar).toBeLessThanOrEqual(calm ? 3.5 : 6)
        expect(section.layers[1].notesPerBar).toBeLessThanOrEqual(2.5)
        expect(section.layers[2].notesPerBar).toBeLessThanOrEqual(2)
        expect(section.layers[2].approaches).toBe(0)
        expect(section.layers.reduce((sum, l) => sum + l.notesPerBar, 0)).toBeLessThanOrEqual(calm ? 7 : 10)
        if (section.role === "chorus") expect(section.matchedKicks / section.kicks).toBeGreaterThanOrEqual(.7)
      }
      const bass = result.bass!
      const total = (key: "matchedRoots" | "roots" | "matchedSlashes" | "slashes") => bass.reduce((sum, s) => sum + s[key], 0)
      expect(total("matchedRoots") / total("roots")).toBeGreaterThanOrEqual(.95)
      expect(total("matchedSlashes")).toBe(total("slashes"))
    }
    expect(arrangements.filter((r) => (r.selection?.eligibleCount ?? 0) >= 1).length).toBe(6)
    expect(arrangements.every((r) => r.quality!.metrics.harmonicViolationCount === 0 && r.quality!.metrics.melodyCollisionCount === 0)).toBe(true)
    expect(arrangements.reduce((sum, r) => sum + r.quality!.score, 0) / arrangements.length).toBeGreaterThanOrEqual(80)
    expect(arrangements.reduce((sum, r) => sum + r.audition!.score, 0) / arrangements.length).toBeGreaterThanOrEqual(95)
    for (const result of arrangements) {
      const sum = Object.values(result.diagnostics!.contributions).reduce((sum, n) => sum + n, 0)
      expect(Math.max(0, Math.min(100, sum))).toBeCloseTo(result.quality!.score)
      expect(result.diagnostics!.harmonic).toHaveLength(result.quality!.metrics.harmonicViolationCount)
      expect(result.diagnostics!.leaps).toHaveLength(result.quality!.metrics.largeSupportLeapCount)
    }
    const mean = (key: keyof ReturnType<typeof similarity>) => pairs.reduce((sum, pair) => sum + pair[key], 0) / pairs.length
    expect(mean("rhythm")).toBeGreaterThanOrEqual(0.6)
    expect(mean("rhythm")).toBeLessThan(0.95)
    expect(mean("contour")).toBeGreaterThanOrEqual(0.8)
    expect(mean("exact")).toBeLessThan(0.9)
    const repeated = results.flatMap((r) => r.repeated)
    const rate = (values: typeof repeated[number]["candidates"], key: "scaleOutside" | "chordOutside" | "strongChord", denominator: "count" | "strongCount") =>
      values.reduce((sum, v) => sum + v[key], 0) / Math.max(1, values.reduce((sum, v) => sum + v[denominator], 0))
    const sources = repeated.map((r) => ({ ...r.source, rhythm: 1, contour: 1, exact: 1, hook: r.sourceHook }))
    const candidates = repeated.flatMap((r) => r.candidates)
    expect(rate(candidates, "scaleOutside", "count")).toBeLessThanOrEqual(rate(sources, "scaleOutside", "count") + 0.03)
    expect(rate(candidates, "chordOutside", "count")).toBeLessThanOrEqual(rate(sources, "chordOutside", "count") + 0.03)
    expect(rate(candidates, "strongChord", "strongCount")).toBeGreaterThanOrEqual(rate(sources, "strongChord", "strongCount") - 0.05)
    expect(candidates.every((c) => c.cadence)).toBe(true)
    const candidatePairs = repeated.flatMap((r) => r.candidatePairs)
    expect(candidatePairs.reduce((sum, n) => sum + n, 0) / candidatePairs.length).toBeLessThanOrEqual(0.7)
    for (const repeat of repeated) for (const candidate of repeat.candidates) expect(candidate.hook).toEqual(repeat.sourceHook)
    for (let pattern = 0; pattern < 3; pattern++) {
      const values = repeated.map((r) => r.candidates[pattern])
      expect(values.reduce((sum, v) => sum + v.rhythm, 0) / values.length).toBeGreaterThanOrEqual(0.6)
      expect(values.reduce((sum, v) => sum + v.rhythm, 0) / values.length).toBeLessThan(0.95)
      expect(values.reduce((sum, v) => sum + v.contour, 0) / values.length).toBeGreaterThanOrEqual(0.8)
    }
    for (const result of results.filter((r) => r.sections)) {
      const choruses = result.sections!.filter((s) => s.role === "chorus" || s.role === "grand-chorus")
      for (const section of choruses) {
        expect(section.crash).toBe(true)
        expect(section.fill).toBe(true)
        expect(section.rise).toBe(true)
      }
      expect(choruses[1].layers - choruses[0].layers).toBeGreaterThanOrEqual(2)
      expect(choruses[2].layers - choruses[1].layers).toBeLessThanOrEqual(10)
      expect(choruses[2].velocity - choruses[1].velocity).toBeGreaterThanOrEqual(4)
      expect(choruses[2].velocity - choruses[1].velocity).toBeLessThanOrEqual(10)
      expect(choruses[0].velocity - result.sections!.find((s) => s.role === "verse")!.velocity).toBeGreaterThanOrEqual(6)
      const outro = result.sections!.at(-1)!
      expect(outro.finalLayers).toBeGreaterThanOrEqual(3)
      expect(outro.finalBass).toBe(true)
      expect(outro.finalHeld / outro.finalLayers).toBeGreaterThanOrEqual(0.8)
    }
    const otherBoundaries = results.flatMap((r) => r.sections?.slice(1).filter((s) => !["chorus", "grand-chorus", "outro"].includes(s.role)) ?? [])
    const otherFillRatio = otherBoundaries.filter((s) => s.fill).length / otherBoundaries.length
    expect(otherFillRatio).toBeGreaterThanOrEqual(0.4)
    expect(otherFillRatio).toBeLessThanOrEqual(0.8)
  }, 240000)
})
