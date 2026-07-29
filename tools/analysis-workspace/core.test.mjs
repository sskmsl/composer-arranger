import { describe, expect, it } from "vitest"
import {
  addObservation,
  addSection,
  addSong,
  createProject,
  createTechnique,
  dashboard,
  draftTechniques,
  emptyWorkspace,
  exportProjectMarkdown,
  importProjectMarkdown,
  linkEvidence,
  searchTechniques,
  setGenrePrinciple,
  setObservationValidation,
  transitionTechniqueStatus,
  validateStatusTransition,
  validateWorkspace,
} from "./core.mjs"

const clock = () => new Date("2026-07-30T00:00:00.000Z")

function projectWithSong(workspace = emptyWorkspace(), genre = "Test Genre") {
  const projectResult = createProject(
    workspace,
    { name: `${genre} Analysis`, genre },
    clock,
  )
  const songResult = addSong(
    projectResult.workspace,
    {
      projectId: projectResult.project.id,
      title: "Reference Song",
      artist: "Reference Artist",
      album: "Reference Album",
      year: 2026,
      bpm: 90,
      key: "Am",
    },
    clock,
  )
  return {
    workspace: songResult.workspace,
    project: projectResult.project,
    song: songResult.song,
  }
}

function fullDraft() {
  let { workspace, project, song } = projectWithSong()
  const techniqueResult = createTechnique(
    workspace,
    {
      name: "Reverse Atmosphere",
      category: "transition",
      observation: "A reversed texture precedes a section boundary.",
      intent: "Create expectation without a hard cut.",
      genre: project.genre,
      genreSourceId: "genre-source-test",
      confidence: 0.9,
    },
    clock,
  )
  workspace = techniqueResult.workspace
  const sectionResult = addSection(
    workspace,
    {
      songId: song.id,
      type: "intro",
      startSeconds: 0,
      endSeconds: 12.5,
    },
    clock,
  )
  workspace = sectionResult.workspace
  const observationResult = addObservation(
    workspace,
    {
      sectionId: sectionResult.section.id,
      observation: "The transition begins before the next section.",
      intent: "Pull the listener into the next scene.",
      techniqueCandidateIds: [techniqueResult.technique.id],
      confidence: 0.94,
      validation: "validated",
    },
    clock,
  )
  return {
    workspace: observationResult.workspace,
    project,
    song,
    section: sectionResult.section,
    observation: observationResult.observation,
    technique: techniqueResult.technique,
  }
}

describe("Analysis Workspace data model", () => {
  it("creates a normalized project, song, section and observation", () => {
    const context = fullDraft()
    expect(validateWorkspace(context.workspace)).toEqual({
      valid: true,
      errors: [],
    })
    expect(context.observation.techniqueCandidateIds).toEqual([
      context.technique.id,
    ])
  })

  it("rejects overlapping sections in the same song", () => {
    const context = fullDraft()
    expect(() =>
      addSection(
        context.workspace,
        {
          songId: context.song.id,
          type: "verse",
          startSeconds: 10,
          endSeconds: 20,
        },
        clock,
      ),
    ).toThrow("overlaps")
  })

  it("changes Observation validation without mutating the original", () => {
    const context = fullDraft()
    const draft = setObservationValidation(
      context.workspace,
      {
        observationId: context.observation.id,
        validation: "draft",
      },
      clock,
    )
    expect(draft.observation.validation).toBe("draft")
    expect(
      context.workspace.observations.find(
        (item) => item.id === context.observation.id,
      ).validation,
    ).toBe("validated")
  })

  it("keeps linked Evidence validation synchronized with its Observation", () => {
    const context = fullDraft()
    const linked = linkEvidence(
      context.workspace,
      {
        observationId: context.observation.id,
        techniqueId: context.technique.id,
      },
      clock,
    )
    const downgraded = setObservationValidation(
      linked.workspace,
      {
        observationId: context.observation.id,
        validation: "draft",
      },
      clock,
    )
    const evidence = downgraded.workspace.techniques[0].evidence[0]
    expect(evidence.observationConfirmed).toBe(false)
    expect(evidence.verifiedAt).toBeNull()
  })
})

