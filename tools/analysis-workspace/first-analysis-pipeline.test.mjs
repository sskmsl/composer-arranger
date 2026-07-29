import { describe, expect, it } from "vitest"
import { emptyWorkspace } from "./core.mjs"
import {
  exportValidationQueueMarkdown,
  generateAnonymousRuleCandidates,
  importFirstAnalysis,
  importValidationQueueMarkdown,
  parseGenreAnalysisMarkdown,
  reviewEvidenceCandidate,
  techniquePromotionCandidates,
  validateFirstAnalysisPipeline,
} from "./first-analysis-pipeline.mjs"

const clock = () => new Date("2026-07-30T00:00:00.000Z")

const ANALYSIS = `# Genre Intelligence

Genre: Example Genre

Version: 1.0

Status: Draft

## Technique 01: Sparse Arrangement

Category: Arrangement

### Observation

- Sparse Arrangement
- Minimal Layering
- Principal parts remain audibly separated

### Intent

Preserve focus around the principal element.

### Evidence

- Reference Artist A – Reference Song A

Representative Sections:

- Intro
- Verse

Common Characteristics:

- Few principal layers
- Sustained background

Confidence: 0.95

### Genre Principle

Silence and reduced density can remain structurally meaningful.

## Technique 02: Reverse Atmosphere

Category: Transition

### Observation

- Reverse Entry

### Intent

Connect adjacent sections without a hard cut.

### Evidence

- Reference Artist B – Reference Song B

Representative Sections:

- Chorus

Common Characteristics:

- Subtle transition material

Confidence: 0.9

### Genre Principle

A transition sound can behave as musical time.

## Technique 03: Wide Atmospheric Pad

Category: Texture

### Observation

- Wide Atmospheric Pad

### Intent

Treat space as an active musical layer.

### Evidence

- Reference Artist C – Reference Song C

Representative Sections:

- Outro

Common Characteristics:

- Sustained spatial layer

Confidence: 0.85

### Genre Principle

A sustained layer can articulate depth rather than chord identity.
`

const KNOWLEDGE_BASE = {
  schemaVersion: 1,
  techniques: [
    {
      id: "TECH-0001",
      name: "Sparse Arrangement",
      observation: "A small number of principal parts sound.",
      intent: "Preserve focus.",
      category: "arrangement",
    },
    {
      id: "TECH-0002",
      name: "Reverse Atmosphere",
      observation: "Reverse material precedes a boundary.",
      intent: "Connect sections.",
      category: "transition",
    },
    {
      id: "TECH-0003",
      name: "Wide Atmospheric Pad",
      observation: "A wide sustained Pad forms a spatial layer.",
      intent: "Create depth.",
      category: "texture",
    },
  ],
}

const SOURCES = {
  schemaVersion: 1,
  privacy: "internal-only",
  genreSourceId: "genre-source-example",
  genre: "Example Genre",
  references: [
    {
      referenceId: "reference-a",
      artist: "Reference Artist A",
      song: "Reference Song A",
    },
    {
      referenceId: "reference-b",
      artist: "Reference Artist B",
      song: "Reference Song B",
    },
    {
      referenceId: "reference-c",
      artist: "Reference Artist C",
      song: "Reference Song C",
    },
  ],
}

function importedPipeline() {
  return importFirstAnalysis(
    {
      workspace: emptyWorkspace(),
      analysisMarkdown: ANALYSIS,
      knowledgeBase: KNOWLEDGE_BASE,
      sourceRegistry: SOURCES,
    },
    clock,
  ).pipeline
}

describe("First Analysis import", () => {
  it("parses the Genre Analysis Markdown without inventing times", () => {
    const parsed = parseGenreAnalysisMarkdown(ANALYSIS)
    expect(parsed.genre).toBe("Example Genre")
    expect(parsed.techniques).toHaveLength(3)
    expect(parsed.techniques[0]).toMatchObject({
      name: "Sparse Arrangement",
      category: "arrangement",
      observations: [
        "Sparse Arrangement",
        "Minimal Layering",
        "Principal parts remain audibly separated",
      ],
      sectionCandidates: ["Intro", "Verse"],
      analysisConfidence: 0.95,
    })
  })

  it("connects existing Techniques, Dictionary matches and Evidence candidates", () => {
    const pipeline = importedPipeline()
    expect(
      pipeline.techniqueCandidates.map((candidate) => ({
        id: candidate.techniqueId,
        registration: candidate.registrationStatus,
      })),
    ).toEqual([
      { id: "TECH-0001", registration: "matched-existing" },
      { id: "TECH-0002", registration: "matched-existing" },
      { id: "TECH-0003", registration: "matched-existing" },
    ])
    expect(pipeline.evidenceCandidates).toHaveLength(3)
    expect(pipeline.observationInstances).toHaveLength(5)
    expect(pipeline.techniqueCandidates[0].observationMatches).toMatchObject([
      { matchType: "exact-match", observationId: "OBS-0001" },
      { matchType: "alias-match", observationId: "OBS-0001" },
      {
        matchType: "related-match",
        observationId: "OBS-0001",
        requiresHumanConfirmation: true,
      },
    ])
    expect(pipeline.evidenceCandidates[0]).toMatchObject({
      validationStatus: "needs-listening",
      sectionName: "unresolved",
      startTime: null,
      endTime: null,
      timeStatus: "unknown",
      confidence: { analysisConfidence: 0.95 },
    })
    expect(validateFirstAnalysisPipeline(pipeline).valid).toBe(true)
  })

  it("issues unique persistent IDs for genuinely new Draft Techniques", () => {
    const withoutTechniques = { ...KNOWLEDGE_BASE, techniques: [] }
    const pipeline = importFirstAnalysis(
      {
        workspace: emptyWorkspace(),
        analysisMarkdown: ANALYSIS,
        knowledgeBase: withoutTechniques,
        sourceRegistry: SOURCES,
      },
      clock,
    ).pipeline
    expect(
      pipeline.techniqueCandidates.map((candidate) => candidate.techniqueId),
    ).toEqual(["TECH-0001", "TECH-0002", "TECH-0003"])
    expect(
      pipeline.techniqueCandidates.every(
        (candidate) => candidate.registrationStatus === "new-draft",
      ),
    ).toBe(true)
  })
})

