import { describe, expect, it } from "vitest"
import {
  addSection,
  addSong,
  createProject,
  createTechnique,
  emptyWorkspace,
  exportProjectMarkdown,
  importProjectMarkdown,
  linkEvidence,
} from "./core.mjs"
import {
  OBSERVATION_SEED_COUNT,
  createObservationDefinition,
  createObservationInstance,
  ensureObservationWorkspace,
  exportObservationDefinitionMarkdown,
  importObservationDefinitionMarkdown,
  resolveObservationDefinition,
  searchObservationDefinitions,
  setObservationDefinitionStatus,
  validateObservationDictionary,
} from "./observation-dictionary.mjs"

const clock = () => new Date("2026-07-30T00:00:00.000Z")

function sectionWorkspace() {
  let workspace = emptyWorkspace()
  const project = createProject(
    workspace,
    { name: "Example Analysis", genre: "Example Genre" },
    clock,
  )
  workspace = project.workspace
  const song = addSong(
    workspace,
    {
      projectId: project.project.id,
      title: "Reference Song",
      artist: "Reference Artist",
      album: "Reference Album",
      year: 2026,
    },
    clock,
  )
  workspace = song.workspace
  const section = addSection(
    workspace,
    {
      songId: song.song.id,
      type: "intro",
      startSeconds: 0,
      endSeconds: 16,
    },
    clock,
  )
  return {
    workspace: section.workspace,
    project: project.project,
    song: song.song,
    section: section.section,
  }
}

function numberDefinition(workspace) {
  return createObservationDefinition(
    workspace,
    {
      canonicalName: "Simultaneous Major Part Count",
      description: "Number of major parts sounding at the same time.",
      category: "density",
      aliases: ["Active Major Part Count"],
      valueType: "number",
      unit: "part_count",
      relatedObservationIds: ["OBS-0001"],
      oppositeObservationIds: [],
    },
    clock,
  )
}

describe("Observation Dictionary definitions", () => {
  it("ships the complete initial Active seed with persistent IDs", () => {
    const workspace = emptyWorkspace()
    expect(workspace.observationDefinitions).toHaveLength(
      OBSERVATION_SEED_COUNT,
    )
    expect(OBSERVATION_SEED_COUNT).toBe(60)
    expect(workspace.observationDefinitions[0]).toMatchObject({
      id: "OBS-0001",
      canonicalName: "Sparse Arrangement",
      status: "active",
      valueType: "boolean",
    })
    expect(validateObservationDictionary(workspace)).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    })
  })

  it("creates a Draft definition and finds it through an Alias", () => {
    const created = numberDefinition(emptyWorkspace())
    expect(created.definition).toMatchObject({
      id: "OBS-0061",
      status: "draft",
      valueType: "number",
      unit: "part_count",
    })
    const results = searchObservationDefinitions(
      created.workspace,
      "Active Major Part Count",
    )
    expect(results[0].definition.id).toBe(created.definition.id)
  })

  it("rejects canonical and Alias duplication", () => {
    expect(() =>
      createObservationDefinition(
        emptyWorkspace(),
        {
          canonicalName: "Minimal Layering",
          description: "Duplicate alias expressed as a canonical name.",
          category: "density",
          valueType: "boolean",
        },
        clock,
      ),
    ).toThrow("already exists")
  })

  it("detects circular parent references", () => {
    const first = createObservationDefinition(
      emptyWorkspace(),
      {
        canonicalName: "Parent Fact",
        description: "A parent fact used for validation.",
        category: "arrangement",
        valueType: "boolean",
      },
      clock,
    )
    const second = createObservationDefinition(
      first.workspace,
      {
        canonicalName: "Child Fact",
        description: "A child fact used for validation.",
        category: "arrangement",
        valueType: "boolean",
        parentObservationId: first.definition.id,
      },
      clock,
    )
    const circular = structuredClone(second.workspace)
    circular.observationDefinitions.find(
      (item) => item.id === first.definition.id,
    ).parentObservationId = second.definition.id
    expect(
      validateObservationDictionary(circular).errors.join(" "),
    ).toContain("Circular parent")
  })

  it("searches by ID, Category, Status and Description", () => {
    const workspace = emptyWorkspace()
    expect(
      searchObservationDefinitions(workspace, "OBS-0001")[0].definition.id,
    ).toBe("OBS-0001")
    expect(
      searchObservationDefinitions(workspace, "", {
        category: "transition",
        status: "active",
        limit: 20,
      }).every(
        ({ definition }) =>
          definition.category === "transition" &&
          definition.status === "active",
      ),
    ).toBe(true)
    expect(
      searchObservationDefinitions(workspace, "Observable musical fact")
        .length,
    ).toBeGreaterThan(0)
  })
})