describe("Technique discovery and lifecycle", () => {
  it("finds similar names but never automatically merges techniques", () => {
    let context = fullDraft()
    const second = createTechnique(
      context.workspace,
      {
        name: "Reverse Atmospheric Transition",
        category: "transition",
        observation: "A reverse sound leads into a boundary.",
        intent: "Connect scenes.",
        genre: "Test Genre",
        genreSourceId: "genre-source-test",
        confidence: 0.7,
      },
      clock,
    )
    expect(second.duplicateCandidates[0].technique.id).toBe(
      context.technique.id,
    )
    expect(second.technique.id).not.toBe(context.technique.id)
    expect(searchTechniques(second.workspace, "Reverse")).toHaveLength(2)
  })

  it("links verified Evidence with Section timing", () => {
    const context = fullDraft()
    const linked = linkEvidence(
      context.workspace,
      {
        observationId: context.observation.id,
        techniqueId: context.technique.id,
        comment: "Audition confirmed.",
      },
      clock,
    )
    expect(linked.evidence).toMatchObject({
      section: "intro",
      startSeconds: 0,
      endSeconds: 12.5,
      sectionConfirmed: true,
      intentConfirmed: true,
      observationConfirmed: true,
    })
  })

  it("blocks validation until Evidence and Genre Principle are confirmed", () => {
    const context = fullDraft()
    expect(
      validateStatusTransition(context.technique, "validated").eligible,
    ).toBe(false)
    let linked = linkEvidence(
      context.workspace,
      {
        observationId: context.observation.id,
        techniqueId: context.technique.id,
      },
      clock,
    )
    const withPrinciple = setGenrePrinciple(
      linked.workspace,
      {
        techniqueId: context.technique.id,
        statement: "Transitions can behave as musical time.",
        confirmed: true,
      },
      clock,
    )
    const promoted = transitionTechniqueStatus(
      withPrinciple.workspace,
      {
        techniqueId: context.technique.id,
        targetStatus: "validated",
        reason: "Section, intent and observation confirmed.",
        reviewer: "Internal reviewer",
      },
      clock,
    )
    expect(promoted.validation.eligible).toBe(true)
    expect(promoted.technique.status).toBe("validated")
    expect(promoted.technique.reviewHistory).toHaveLength(1)
  })

  it("requires reproducibility plus multiple genres or enough Evidence for Canonical", () => {
    const context = fullDraft()
    let linked = linkEvidence(
      context.workspace,
      {
        observationId: context.observation.id,
        techniqueId: context.technique.id,
      },
      clock,
    )
    let changed = setGenrePrinciple(
      linked.workspace,
      {
        techniqueId: context.technique.id,
        statement: "A reusable transition principle.",
        confirmed: true,
      },
      clock,
    )
    let promoted = transitionTechniqueStatus(
      changed.workspace,
      {
        techniqueId: context.technique.id,
        targetStatus: "validated",
        reason: "Validated once.",
        reviewer: "Internal reviewer",
      },
      clock,
    )
    const canonical = transitionTechniqueStatus(
      promoted.workspace,
      {
        techniqueId: context.technique.id,
        targetStatus: "canonical",
        reason: "Reproducible.",
        reviewer: "Internal reviewer",
        reproducibilityConfirmed: true,
      },
      clock,
    )
    expect(canonical.validation.eligible).toBe(false)
    expect(canonical.validation.reasons.join(" ")).toContain("two Genres")
  })
})

describe("Reporting and Markdown", () => {
  it("summarizes a genre and sorts Draft techniques", () => {
    const context = fullDraft()
    expect(dashboard(context.workspace, "Test Genre")).toMatchObject({
      projectCount: 1,
      songCount: 1,
      techniqueCount: 1,
      draftCount: 1,
      evidenceCount: 0,
    })
    expect(draftTechniques(context.workspace)[0].id).toBe(
      context.technique.id,
    )
  })

  it("round-trips a project through Markdown without losing IDs", () => {
    const context = fullDraft()
    const markdown = exportProjectMarkdown(
      context.workspace,
      context.project.id,
    )
    const imported = importProjectMarkdown(emptyWorkspace(), markdown)
    expect(imported.projects[0].id).toBe(context.project.id)
    expect(imported.observations[0].id).toBe(context.observation.id)
    expect(imported.techniques[0].id).toBe(context.technique.id)
  })

  it("reports malformed collections instead of throwing", () => {
    expect(() =>
      validateWorkspace({ schemaVersion: 1, projects: null }),
    ).not.toThrow()
    expect(
      validateWorkspace({ schemaVersion: 1, projects: null }).valid,
    ).toBe(false)
  })
})
