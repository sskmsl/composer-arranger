import {
  SECTION_TYPES,
  searchTechniques,
} from "./core.mjs"
import {
  ensureObservationWorkspace,
  searchObservationDefinitions,
} from "./observation-dictionary.mjs"

export const PIPELINE_SCHEMA_VERSION = 1
export const EVIDENCE_VALIDATION_STATUSES = [
  "draft",
  "needs-listening",
  "validated",
  "rejected",
]
export const TIME_STATUSES = ["confirmed", "approximate", "unknown"]
export const OBSERVATION_MATCH_TYPES = [
  "exact-match",
  "alias-match",
  "related-match",
  "new-observation-candidate",
  "unresolved",
]

function clone(value) {
  return structuredClone(value)
}

function nowIso(clock) {
  return (clock?.() ?? new Date()).toISOString()
}

function normalize(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
    .trim()
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }
  return value.trim()
}

function confidence(value, label = "confidence") {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return parsed
}

function nextId(items, prefix) {
  const expression = new RegExp(`^${prefix}-(\\d+)$`)
  const maximum = items.reduce((max, item) => {
    const match = expression.exec(item.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}-${String(maximum + 1).padStart(4, "0")}`
}

function paragraph(lines) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
}

function categorySlug(value) {
  return normalize(value).replaceAll(" ", "-")
}

function parseEvidenceLine(line) {
  const match = /^(.+?)\s+[–—-]\s+(.+)$/.exec(line.trim())
  if (!match) {
    throw new Error(`Evidence must use Artist – Song format: ${line}`)
  }
  return { artistName: match[1].trim(), songTitle: match[2].trim() }
}

function parseTechniqueBlock(name, block) {
  const lines = block.split(/\r?\n/)
  const technique = {
    name: name.trim(),
    category: "",
    observations: [],
    intentHypothesis: "",
    evidence: [],
    sectionCandidates: [],
    commonCharacteristics: [],
    analysisConfidence: null,
    genrePrincipleHypothesis: "",
  }
  let heading = ""
  let evidenceGroup = "evidence"
  const intentLines = []
  const principleLines = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith("Category:")) {
      technique.category = categorySlug(line.slice("Category:".length))
      continue
    }
    if (line.startsWith("### ")) {
      heading = line.slice(4).trim().toLowerCase()
      evidenceGroup = "evidence"
      continue
    }
    if (heading === "evidence") {
      if (line === "Representative Sections:") {
        evidenceGroup = "sections"
        continue
      }
      if (line === "Common Characteristics:") {
        evidenceGroup = "characteristics"
        continue
      }
      if (line.startsWith("Confidence:")) {
        technique.analysisConfidence = confidence(
          line.slice("Confidence:".length).trim(),
          "analysis confidence",
        )
        continue
      }
    }
    if (!line) continue
    if (line.startsWith("- ")) {
      const item = line.slice(2).trim()
      if (heading === "observation") {
        technique.observations.push(item)
      } else if (heading === "evidence") {
        if (evidenceGroup === "sections") {
          technique.sectionCandidates.push(item)
        } else if (evidenceGroup === "characteristics") {
          technique.commonCharacteristics.push(item)
        } else {
          technique.evidence.push(parseEvidenceLine(item))
        }
      }
      continue
    }
    if (heading === "intent") intentLines.push(line)
    if (heading === "genre principle") principleLines.push(line)
  }
  technique.intentHypothesis = paragraph(intentLines)
  technique.genrePrincipleHypothesis = paragraph(principleLines)
  if (
    !technique.category ||
    technique.observations.length === 0 ||
    !technique.intentHypothesis ||
    technique.evidence.length === 0 ||
    technique.analysisConfidence === null
  ) {
    throw new Error(`Incomplete Technique block: ${technique.name}`)
  }
  return technique
}

export function parseGenreAnalysisMarkdown(markdown) {
  const genre = /^Genre:\s*(.+)$/m.exec(markdown)?.[1]?.trim()
  const status = /^Status:\s*(.+)$/m.exec(markdown)?.[1]?.trim()
  if (!genre) throw new Error("Analysis Markdown has no Genre")
  const matches = [
    ...markdown.matchAll(/^## Technique \d+:\s*(.+)$/gm),
  ]
  if (matches.length === 0) {
    throw new Error("Analysis Markdown has no Technique blocks")
  }
  const techniques = matches.map((match, index) => {
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? markdown.length
    return parseTechniqueBlock(match[1], markdown.slice(start, end))
  })
  return {
    genre,
    status: status?.toLowerCase() ?? "draft",
    techniques,
  }
}

function persistentTechniqueId(techniques) {
  return nextId(techniques, "TECH")
}

function techniqueMatch(
  knowledgeBase,
  parsedTechnique,
  occupiedTechniques = knowledgeBase.techniques,
) {
  const exact = knowledgeBase.techniques.find(
    (technique) =>
      normalize(technique.name) === normalize(parsedTechnique.name),
  )
  if (exact) {
    return {
      techniqueId: exact.id,
      registrationStatus: "matched-existing",
      existingMatchCandidates: [
        { techniqueId: exact.id, name: exact.name, score: 1 },
      ],
    }
  }
  const workspace = {
    techniques: knowledgeBase.techniques,
  }
  const candidates = searchTechniques(
    workspace,
    parsedTechnique.name,
    5,
  ).map((candidate) => ({
    techniqueId: candidate.technique.id,
    name: candidate.technique.name,
    score: candidate.score,
  }))
  if (candidates[0]?.score >= 0.8) {
    return {
      techniqueId: candidates[0].techniqueId,
      registrationStatus: "needs-human-link",
      existingMatchCandidates: candidates,
    }
  }
  return {
    techniqueId: persistentTechniqueId(occupiedTechniques),
    registrationStatus: "new-draft",
    existingMatchCandidates: candidates,
  }
}

function dictionaryAnchor(workspace, techniqueName) {
  const normalizedName = normalize(techniqueName)
  return workspace.observationDefinitions.find(
    (definition) =>
      normalize(definition.canonicalName) === normalizedName ||
      definition.aliases.some(
        (alias) => normalize(alias) === normalizedName,
      ),
  )
}

function observationMatch(workspace, sourceText, techniqueName, index) {
  const normalizedText = normalize(sourceText)
  const exact = workspace.observationDefinitions.find(
    (definition) => normalize(definition.canonicalName) === normalizedText,
  )
  if (exact) {
    return {
      id: `OBS-MATCH-${String(index).padStart(4, "0")}`,
      sourceText,
      matchType: "exact-match",
      observationId: exact.id,
      candidateObservationIds: [exact.id],
      reason: "Canonical Name exact match",
      requiresHumanConfirmation: false,
    }
  }
  const alias = workspace.observationDefinitions.find((definition) =>
    definition.aliases.some(
      (candidate) => normalize(candidate) === normalizedText,
    ),
  )
  if (alias) {
    return {
      id: `OBS-MATCH-${String(index).padStart(4, "0")}`,
      sourceText,
      matchType: "alias-match",
      observationId: alias.id,
      candidateObservationIds: [alias.id],
      reason: "Alias exact match",
      requiresHumanConfirmation: false,
    }
  }
  const anchor = dictionaryAnchor(workspace, techniqueName)
  if (anchor) {
    return {
      id: `OBS-MATCH-${String(index).padStart(4, "0")}`,
      sourceText,
      matchType: "related-match",
      observationId: anchor.id,
      candidateObservationIds: [anchor.id],
      reason: "Related through the Technique's Dictionary anchor",
      requiresHumanConfirmation: true,
    }
  }
  const candidates = searchObservationDefinitions(
    workspace,
    sourceText,
    { limit: 3 },
  )
    .filter((candidate) => candidate.score >= 0.3)
    .map((candidate) => candidate.definition.id)
  return {
    id: `OBS-MATCH-${String(index).padStart(4, "0")}`,
    sourceText,
    matchType:
      candidates.length > 0
        ? "related-match"
        : "new-observation-candidate",
    observationId: null,
    candidateObservationIds: candidates,
    reason:
      candidates.length > 0
        ? "Lexically related Dictionary candidates"
        : "No reliable Dictionary match",
    requiresHumanConfirmation: true,
  }
}

function sourceReference(sourceRegistry, evidence) {
  const reference = sourceRegistry.references.find(
    (candidate) =>
      normalize(candidate.artist) === normalize(evidence.artistName) &&
      normalize(candidate.song) === normalize(evidence.songTitle),
  )
  if (!reference) {
    throw new Error(
      `Evidence Source is missing from registry: ${evidence.artistName} – ${evidence.songTitle}`,
    )
  }
  return reference
}

function sectionNote(candidates) {
  return candidates.length > 0
    ? `候補: ${candidates.join(", ")}。正式区分は未確認`
    : "正式区分は未確認"
}

export function importFirstAnalysis(input, clock) {
  const workspace = ensureObservationWorkspace(input.workspace)
  const parsed = parseGenreAnalysisMarkdown(input.analysisMarkdown)
  if (normalize(parsed.genre) !== normalize(input.sourceRegistry.genre)) {
    throw new Error("Analysis Genre and Source Registry Genre differ")
  }
  const createdAt = nowIso(clock)
  const techniqueCandidates = []
  const observationInstances = []
  const evidenceCandidates = []
  const occupiedTechniques = input.knowledgeBase.techniques.map(
    (technique) => ({ id: technique.id }),
  )
  let matchIndex = 1
  for (const parsedTechnique of parsed.techniques) {
    const matched = techniqueMatch(
      input.knowledgeBase,
      parsedTechnique,
      occupiedTechniques,
    )
    if (
      !occupiedTechniques.some(
        (technique) => technique.id === matched.techniqueId,
      )
    ) {
      occupiedTechniques.push({ id: matched.techniqueId })
    }
    const observationMatches = parsedTechnique.observations.map(
      (sourceText) =>
        observationMatch(
          workspace,
          sourceText,
          parsedTechnique.name,
          matchIndex++,
        ),
    )
    techniqueCandidates.push({
      id: `PIPELINE-TECH-${String(techniqueCandidates.length + 1).padStart(4, "0")}`,
      techniqueId: matched.techniqueId,
      name: parsedTechnique.name,
      category: parsedTechnique.category,
      registrationStatus: matched.registrationStatus,
      existingMatchCandidates: matched.existingMatchCandidates,
      observationMatches,
      intentHypothesis: parsedTechnique.intentHypothesis,
      genrePrincipleHypothesis:
        parsedTechnique.genrePrincipleHypothesis,
      confidence: {
        analysisConfidence: parsedTechnique.analysisConfidence,
      },
    })
    for (const evidence of parsedTechnique.evidence) {
      const reference = sourceReference(input.sourceRegistry, evidence)
      const evidenceId = nextId(evidenceCandidates, "EVD")
      const instanceIds = observationMatches.map((match) => {
        const instance = {
          id: `OBSERVATION-CANDIDATE-${String(observationInstances.length + 1).padStart(4, "0")}`,
          observationId: match.observationId,
          candidateObservationIds: match.candidateObservationIds,
          matchType: match.matchType,
          songId: reference.referenceId,
          sectionId: null,
          evidenceId,
          value: match.observationId ? true : undefined,
          confidence: parsedTechnique.analysisConfidence,
          validationStatus: "draft",
          note: match.sourceText,
          createdAt,
          updatedAt: createdAt,
        }
        observationInstances.push(instance)
        return instance.id
      })
      evidenceCandidates.push({
        id: evidenceId,
        techniqueId: matched.techniqueId,
        genreId: input.sourceRegistry.genreSourceId,
        referenceId: reference.referenceId,
        songTitle: reference.song,
        artistName: reference.artist,
        sectionName: "unresolved",
        sectionCandidates: [...parsedTechnique.sectionCandidates],
        sectionNote: sectionNote(parsedTechnique.sectionCandidates),
        startTime: null,
        endTime: null,
        timeStatus: "unknown",
        timeNotRequired: false,
        observationInstanceIds: instanceIds,
        analysisNote: parsedTechnique.commonCharacteristics.join("; "),
        intentHypothesis: parsedTechnique.intentHypothesis,
        confidence: {
          analysisConfidence: parsedTechnique.analysisConfidence,
        },
        validationStatus: "needs-listening",
        reviewedBy: null,
        reviewedAt: null,
        createdAt,
        updatedAt: createdAt,
      })
    }
  }
  const pipeline = {
    schemaVersion: PIPELINE_SCHEMA_VERSION,
    id: "VALIDATION-PIPELINE-0001",
    genre: {
      id: input.sourceRegistry.genreSourceId,
      name: input.sourceRegistry.genre,
    },
    analysisStatus: parsed.status,
    importStatus: "draft",
    techniqueCandidates,
    observationInstances,
    evidenceCandidates,
    reviewHistory: [],
    ruleCandidates: [],
    createdAt,
    updatedAt: createdAt,
  }
  const validation = validateFirstAnalysisPipeline(pipeline)
  if (!validation.valid) {
    throw new Error(`Invalid imported Pipeline: ${validation.errors.join("; ")}`)
  }
  return { pipeline, validation }
}

function evidenceById(pipeline, evidenceId) {
  const evidence = pipeline.evidenceCandidates.find(
    (candidate) => candidate.id === evidenceId,
  )
  if (!evidence) throw new Error(`Evidence Candidate not found: ${evidenceId}`)
  return evidence
}

function validSectionName(value) {
  return SECTION_TYPES.includes(value) && value !== "other"
}

function reviewSnapshot(evidence) {
  return {
    techniqueId: evidence.techniqueId,
    sectionName: evidence.sectionName,
    sectionNote: evidence.sectionNote,
    startTime: evidence.startTime,
    endTime: evidence.endTime,
    timeStatus: evidence.timeStatus,
    timeNotRequired: evidence.timeNotRequired,
    observationInstanceIds: [...evidence.observationInstanceIds],
    validationStatus: evidence.validationStatus,
    confidence: clone(evidence.confidence),
  }
}

export function reviewEvidenceCandidate(pipeline, input, clock) {
  const result = clone(pipeline)
  const evidence = evidenceById(result, input.evidenceId)
  const action = requireText(input.action, "review action").toLowerCase()
  if (!["validate", "reject", "revise"].includes(action)) {
    throw new Error(`Unsupported review action: ${input.action}`)
  }
  const reviewer = requireText(input.reviewer, "reviewer")
  const reason = requireText(input.reason, "review reason")
  const before = reviewSnapshot(evidence)
  if (input.techniqueId) evidence.techniqueId = input.techniqueId
  if (input.sectionName) {
    const sectionName = input.sectionName.toLowerCase()
    if (
      sectionName !== "unresolved" &&
      !validSectionName(sectionName)
    ) {
      throw new Error(`Unsupported Section: ${input.sectionName}`)
    }
    evidence.sectionName = sectionName
  }
  if (input.sectionNote !== undefined) {
    evidence.sectionNote = String(input.sectionNote)
  }
  if (input.startTime !== undefined) evidence.startTime = input.startTime
  if (input.endTime !== undefined) evidence.endTime = input.endTime
  if (input.timeStatus) {
    const timeStatus = input.timeStatus.toLowerCase()
    if (!TIME_STATUSES.includes(timeStatus)) {
      throw new Error(`Unsupported time status: ${input.timeStatus}`)
    }
    evidence.timeStatus = timeStatus
  }
  if (input.timeNotRequired !== undefined) {
    evidence.timeNotRequired = Boolean(input.timeNotRequired)
  }
  if (input.validationConfidence !== undefined) {
    evidence.confidence.validationConfidence = confidence(
      input.validationConfidence,
      "validation confidence",
    )
  }
  const reviewedAt = nowIso(clock)
  if (action === "validate") {
    const reasons = []
    if (!input.observationConfirmed) {
      reasons.push("Observation confirmation is required")
    }
    if (!input.techniqueRelationConfirmed) {
      reasons.push("Technique relation confirmation is required")
    }
    if (!input.sectionConfirmed || !validSectionName(evidence.sectionName)) {
      reasons.push("A confirmed standard Section is required")
    }
    const confirmedTime =
      evidence.timeStatus === "confirmed" &&
      Boolean(evidence.startTime) &&
      Boolean(evidence.endTime)
    if (!confirmedTime && !evidence.timeNotRequired) {
      reasons.push(
        "Confirmed start/end time or an explicit time-not-required decision is required",
      )
    }
    if (reasons.length > 0) throw new Error(reasons.join("; "))
    evidence.validationStatus = "validated"
  } else if (action === "reject") {
    evidence.validationStatus = "rejected"
  } else {
    evidence.validationStatus = "needs-listening"
  }
  evidence.reviewedBy = reviewer
  evidence.reviewedAt = reviewedAt
  evidence.updatedAt = reviewedAt
  result.reviewHistory.push({
    id: nextId(result.reviewHistory, "EVIDENCE-REVIEW"),
    evidenceId: evidence.id,
    action,
    reviewer,
    reason,
    confirmation: {
      observationConfirmed: Boolean(input.observationConfirmed),
      techniqueRelationConfirmed: Boolean(
        input.techniqueRelationConfirmed,
      ),
      sectionConfirmed: Boolean(input.sectionConfirmed),
      timeConfirmed:
        evidence.timeStatus === "confirmed" &&
        Boolean(evidence.startTime) &&
        Boolean(evidence.endTime),
      timeNotRequired: evidence.timeNotRequired,
    },
    reviewedAt,
    before,
    after: reviewSnapshot(evidence),
  })
  result.updatedAt = reviewedAt
  const validation = validateFirstAnalysisPipeline(result)
  if (!validation.valid) {
    throw new Error(`Invalid review result: ${validation.errors.join("; ")}`)
  }
  return { pipeline: result, evidence: clone(evidence), validation }
}

function sortedQueue(items, sort) {
  const values = [...items]
  const compareText = (getter) => (left, right) =>
    getter(left).localeCompare(getter(right))
  if (sort === "technique") {
    return values.sort(compareText((item) => item.techniqueId))
  }
  if (sort === "song") {
    return values.sort(compareText((item) => item.songTitle))
  }
  if (sort === "genre") {
    return values.sort(compareText((item) => item.genreId))
  }
  if (sort === "confidence") {
    return values.sort(
      (left, right) =>
        right.confidence.analysisConfidence -
        left.confidence.analysisConfidence,
    )
  }
  if (sort === "missing-time") {
    return values.sort(
      (left, right) =>
        Number(left.timeStatus !== "unknown") -
        Number(right.timeStatus !== "unknown"),
    )
  }
  if (sort === "unconfirmed-section") {
    return values.sort(
      (left, right) =>
        Number(left.sectionName !== "unresolved") -
        Number(right.sectionName !== "unresolved"),
    )
  }
  throw new Error(`Unsupported queue sort: ${sort}`)
}

function techniqueName(pipeline, techniqueId) {
  return (
    pipeline.techniqueCandidates.find(
      (candidate) => candidate.techniqueId === techniqueId,
    )?.name ?? techniqueId
  )
}

function observationNotes(pipeline, evidence) {
  const ids = new Set(evidence.observationInstanceIds)
  return pipeline.observationInstances.filter((instance) =>
    ids.has(instance.id),
  )
}

export function exportValidationQueueMarkdown(
  pipeline,
  sort = "technique",
) {
  const queue = sortedQueue(
    pipeline.evidenceCandidates.filter(
      (item) => item.validationStatus === "needs-listening",
    ),
    sort,
  )
  const lines = [
    "# Validation Queue",
    "",
    `- Genre: ${pipeline.genre.name}`,
    `- Pending Evidence: ${queue.length}`,
    "",
  ]
  let currentTechnique = null
  for (const evidence of queue) {
    if (currentTechnique !== evidence.techniqueId) {
      currentTechnique = evidence.techniqueId
      lines.push(
        `## ${evidence.techniqueId} — ${techniqueName(pipeline, evidence.techniqueId)}`,
        "",
      )
    }
    lines.push(
      `### Evidence ${evidence.id}`,
      "",
      `- Genre: ${pipeline.genre.name}`,
      `- Song: ${evidence.songTitle}`,
      `- Artist: ${evidence.artistName}`,
      `- Section: ${evidence.sectionName}`,
      `- Section Candidates: ${evidence.sectionCandidates.join(", ")}`,
      `- Start: ${evidence.startTime ?? "Unknown"}`,
      `- End: ${evidence.endTime ?? "Unknown"}`,
      `- Time Status: ${evidence.timeStatus}`,
      `- Status: ${evidence.validationStatus}`,
      `- Analysis Confidence: ${evidence.confidence.analysisConfidence}`,
      `- Intent Hypothesis: ${evidence.intentHypothesis}`,
      "",
      "#### Confirm",
      "",
      ...observationNotes(pipeline, evidence).flatMap((instance) => [
        `- [ ] ${instance.note}`,
        `  - Match: ${instance.matchType}`,
        `  - Observation: ${
          instance.observationId ??
          (instance.candidateObservationIds.join(", ") || "Unresolved")
        }`,
      ]),
      "- [ ] Techniqueとの関連が妥当",
      "- [ ] Sectionが妥当",
      "- [ ] 時間範囲が妥当、または時間不要の根拠がある",
      "",
      "#### Review",
      "",
      "- Result:",
      "- Reviewer:",
      "- Reason:",
      "- Confirmed Section:",
      "- Confirmed Start:",
      "- Confirmed End:",
      "- Time Status:",
      "- Time Not Required: false",
      "- Observation Confirmed: false",
      "- Technique Relation Confirmed: false",
      "- Section Confirmed: false",
      "- Validation Confidence:",
      "- Notes:",
      "",
    )
  }
  lines.push(
    "```validation-pipeline-json",
    JSON.stringify(pipeline, null, 2),
    "```",
    "",
  )
  return lines.join("\n")
}