describe("Observation Instances", () => {
  it("stores a typed Instance against its Song and Section", () => {
    const context = sectionWorkspace()
    const definition = numberDefinition(context.workspace)
    const created = createObservationInstance(
      definition.workspace,
      {
        sectionId: context.section.id,
        observationId: definition.definition.id,
        value: 4,
        unit: "part_count",
        confidence: 0.94,
        validationStatus: "validated",
        note: "Four principal layers are audible.",
      },
      clock,
    )
    expect(created.instance).toMatchObject({
      kind: "dictionary-instance",
      observationId: definition.definition.id,
      songId: context.song.id,
      sectionId: context.section.id,
      value: 4,
      unit: "part_count",
      confidence: 0.94,
      validationStatus: "validated",
    })
    expect(created.warnings).toContain(
      `Draft Observation used: ${definition.definition.id}`,
    )
  })

  it("rejects values that do not match the Definition value type", () => {
    const context = sectionWorkspace()
    const definition = numberDefinition(context.workspace)
    expect(() =>
      createObservationInstance(
        definition.workspace,
        {
          sectionId: context.section.id,
          observationId: definition.definition.id,
          value: "four",
          unit: "part_count",
        },
        clock,
      ),
    ).toThrow("finite number")
  })

  it("warns when a Deprecated term is newly referenced", () => {
    const context = sectionWorkspace()
    const deprecated = setObservationDefinitionStatus(
      context.workspace,
      { observationId: "OBS-0001", status: "deprecated" },
      clock,
    )
    const instance = createObservationInstance(
      deprecated.workspace,
      {
        sectionId: context.section.id,
        observationId: "OBS-0001",
        value: true,
      },
      clock,
    )
    expect(instance.warnings).toContain(
      "Deprecated Observation used: OBS-0001",
    )
    expect(
      validateObservationDictionary(instance.workspace).warnings,
    ).toContain(
      `${instance.instance.id} references deprecated OBS-0001`,
    )
  })

  it("resolves a Merged term and stores the canonical target ID", () => {
    const context = sectionWorkspace()
    const merged = setObservationDefinitionStatus(
      context.workspace,
      {
        observationId: "OBS-0002",
        status: "merged",
        mergedIntoObservationId: "OBS-0001",
      },
      clock,
    )
    expect(
      resolveObservationDefinition(merged.workspace, "OBS-0002"),
    ).toMatchObject({
      definition: { id: "OBS-0001" },
      resolutionPath: ["OBS-0002"],
    })
    const instance = createObservationInstance(
      merged.workspace,
      {
        sectionId: context.section.id,
        observationId: "OBS-0002",
        value: true,
      },
      clock,
    )
    expect(instance.instance.observationId).toBe("OBS-0001")
    expect(instance.warnings[0]).toContain("Merged Observation resolved")
  })

  it("links Evidence while keeping Intent confirmation separate", () => {
    const context = sectionWorkspace()
    const technique = createTechnique(
      context.workspace,
      {
        name: "Example Technique",
        category: "arrangement",
        observation: "A small number of principal parts sound.",
        intent: "Preserve focus around the principal element.",
        genre: "Example Genre",
        genreSourceId: "genre-source-example",
        confidence: 0.8,
      },
      clock,
    )
    const instance = createObservationInstance(
      technique.workspace,
      {
        sectionId: context.section.id,
        observationId: "OBS-0001",
        value: true,
        confidence: 0.9,
        validationStatus: "validated",
      },
      clock,
    )
    const linked = linkEvidence(
      instance.workspace,
      {
        observationId: instance.instance.id,
        techniqueId: technique.technique.id,
      },
      clock,
    )
    expect(linked.evidence).toMatchObject({
      observationConfirmed: true,
      sectionConfirmed: true,
      intentConfirmed: false,
      verifiedAt: null,
    })
    expect(
      linked.workspace.observations.find(
        (item) => item.id === instance.instance.id,
      ).evidenceId,
    ).toBe(linked.evidence.id)
  })
})

describe("Observation Markdown and backward compatibility", () => {
  it("round-trips a Definition through YAML-front-matter Markdown", () => {
    const created = numberDefinition(emptyWorkspace())
    const markdown = exportObservationDefinitionMarkdown(
      created.workspace,
      created.definition.id,
    )
    expect(markdown).toContain("---\nid: OBS-0061")
    expect(markdown).toContain("valueType: number")
    const imported = importObservationDefinitionMarkdown(
      emptyWorkspace(),
      markdown,
    )
    expect(
      imported.observationDefinitions.find(
        (item) => item.id === created.definition.id,
      ),
    ).toEqual(created.definition)
    const frontMatterOnly = `${markdown.split("\n# ")[0]}\n`
    const importedFrontMatter = importObservationDefinitionMarkdown(
      emptyWorkspace(),
      frontMatterOnly,
    )
    expect(
      importedFrontMatter.observationDefinitions.find(
        (item) => item.id === created.definition.id,
      ),
    ).toEqual(created.definition)
  })

  it("keeps dictionary Instances in existing project Markdown", () => {
    const context = sectionWorkspace()
    const instance = createObservationInstance(
      context.workspace,
      {
        sectionId: context.section.id,
        observationId: "OBS-0001",
        value: true,
        confidence: 0.9,
      },
      clock,
    )
    const markdown = exportProjectMarkdown(
      instance.workspace,
      context.project.id,
    )
    const imported = importProjectMarkdown(emptyWorkspace(), markdown)
    expect(
      imported.observations.find(
        (item) => item.id === instance.instance.id,
      ),
    ).toMatchObject({
      observationId: "OBS-0001",
      sectionId: context.section.id,
    })
  })

  it("normalizes legacy workspaces without changing legacy Observations", () => {
    const legacy = {
      schemaVersion: 1,
      projects: [],
      songs: [],
      sections: [],
      observations: [
        {
          id: "OBSERVATION-0001",
          sectionId: "SECTION-0001",
          observation: "Legacy free-text fact",
          intent: "Legacy intent",
          techniqueCandidateIds: [],
          confidence: 0.8,
          validation: "draft",
          createdAt: "2026-07-30T00:00:00.000Z",
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      ],
      techniques: [],
    }
    const normalized = ensureObservationWorkspace(legacy)
    expect(normalized.observationDefinitions).toHaveLength(
      OBSERVATION_SEED_COUNT,
    )
    expect(normalized.observations).toEqual(legacy.observations)
  })
})