describe("Evidence review workflow", () => {
  it("blocks validation when listening confirmations are missing", () => {
    expect(() =>
      reviewEvidenceCandidate(
        importedPipeline(),
        {
          evidenceId: "EVD-0001",
          action: "validate",
          reviewer: "Reviewer",
          reason: "Auditioned.",
        },
        clock,
      ),
    ).toThrow("Observation confirmation")
  })

  it("validates one Evidence only after Section, time and relationships are confirmed", () => {
    const reviewed = reviewEvidenceCandidate(
      importedPipeline(),
      {
        evidenceId: "EVD-0001",
        action: "validate",
        reviewer: "Reviewer",
        reason: "All listed facts confirmed by listening.",
        sectionName: "intro",
        startTime: "00:00",
        endTime: "00:18",
        timeStatus: "confirmed",
        observationConfirmed: true,
        techniqueRelationConfirmed: true,
        sectionConfirmed: true,
        validationConfidence: 0.92,
      },
      clock,
    )
    expect(reviewed.evidence).toMatchObject({
      validationStatus: "validated",
      sectionName: "intro",
      timeStatus: "confirmed",
      confidence: {
        analysisConfidence: 0.95,
        validationConfidence: 0.92,
      },
    })
    expect(reviewed.pipeline.reviewHistory[0]).toMatchObject({
      action: "validate",
      confirmation: {
        observationConfirmed: true,
        techniqueRelationConfirmed: true,
        sectionConfirmed: true,
        timeConfirmed: true,
      },
    })
    expect(validateFirstAnalysisPipeline(reviewed.pipeline).valid).toBe(true)
    expect(
      techniquePromotionCandidates(reviewed.pipeline)[0],
    ).toMatchObject({
      validatedEligible: true,
      canonicalCandidate: false,
      automaticPromotion: false,
    })
  })

  it("retains Reject and Revise history without deleting Evidence", () => {
    const rejected = reviewEvidenceCandidate(
      importedPipeline(),
      {
        evidenceId: "EVD-0001",
        action: "reject",
        reviewer: "Reviewer",
        reason: "The proposed Observation was not audible.",
      },
      clock,
    )
    expect(rejected.evidence.validationStatus).toBe("rejected")
    expect(rejected.pipeline.evidenceCandidates).toHaveLength(3)
    const revised = reviewEvidenceCandidate(
      importedPipeline(),
      {
        evidenceId: "EVD-0001",
        action: "revise",
        reviewer: "Reviewer",
        reason: "Section candidate needs correction.",
        sectionName: "verse",
        timeStatus: "approximate",
        startTime: "00:12",
        endTime: "00:28",
      },
      clock,
    )
    expect(revised.evidence.validationStatus).toBe("needs-listening")
    expect(revised.pipeline.reviewHistory[0].before.sectionName).toBe(
      "unresolved",
    )
    expect(revised.pipeline.reviewHistory[0].after.sectionName).toBe("verse")
  })
})

describe("Validation Queue and anonymous Rule candidates", () => {
  it("exports a listening Queue and imports an edited Review block", () => {
    const pipeline = importedPipeline()
    let markdown = exportValidationQueueMarkdown(pipeline)
    expect(markdown).toContain("### Evidence EVD-0001")
    expect(markdown).toContain("- Start: Unknown")
    markdown = markdown
      .replace("- Result:", "- Result: Reject")
      .replace("- Reviewer:", "- Reviewer: Reviewer")
      .replace(
        "- Reason:",
        "- Reason: Observation was not present at the proposed location.",
      )
    const imported = importValidationQueueMarkdown(
      pipeline,
      markdown,
      clock,
    )
    expect(imported.reviewedEvidenceIds).toEqual(["EVD-0001"])
    expect(
      imported.pipeline.evidenceCandidates.find(
        (candidate) => candidate.id === "EVD-0001",
      ).validationStatus,
    ).toBe("rejected")
  })

  it("does not generate Rules before validation", () => {
    const result = generateAnonymousRuleCandidates(
      importedPipeline(),
      clock,
    )
    expect(result.ruleCandidates).toHaveLength(0)
    expect(result.blockedCandidates).toHaveLength(3)
  })

  it("generates an anonymous Draft Rule skeleton after validation", () => {
    const reviewed = reviewEvidenceCandidate(
      importedPipeline(),
      {
        evidenceId: "EVD-0001",
        action: "validate",
        reviewer: "Reviewer",
        reason: "Audition confirmed.",
        sectionName: "intro",
        timeNotRequired: true,
        observationConfirmed: true,
        techniqueRelationConfirmed: true,
        sectionConfirmed: true,
        validationConfidence: 0.9,
      },
      clock,
    )
    const result = generateAnonymousRuleCandidates(
      reviewed.pipeline,
      clock,
    )
    expect(result.ruleCandidates[0]).toMatchObject({
      techniqueId: "TECH-0001",
      category: "arrangement",
      applicableSections: ["intro"],
      action: { type: "manual-authoring-required" },
      sourceEvidenceIds: ["EVD-0001"],
      status: "draft-rule-candidate",
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("Reference Artist A")
    expect(serialized).not.toContain("Reference Song A")
  })
})