function reviewField(block, name) {
  return new RegExp(
    `^- ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:[ \\t]*([^\\r\\n]*)$`,
    "m",
  ).exec(block)?.[1]?.trim()
}

function parseBooleanReview(value) {
  if (!value) return false
  if (value.toLowerCase() === "true") return true
  if (value.toLowerCase() === "false") return false
  throw new Error(`Expected true or false, received: ${value}`)
}

export function importValidationQueueMarkdown(pipeline, markdown, clock) {
  let result = clone(pipeline)
  const matches = [...markdown.matchAll(/^### Evidence (EVD-\d+)$/gm)]
  const reviewedEvidenceIds = []
  for (const [index, match] of matches.entries()) {
    const start = match.index
    const end = matches[index + 1]?.index ?? markdown.length
    const block = markdown.slice(start, end)
    const reviewStart = block.indexOf("#### Review")
    if (reviewStart < 0) continue
    const review = block.slice(reviewStart)
    const resultValue = reviewField(review, "Result")
    if (!resultValue) continue
    const action = resultValue.toLowerCase()
    const changed = reviewEvidenceCandidate(
      result,
      {
        evidenceId: match[1],
        action,
        reviewer: reviewField(review, "Reviewer"),
        reason: reviewField(review, "Reason"),
        sectionName:
          reviewField(review, "Confirmed Section") || undefined,
        startTime:
          reviewField(review, "Confirmed Start") || undefined,
        endTime: reviewField(review, "Confirmed End") || undefined,
        timeStatus: reviewField(review, "Time Status") || undefined,
        timeNotRequired: parseBooleanReview(
          reviewField(review, "Time Not Required"),
        ),
        observationConfirmed: parseBooleanReview(
          reviewField(review, "Observation Confirmed"),
        ),
        techniqueRelationConfirmed: parseBooleanReview(
          reviewField(review, "Technique Relation Confirmed"),
        ),
        sectionConfirmed: parseBooleanReview(
          reviewField(review, "Section Confirmed"),
        ),
        validationConfidence:
          reviewField(review, "Validation Confidence") || undefined,
        sectionNote: reviewField(review, "Notes") || undefined,
      },
      clock,
    )
    result = changed.pipeline
    reviewedEvidenceIds.push(match[1])
  }
  return { pipeline: result, reviewedEvidenceIds }
}

export function techniquePromotionCandidates(pipeline) {
  return pipeline.techniqueCandidates.map((technique) => {
    const evidence = pipeline.evidenceCandidates.filter(
      (candidate) =>
        candidate.techniqueId === technique.techniqueId &&
        candidate.validationStatus === "validated",
    )
    const references = new Set(
      evidence.map((candidate) => candidate.referenceId),
    )
    const genres = new Set(evidence.map((candidate) => candidate.genreId))
    return {
      techniqueId: technique.techniqueId,
      name: technique.name,
      validatedEligible: evidence.length >= 1,
      canonicalCandidate:
        references.size >= 3 || genres.size >= 2,
      reasons: [
        `${evidence.length} validated Evidence`,
        `${references.size} distinct References`,
        `${genres.size} distinct Genre Sources`,
      ],
      automaticPromotion: false,
    }
  })
}

export function generateAnonymousRuleCandidates(pipeline, clock) {
  const generatedAt = nowIso(clock)
  const rules = []
  const blocked = []
  for (const technique of pipeline.techniqueCandidates) {
    const evidence = pipeline.evidenceCandidates.filter(
      (candidate) =>
        candidate.techniqueId === technique.techniqueId &&
        candidate.validationStatus === "validated",
    )
    if (evidence.length === 0) {
      blocked.push({
        techniqueId: technique.techniqueId,
        reason: "No validated Evidence",
      })
      continue
    }
    const validationConfidence = evidence
      .map((candidate) => candidate.confidence.validationConfidence)
      .filter((value) => value !== undefined)
    rules.push({
      id: `RULE-CANDIDATE-${String(rules.length + 1).padStart(4, "0")}`,
      techniqueId: technique.techniqueId,
      category: technique.category,
      applicableSections: [
        ...new Set(evidence.map((candidate) => candidate.sectionName)),
      ],
      preconditions: [],
      action: {
        type: "manual-authoring-required",
      },
      intendedEffect: [technique.intentHypothesis],
      constraints: [
        "Execution mapping requires human authoring",
        "Do not reproduce a specific recording",
      ],
      confidence: {
        analysisConfidence: technique.confidence.analysisConfidence,
        ...(validationConfidence.length > 0
          ? {
              validationConfidence:
                validationConfidence.reduce(
                  (sum, value) => sum + value,
                  0,
                ) / validationConfidence.length,
            }
          : {}),
      },
      sourceEvidenceIds: evidence.map((candidate) => candidate.id),
      status: "draft-rule-candidate",
      generatedAt,
    })
  }
  const result = {
    schemaVersion: 1,
    status: "draft",
    ruleCandidates: rules,
    blockedCandidates: blocked,
    generatedAt,
  }
  const privateTerms = pipeline.evidenceCandidates.flatMap((evidence) => [
    evidence.artistName,
    evidence.songTitle,
  ])
  const serialized = JSON.stringify(result)
  for (const term of privateTerms) {
    if (term && serialized.includes(term)) {
      throw new Error("Anonymous Rule Candidate contains reference metadata")
    }
  }
  return result
}

export function validateFirstAnalysisPipeline(pipeline) {
  const errors = []
  const warnings = []
  if (pipeline.schemaVersion !== PIPELINE_SCHEMA_VERSION) {
    errors.push(`Unsupported Pipeline schemaVersion: ${pipeline.schemaVersion}`)
  }
  const techniqueIds = new Set(
    pipeline.techniqueCandidates.map((candidate) => candidate.techniqueId),
  )
  const observationIds = new Set()
  for (const instance of pipeline.observationInstances) {
    if (observationIds.has(instance.id)) {
      errors.push(`Duplicate Observation Instance ID: ${instance.id}`)
    }
    observationIds.add(instance.id)
    if (!OBSERVATION_MATCH_TYPES.includes(instance.matchType)) {
      errors.push(`Invalid Observation match type: ${instance.id}`)
    }
    if (
      instance.matchType === "related-match" ||
      instance.matchType === "unresolved" ||
      instance.matchType === "new-observation-candidate"
    ) {
      warnings.push(`${instance.id} requires human Observation confirmation`)
    }
  }
  const evidenceIds = new Set()
  for (const evidence of pipeline.evidenceCandidates) {
    if (evidenceIds.has(evidence.id)) {
      errors.push(`Duplicate Evidence Candidate ID: ${evidence.id}`)
    }
    evidenceIds.add(evidence.id)
    if (!techniqueIds.has(evidence.techniqueId)) {
      errors.push(`${evidence.id} has invalid Technique ID`)
    }
    if (
      evidence.observationInstanceIds.some(
        (id) => !observationIds.has(id),
      )
    ) {
      errors.push(`${evidence.id} has invalid Observation Instance ID`)
    }
    if (!EVIDENCE_VALIDATION_STATUSES.includes(evidence.validationStatus)) {
      errors.push(`${evidence.id} has invalid validationStatus`)
    }
    if (!TIME_STATUSES.includes(evidence.timeStatus)) {
      errors.push(`${evidence.id} has invalid timeStatus`)
    }
    try {
      confidence(evidence.confidence.analysisConfidence)
      if (evidence.confidence.validationConfidence !== undefined) {
        confidence(evidence.confidence.validationConfidence)
      }
    } catch (error) {
      errors.push(`${evidence.id}: ${error.message}`)
    }
    if (evidence.timeStatus === "unknown") {
      if (evidence.startTime || evidence.endTime) {
        errors.push(`${evidence.id} has time values while timeStatus is unknown`)
      }
      warnings.push(`${evidence.id} requires listening for time confirmation`)
    }
    if (evidence.sectionName === "unresolved") {
      warnings.push(`${evidence.id} requires Section confirmation`)
    }
    if (evidence.validationStatus === "validated") {
      if (!validSectionName(evidence.sectionName)) {
        errors.push(`${evidence.id} is Validated without a standard Section`)
      }
      const confirmedTime =
        evidence.timeStatus === "confirmed" &&
        Boolean(evidence.startTime) &&
        Boolean(evidence.endTime)
      if (!confirmedTime && !evidence.timeNotRequired) {
        errors.push(`${evidence.id} is Validated without confirmed time`)
      }
      if (
        !pipeline.reviewHistory.some((review) => {
          if (
            review.evidenceId !== evidence.id ||
            review.action !== "validate"
          ) {
            return false
          }
          return (
            review.confirmation?.observationConfirmed &&
            review.confirmation?.techniqueRelationConfirmed &&
            review.confirmation?.sectionConfirmed &&
            (review.confirmation?.timeConfirmed ||
              review.confirmation?.timeNotRequired)
          )
        })
      ) {
        errors.push(`${evidence.id} is Validated without Review History`)
      }
    }
  }
  for (const review of pipeline.reviewHistory) {
    if (!evidenceIds.has(review.evidenceId)) {
      errors.push(`${review.id} has invalid Evidence ID`)
    }
    if (review.action === "reject" && !review.reason) {
      errors.push(`${review.id} Reject requires a reason`)
    }
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  }
}
