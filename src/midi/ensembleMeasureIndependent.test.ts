import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { afterEach, it, vi } from "vitest"
import type { ComposerProject } from "@/core/project"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"

// Issue #200 の「実音の違い」を、変更前(main)と最新ヘッドで同じ物差しにかけるための測定(独立レビュー)。
// 環境変数 ENSEMBLE_MEASURE_PATH があるときだけ書き出す。通常のCIでは何もしない。

afterEach(() => vi.restoreAllMocks())

function addLead(project: ComposerProject) {
  for (const section of project.sections) {
    const id = `lead:${section.id}`
    project.melodyVariants.push({
      id, name: "Lead", sectionId: section.id, sourceMode: "generate",
      notes: Array.from({ length: section.lengthBars }, (_, bar) => [0, .5, 1].map((beat, index) => ({
        id: `${id}:${bar}:${index}`, pitch: [72, 74, 76][index], startBeat: bar * 4 + beat,
        durationBeats: .4, velocity: 80, locks: [],
      }))).flat(),
      phrasePlans: [], lockedBars: [], motifLocked: false, features: null, generatorVersion: "fixture",
      seed: 1, songProfile: "original-custom", parentMelodyId: null, batchId: "fixture", createdAt: "2026-10-21T00:00:00Z",
    } as ComposerProject["melodyVariants"][number])
    project.sectionMelodyAssignments[section.id] = id
  }
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12)

it("measure", () => {
  const path = process.env.ENSEMBLE_MEASURE_PATH
  if (!path) return
  let n = 0
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`)
  const rows = []
  for (const which of ["A", "B"] as const) for (const withLead of [false, true]) for (const seed of [19, 41, 73]) {
    n = 0
    const project = arrangementReviewSong(which)
    project.song.genreBlend = [{ id: which === "A" ? "neoclassical" : "electronica", weight: 1 }]
    project.song.tempo = which === "A" ? 84 : 132
    if (withLead) addLead(project)
    const lead = withLead ? project.melodyVariants.flatMap((v) => v.notes.map((x) => ({ s: x.startBeat + (project.sections.find((sec) => sec.id === v.sectionId)!.startBar - 1) * 4, e: x.startBeat + x.durationBeats + (project.sections.find((sec) => sec.id === v.sectionId)!.startBar - 1) * 4 }))) : []
    const arrangement = generateFullSongArrangement(project, { seed })
    const tracks = arrangement.tracks.filter((t) => !t.muted && t.notes.length > 0)
    const perTrack = tracks.map((t) => ({
      id: t.id, family: t.family, notes: t.notes.length,
      hash: hash(t.notes.map((x) => [x.pitch, x.startBeat, x.durationBeats, x.velocity])),
      program: (t as { instrument?: { program: number } }).instrument?.program ?? null,
      noteList: t.family === "drums" ? undefined : t.notes.map((x) => [x.pitch, x.startBeat, x.durationBeats, x.velocity]),
      overlapLead: lead.length ? t.notes.filter((x) => lead.some((l) => x.startBeat < l.e && x.startBeat + x.durationBeats > l.s)).length : 0,
    }))
    const nonDrum = perTrack.filter((t) => t.family !== "drums")
    const bars = Math.max(...project.sections.map((s) => s.startBar + s.lengthBars - 1))
    let peak = 0
    for (let bar = 0; bar < bars; bar++) {
      peak = Math.max(peak, tracks.filter((t) => t.family !== "drums" && t.notes.some((x) => x.startBeat < (bar + 1) * 4 && x.startBeat + x.durationBeats > bar * 4 + .01)).length)
    }
    const m = arrangement.quality!.metrics as Record<string, unknown>
    rows.push({
      which, withLead, seed,
      trackCount: tracks.length, nonDrumTracks: nonDrum.length, drumTracks: perTrack.length - nonDrum.length,
      drumEvents: perTrack.filter((t) => t.family === "drums").reduce((s, t) => s + t.notes, 0),
      nonDrumEvents: nonDrum.reduce((s, t) => s + t.notes, 0),
      peakNonDrumLayersInOneBar: peak,
      overlapLeadNonDrum: nonDrum.reduce((s, t) => s + t.overlapLead, 0),
      overlapLeadDrum: perTrack.filter((t) => t.family === "drums").reduce((s, t) => s + t.overlapLead, 0),
      distinctProgramsSaved: new Set(nonDrum.map((t) => t.program).filter((p) => p !== null)).size,
      melodyCollisionCount: m.melodyCollisionCount, harmonicViolationCount: m.harmonicViolationCount,
      distinctSectionTextures: m.distinctSectionTextures,
      qualityScore: arrangement.quality!.score, auditionScore: (arrangement as { audition?: { score?: number } }).audition?.score ?? null,
      qualityPassed: arrangement.quality!.passed, auditionPassed: (arrangement as { audition?: { passed?: boolean } }).audition?.passed ?? null,
      perTrack,
    })
  }
  writeFileSync(path, JSON.stringify(rows, null, 2))
}, 300_000)
