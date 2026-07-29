import {
  ensureObservationWorkspace,
  validateObservationDictionary,
} from "./observation-dictionary.mjs"
import { createObservationSeed } from "./observation-seed.mjs"

export const WORKSPACE_SCHEMA_VERSION = 1
export const SECTION_TYPES = [
  "intro",
  "verse",
  "pre-chorus",
  "chorus",
  "bridge",
  "interlude",
  "break",
  "outro",
  "transition",
  "other",
]
export const TECHNIQUE_STATUSES = [
  "draft",
  "validated",
  "canonical",
  "deprecated",
]
export const TECHNIQUE_CATEGORIES = [
  "decoration",
  "phrase",
  "counter",
  "transition",
  "texture",
  "dynamics",
  "harmony",
  "rhythm",
  "sound-design",
  "automation",
  "arrangement",
  "mix-perspective",
]
export const CANONICAL_EVIDENCE_THRESHOLD = 6

const STATUS_RANK = {
  draft: 0,
  validated: 1,
  canonical: 2,
  deprecated: -1,
}

function clone(value) {
  return structuredClone(value)
}

function nowIso(clock) {
  return (clock?.() ?? new Date()).toISOString()
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }
  return value.trim()
}

function optionalNumber(value, label) {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number`)
  return parsed
}

function confidenceValue(value = 0.5) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("confidence must be between 0 and 1")
  }
  return parsed
}

function nextId(items, prefix, width = 4) {
  const expression = new RegExp(`^${prefix}-(\\d+)$`)
  const maximum = items.reduce((max, item) => {
    const match = expression.exec(item.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}-${String(maximum + 1).padStart(width, "0")}`
}

function findById(items, id, label) {
  const result = items.find((item) => item.id === id)
  if (!result) throw new Error(`${label} not found: ${id}`)
  return result
}

function replaceById(items, replacement) {
  return items.map((item) =>
    item.id === replacement.id ? replacement : item,
  )
}

export function emptyWorkspace() {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    projects: [],
    songs: [],
    sections: [],
    observationDefinitions: createObservationSeed(),
    observations: [],
    techniques: [],
  }
}

export function createProject(workspace, input, clock) {
  const createdAt = nowIso(clock)
  const project = {
    id: nextId(workspace.projects, "PROJECT"),
    name: requireText(input.name, "project name"),
    genre: requireText(input.genre, "genre"),
    createdAt,
    updatedAt: createdAt,
  }
  return {
    workspace: {
      ...clone(workspace),
      projects: [...workspace.projects, project],
    },
    project,
  }
}

export function addSong(workspace, input, clock) {
  const project = findById(
    workspace.projects,
    input.projectId,
    "Project",
  )
  const createdAt = nowIso(clock)
  const year = Number(input.year)
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error("year must be a four-digit integer")
  }
  const bpm = optionalNumber(input.bpm, "bpm")
  if (bpm !== null && bpm <= 0) throw new Error("bpm must be positive")
  const song = {
    id: nextId(workspace.songs, "SONG"),
    projectId: project.id,
    title: requireText(input.title, "song title"),
    artist: requireText(input.artist, "artist"),
    album: requireText(input.album, "album"),
    year,
    bpm,
    key: input.key ? String(input.key).trim() : null,
    genre: input.genre
      ? requireText(input.genre, "genre")
      : project.genre,
    createdAt,
    updatedAt: createdAt,
  }
  return {
    workspace: {
      ...clone(workspace),
      songs: [...workspace.songs, song],
    },
    song,
  }
}

export function addSection(workspace, input, clock) {
  const song = findById(workspace.songs, input.songId, "Song")
  const type = requireText(input.type, "section type")
  if (!SECTION_TYPES.includes(type)) {
    throw new Error(`Unsupported section type: ${type}`)
  }
  const startSeconds = optionalNumber(input.startSeconds, "start")
  const endSeconds = optionalNumber(input.endSeconds, "end")
  if (
    startSeconds === null ||
    endSeconds === null ||
    startSeconds < 0 ||
    endSeconds <= startSeconds
  ) {
    throw new Error("Section requires start >= 0 and end > start")
  }
  const overlaps = workspace.sections.some(
    (section) =>
      section.songId === song.id &&
      startSeconds < section.endSeconds &&
      endSeconds > section.startSeconds,
  )
  if (overlaps) throw new Error("Section time range overlaps an existing section")
  const createdAt = nowIso(clock)
  const section = {
    id: nextId(workspace.sections, "SECTION"),
    songId: song.id,
    type,
    label: input.label ? String(input.label).trim() : null,
    startSeconds,
    endSeconds,
    createdAt,
    updatedAt: createdAt,
  }
  return {
    workspace: {
      ...clone(workspace),
      sections: [...workspace.sections, section],
    },
    section,
  }
}

export function addObservation(workspace, input, clock) {
  const section = findById(
    workspace.sections,
    input.sectionId,
    "Section",
  )
  const techniqueCandidateIds = [
    ...new Set(input.techniqueCandidateIds ?? []),
  ]
  for (const techniqueId of techniqueCandidateIds) {
    findById(workspace.techniques, techniqueId, "Technique")
  }
  const validation = input.validation ?? "draft"
  if (!["draft", "validated"].includes(validation)) {
    throw new Error("Observation validation must be draft or validated")
  }
  const createdAt = nowIso(clock)
  const observation = {
    id: nextId(workspace.observations, "OBSERVATION"),
    sectionId: section.id,
    observation: requireText(input.observation, "observation"),
    intent: requireText(input.intent, "intent"),
    techniqueCandidateIds,
    confidence: confidenceValue(input.confidence),
    validation,
    createdAt,
    updatedAt: createdAt,
  }
  return {
    workspace: {
      ...clone(workspace),
      observations: [...workspace.observations, observation],
    },
    observation,
  }
}

export function setObservationValidation(workspace, input, clock) {
  const observation = clone(
    findById(workspace.observations, input.observationId, "Observation"),
  )
  const validation = requireText(input.validation, "validation")
  if (!["draft", "validated"].includes(validation)) {
    throw new Error("Observation validation must be draft or validated")
  }
  const updatedAt = nowIso(clock)
  if (observation.kind === "dictionary-instance") {
    observation.validationStatus = validation
  } else {
    observation.validation = validation
  }
  observation.updatedAt = updatedAt
  const verified = validation === "validated"
  const techniques = workspace.techniques.map((item) => {
    if (
      !item.evidence.some(
        (evidence) => evidence.observationId === observation.id,
      )
    ) {
      return item
    }
    const technique = clone(item)
    technique.evidence = technique.evidence.map((evidence) =>
      evidence.observationId === observation.id
        ? (() => {
            const intentConfirmed =
              observation.kind === "dictionary-instance"
                ? evidence.intentConfirmed
                : verified
            return {
              ...evidence,
              sectionConfirmed: verified,
              intentConfirmed,
              observationConfirmed: verified,
              verifiedAt:
                verified && intentConfirmed ? updatedAt : null,
            }
          })()
        : evidence,
    )
    technique.updatedAt = updatedAt
    return technique
  })
  return {
    workspace: {
      ...clone(workspace),
      observations: replaceById(workspace.observations, observation),
      techniques,
    },
    observation,
  }
}

function normalizeSearch(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
    .trim()
}

function bigrams(value) {
  const normalized = normalizeSearch(value).replace(/\s+/g, "")
  if (normalized.length < 2) return new Set([normalized])
  return new Set(
    Array.from(
      { length: normalized.length - 1 },
      (_, index) => normalized.slice(index, index + 2),
    ),
  )
}

function jaccard(left, right) {
  const union = new Set([...left, ...right])
  if (union.size === 0) return 0
  let intersection = 0
  for (const value of left) {
    if (right.has(value)) intersection += 1
  }
  return intersection / union.size
}

function techniqueText(technique) {
  return [
    technique.id,
    technique.name,
    technique.observation,
    technique.intent,
  ].join(" ")
}

export function searchTechniques(workspace, query, limit = 10) {
  const normalizedQuery = normalizeSearch(requireText(query, "query"))
  const queryBigrams = bigrams(normalizedQuery)
  return workspace.techniques
    .map((technique) => {
      const text = normalizeSearch(techniqueText(technique))
      const normalizedName = normalizeSearch(technique.name)
      const contains = text.includes(normalizedQuery)
      const textScore = contains
        ? Math.min(1, 0.75 + normalizedQuery.length / Math.max(40, text.length))
        : jaccard(queryBigrams, bigrams(text))
      const nameScore = Math.max(
        normalizedName.includes(normalizedQuery) ||
          normalizedQuery.includes(normalizedName)
          ? 0.8
          : 0,
        jaccard(queryBigrams, bigrams(normalizedName)),
      )
      const score = Math.max(textScore, nameScore)
      return { technique: clone(technique), score }
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

export function createTechnique(workspace, input, clock) {
  const category = requireText(input.category, "category")
  if (!TECHNIQUE_CATEGORIES.includes(category)) {
    throw new Error(`Unsupported technique category: ${category}`)
  }
  const createdAt = nowIso(clock)
  const technique = {
    id: nextId(workspace.techniques, "TECH"),
    version: 1,
    name: requireText(input.name, "technique name"),
    status: "draft",
    category,
    observation: requireText(input.observation, "observation"),
    intent: requireText(input.intent, "intent"),
    confidence: confidenceValue(input.confidence),
    genreSources: [
      {
        id: requireText(input.genreSourceId, "genre source id"),
        name: requireText(input.genre, "genre"),
      },
    ],
    evidence: [],
    reviewHistory: [],
    reproducibilityConfirmed: false,
    extensions: {
      analysisWorkspace: {
        genrePrinciple: {
          statement: "",
          confirmed: false,
        },
      },
    },
    createdAt,
    updatedAt: createdAt,
  }
  const duplicateCandidates = searchTechniques(
    workspace,
    technique.name,
    5,
  ).filter((candidate) => candidate.score >= 0.3)
  return {
    workspace: {
      ...clone(workspace),
      techniques: [...workspace.techniques, technique],
    },
    technique,
    duplicateCandidates,
  }
}

export function setGenrePrinciple(workspace, input, clock) {
  const technique = clone(
    findById(workspace.techniques, input.techniqueId, "Technique"),
  )
  technique.extensions ??= {}
  technique.extensions.analysisWorkspace ??= {}
  technique.extensions.analysisWorkspace.genrePrinciple = {
    statement: requireText(input.statement, "principle statement"),
    confirmed: Boolean(input.confirmed),
  }
  technique.version += 1
  technique.updatedAt = nowIso(clock)
  return {
    workspace: {
      ...clone(workspace),
      techniques: replaceById(workspace.techniques, technique),
    },
    technique,
  }
}

function observationContext(workspace, observationId) {
  const observation = findById(
    workspace.observations,
    observationId,
    "Observation",
  )
  const section = findById(
    workspace.sections,
    observation.sectionId,
    "Section",
  )
  const song = findById(workspace.songs, section.songId, "Song")
  const project = findById(
    workspace.projects,
    song.projectId,
    "Project",
  )
  return { observation, section, song, project }
}

export function linkEvidence(workspace, input, clock) {
  const context = observationContext(workspace, input.observationId)
  const technique = clone(
    findById(workspace.techniques, input.techniqueId, "Technique"),
  )
  const observationVerified =
    (context.observation.kind === "dictionary-instance"
      ? context.observation.validationStatus
      : context.observation.validation) === "validated"
  const intentVerified =
    context.observation.kind === "dictionary-instance"
      ? Boolean(input.intentConfirmed)
      : observationVerified
  const verifiedAt =
    observationVerified && intentVerified ? nowIso(clock) : null
  const evidence = {
    id: nextId(
      workspace.techniques.flatMap((candidate) => candidate.evidence),
      "EVIDENCE",
    ),
    techniqueId: technique.id,
    observationId: context.observation.id,
    referenceId: context.song.id,
    songTitle: context.song.title,
    artist: context.song.artist,
    album: context.song.album,
    year: context.song.year,
    genre: context.song.genre,
    genreSourceId: `genre-source-${context.project.id.toLowerCase()}`,
    section: context.section.type,
    startSeconds: context.section.startSeconds,
    endSeconds: context.section.endSeconds,
    comment: input.comment ? String(input.comment).trim() : "",
    sectionConfirmed: observationVerified,
    intentConfirmed: intentVerified,
    observationConfirmed: observationVerified,
    verifiedAt,
  }
  if (
    technique.evidence.some(
      (candidate) =>
        candidate.observationId === evidence.observationId &&
        candidate.techniqueId === evidence.techniqueId,
    )
  ) {
    throw new Error("This Observation is already linked as Evidence")
  }
  technique.evidence.push(evidence)
  if (
    !technique.genreSources.some(
      (source) => source.id === evidence.genreSourceId,
    )
  ) {
    technique.genreSources.push({
      id: evidence.genreSourceId,
      name: evidence.genre,
    })
  }
  technique.updatedAt = nowIso(clock)
  const observations =
    context.observation.kind === "dictionary-instance"
      ? workspace.observations.map((observation) =>
          observation.id === context.observation.id
            ? {
                ...observation,
                evidenceId: evidence.id,
                updatedAt: technique.updatedAt,
              }
            : observation,
        )
      : workspace.observations
  return {
    workspace: {
      ...clone(workspace),
      observations,
      techniques: replaceById(workspace.techniques, technique),
    },
    evidence,
  }
}

function verifiedEvidence(technique) {
  return technique.evidence.filter(
    (evidence) =>
      evidence.sectionConfirmed &&
      evidence.intentConfirmed &&
      evidence.observationConfirmed &&
      evidence.verifiedAt &&
      Number.isFinite(evidence.startSeconds) &&
      Number.isFinite(evidence.endSeconds) &&
      evidence.endSeconds > evidence.startSeconds,
  )
}

function principleConfirmed(technique) {
  return Boolean(
    technique.extensions?.analysisWorkspace?.genrePrinciple?.confirmed,
  )
}

export function validateStatusTransition(technique, targetStatus) {
  if (!TECHNIQUE_STATUSES.includes(targetStatus)) {
    return {
      eligible: false,
      reasons: [`Unsupported status: ${targetStatus}`],
    }
  }
  const evidence = verifiedEvidence(technique)
  const genres = new Set(evidence.map((item) => item.genreSourceId))
  const reasons = []
  if (["validated", "canonical"].includes(targetStatus)) {
    if (evidence.length < 1) reasons.push("At least one verified Evidence is required")
    if (!principleConfirmed(technique)) {
      reasons.push("A confirmed Genre Principle is required")
    }
  }
  if (targetStatus === "canonical") {
    if (technique.status !== "validated" && technique.status !== "canonical") {
      reasons.push("Canonical promotion starts from Validated")
    }
    if (
      genres.size < 2 &&
      evidence.length < CANONICAL_EVIDENCE_THRESHOLD
    ) {
      reasons.push(
        `Canonical requires two Genres or ${CANONICAL_EVIDENCE_THRESHOLD} verified Evidence items`,
      )
    }
    if (!technique.reproducibilityConfirmed) {
      reasons.push("Canonical requires reproducibility confirmation")
    }
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    verifiedEvidenceCount: evidence.length,
    distinctGenreCount: genres.size,
  }
}

export function transitionTechniqueStatus(workspace, input, clock) {
  const technique = clone(
    findById(workspace.techniques, input.techniqueId, "Technique"),
  )
  if (input.reproducibilityConfirmed !== undefined) {
    technique.reproducibilityConfirmed = Boolean(
      input.reproducibilityConfirmed,
    )
  }
  const validation = validateStatusTransition(
    technique,
    input.targetStatus,
  )
  if (!validation.eligible) return { workspace: clone(workspace), technique: null, validation }
  const reviewedAt = nowIso(clock)
  technique.reviewHistory.push({
    id: nextId(
      workspace.techniques.flatMap(
        (candidate) => candidate.reviewHistory,
      ),
      "REVIEW",
    ),
    reviewedAt,
    fromStatus: technique.status,
    toStatus: input.targetStatus,
    reason: requireText(input.reason, "review reason"),
    reviewer: requireText(input.reviewer, "reviewer"),
  })
  technique.status = input.targetStatus
  technique.version += 1
  technique.updatedAt = reviewedAt
  if (input.confidence !== undefined) {
    technique.confidence = confidenceValue(input.confidence)
  }
  return {
    workspace: {
      ...clone(workspace),
      techniques: replaceById(workspace.techniques, technique),
    },
    technique,
    validation,
  }
}

export function dashboard(workspace, genre = null) {
  const projects = genre
    ? workspace.projects.filter((project) => project.genre === genre)
    : workspace.projects
  const projectIds = new Set(projects.map((project) => project.id))
  const songs = workspace.songs.filter((song) =>
    projectIds.has(song.projectId),
  )
  const genreNames = new Set(projects.map((project) => project.genre))
  const techniques = genre
    ? workspace.techniques.filter((technique) =>
        technique.genreSources.some((source) =>
          genreNames.has(source.name),
        ),
      )
    : workspace.techniques
  return {
    genre: genre ?? "All",
    projectCount: projects.length,
    songCount: songs.length,
    techniqueCount: techniques.length,
    observationDefinitionCount:
      workspace.observationDefinitions?.length ?? 0,
    observationInstanceCount: workspace.observations.filter(
      (item) => item.kind === "dictionary-instance",
    ).length,
    draftCount: techniques.filter((item) => item.status === "draft").length,
    validatedCount: techniques.filter((item) => item.status === "validated").length,
    canonicalCount: techniques.filter((item) => item.status === "canonical").length,
    deprecatedCount: techniques.filter((item) => item.status === "deprecated").length,
    evidenceCount: techniques.reduce(
      (sum, technique) => sum + technique.evidence.length,
      0,
    ),
  }
}

export function draftTechniques(workspace, sort = "confidence") {
  const drafts = workspace.techniques
    .filter((technique) => technique.status === "draft")
    .map((technique) => clone(technique))
  if (sort === "updated") {
    return drafts.sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt)),
    )
  }
  if (sort === "genre") {
    return drafts.sort((left, right) =>
      (left.genreSources[0]?.name ?? "").localeCompare(
        right.genreSources[0]?.name ?? "",
      ),
    )
  }
  if (sort !== "confidence") throw new Error(`Unsupported draft sort: ${sort}`)
  return drafts.sort((left, right) => right.confidence - left.confidence)
}

export function validateWorkspace(workspace) {
  const errors = []
  const warnings = []
  if (!workspace || typeof workspace !== "object") {
    return {
      valid: false,
      errors: ["Workspace must be an object"],
      warnings,
    }
  }
  const normalizedWorkspace = ensureObservationWorkspace(workspace)
  if (workspace.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${workspace.schemaVersion}`)
  }
  const collections = [
    ["projects", normalizedWorkspace.projects],
    ["songs", normalizedWorkspace.songs],
    ["sections", normalizedWorkspace.sections],
    ["observationDefinitions", normalizedWorkspace.observationDefinitions],
    ["observations", normalizedWorkspace.observations],
    ["techniques", normalizedWorkspace.techniques],
  ]
  for (const [name, items] of collections) {
    if (!Array.isArray(items)) errors.push(`${name} must be an array`)
    const ids = new Set()
    for (const item of items ?? []) {
      if (ids.has(item.id)) errors.push(`Duplicate ${name} ID: ${item.id}`)
      ids.add(item.id)
    }
  }
  const projects = Array.isArray(normalizedWorkspace.projects)
    ? normalizedWorkspace.projects
    : []
  const songs = Array.isArray(normalizedWorkspace.songs)
    ? normalizedWorkspace.songs
    : []
  const sections = Array.isArray(normalizedWorkspace.sections)
    ? normalizedWorkspace.sections
    : []
  const observations = Array.isArray(normalizedWorkspace.observations)
    ? normalizedWorkspace.observations
    : []
  const techniques = Array.isArray(normalizedWorkspace.techniques)
    ? normalizedWorkspace.techniques
    : []
  const projectIds = new Set(projects.map((item) => item.id))
  const songIds = new Set(songs.map((item) => item.id))
  const sectionIds = new Set(sections.map((item) => item.id))
  const techniqueIds = new Set(techniques.map((item) => item.id))
  const observationIds = new Set(observations.map((item) => item.id))
  for (const song of songs) {
    if (!projectIds.has(song.projectId)) errors.push(`Song ${song.id} has invalid projectId`)
  }
  for (const section of sections) {
    if (!songIds.has(section.songId)) errors.push(`Section ${section.id} has invalid songId`)
    if (section.endSeconds <= section.startSeconds) errors.push(`Section ${section.id} has invalid time range`)
  }
  for (const song of songs) {
    if (!Number.isInteger(song.year) || song.year < 1000 || song.year > 9999) {
      errors.push(`Song ${song.id} has invalid year`)
    }
    if (song.bpm !== null && (!Number.isFinite(song.bpm) || song.bpm <= 0)) {
      errors.push(`Song ${song.id} has invalid bpm`)
    }
  }
  for (const songId of songIds) {
    const sorted = sections
      .filter((section) => section.songId === songId)
      .sort((left, right) => left.startSeconds - right.startSeconds)
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].startSeconds < sorted[index - 1].endSeconds) {
        errors.push(`Sections ${sorted[index - 1].id} and ${sorted[index].id} overlap`)
      }
    }
  }
  for (const observation of observations) {
    if (!sectionIds.has(observation.sectionId)) errors.push(`Observation ${observation.id} has invalid sectionId`)
    if (observation.kind === "dictionary-instance") {
      if (!songIds.has(observation.songId)) {
        errors.push(`Observation ${observation.id} has invalid songId`)
      }
      continue
    }
    for (const techniqueId of observation.techniqueCandidateIds ?? []) {
      if (!techniqueIds.has(techniqueId)) errors.push(`Observation ${observation.id} has invalid Technique ID`)
    }
    if (!["draft", "validated"].includes(observation.validation)) {
      errors.push(`Observation ${observation.id} has invalid validation`)
    }
    if (observation.confidence < 0 || observation.confidence > 1) {
      errors.push(`Observation ${observation.id} has invalid confidence`)
    }
  }
  const dictionaryValidation = validateObservationDictionary(
    normalizedWorkspace,
  )
  errors.push(...dictionaryValidation.errors)
  warnings.push(...dictionaryValidation.warnings)
  const evidenceIds = new Set()
  const reviewIds = new Set()
  for (const technique of techniques) {
    if (!/^TECH-\d{4,}$/.test(technique.id)) errors.push(`Invalid Technique ID: ${technique.id}`)
    if (!TECHNIQUE_STATUSES.includes(technique.status)) errors.push(`Invalid Technique status: ${technique.status}`)
    if (!TECHNIQUE_CATEGORIES.includes(technique.category)) errors.push(`Invalid Technique category: ${technique.id}`)
    if (technique.confidence < 0 || technique.confidence > 1) errors.push(`Invalid Technique confidence: ${technique.id}`)
    for (const evidence of technique.evidence ?? []) {
      if (evidenceIds.has(evidence.id)) errors.push(`Duplicate Evidence ID: ${evidence.id}`)
      evidenceIds.add(evidence.id)
      if (evidence.techniqueId !== technique.id) {
        errors.push(`Evidence ${evidence.id} has invalid techniqueId`)
      }
      if (!observationIds.has(evidence.observationId)) {
        errors.push(`Evidence ${evidence.id} has invalid observationId`)
      }
      if (!songIds.has(evidence.referenceId)) {
        errors.push(`Evidence ${evidence.id} has invalid referenceId`)
      }
    }
    for (const review of technique.reviewHistory ?? []) {
      if (reviewIds.has(review.id)) errors.push(`Duplicate Review ID: ${review.id}`)
      reviewIds.add(review.id)
      if (
        !TECHNIQUE_STATUSES.includes(review.fromStatus) ||
        !TECHNIQUE_STATUSES.includes(review.toStatus)
      ) {
        errors.push(`Review ${review.id} has invalid status`)
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  }
}

function projectSubset(workspace, projectId) {
  const project = findById(workspace.projects, projectId, "Project")
  const songs = workspace.songs.filter((song) => song.projectId === project.id)
  const songIds = new Set(songs.map((song) => song.id))
  const sections = workspace.sections.filter((section) =>
    songIds.has(section.songId),
  )
  const sectionIds = new Set(sections.map((section) => section.id))
  const observations = workspace.observations.filter((observation) =>
    sectionIds.has(observation.sectionId),
  )
  const techniqueIds = new Set(
    observations.flatMap(
      (observation) => observation.techniqueCandidateIds ?? [],
    ),
  )
  const observationDefinitionIds = new Set(
    observations
      .filter((observation) => observation.kind === "dictionary-instance")
      .map((observation) => observation.observationId),
  )
  let definitionCount = -1
  while (definitionCount !== observationDefinitionIds.size) {
    definitionCount = observationDefinitionIds.size
    for (const definition of workspace.observationDefinitions ?? []) {
      if (!observationDefinitionIds.has(definition.id)) continue
      for (const reference of [
        definition.parentObservationId,
        definition.mergedIntoObservationId,
        ...(definition.relatedObservationIds ?? []),
        ...(definition.oppositeObservationIds ?? []),
      ]) {
        if (reference) observationDefinitionIds.add(reference)
      }
    }
  }
  const observationDefinitions = (
    workspace.observationDefinitions ?? []
  ).filter((definition) => observationDefinitionIds.has(definition.id))
  for (const technique of workspace.techniques) {
    if (
      technique.evidence.some((evidence) =>
        observations.some(
          (observation) => observation.id === evidence.observationId,
        ),
      )
    ) {
      techniqueIds.add(technique.id)
    }
  }
  const techniques = workspace.techniques.filter((technique) =>
    techniqueIds.has(technique.id),
  )
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    projects: [project],
    songs,
    sections,
    observationDefinitions,
    observations,
    techniques,
  }
}

export function exportProjectMarkdown(workspace, projectId) {
  const subset = projectSubset(workspace, projectId)
  const project = subset.projects[0]
  const songLines = subset.songs.flatMap((song) => {
    const sections = subset.sections.filter(
      (section) => section.songId === song.id,
    )
    return [
      `## Song: ${song.title}`,
      "",
      `- Artist: ${song.artist}`,
      `- Album: ${song.album}`,
      `- Year: ${song.year}`,
      `- Genre: ${song.genre}`,
      `- BPM: ${song.bpm ?? ""}`,
      `- Key: ${song.key ?? ""}`,
      "",
      ...sections.flatMap((section) => [
        `### ${section.type} (${section.startSeconds}s–${section.endSeconds}s)`,
        "",
        ...subset.observations
          .filter((observation) => observation.sectionId === section.id)
          .flatMap((observation) =>
            observation.kind === "dictionary-instance"
              ? [
                  `- Observation ID: ${observation.observationId}`,
                  `- Value: ${JSON.stringify(observation.value ?? null)}`,
                  `- Unit: ${observation.unit ?? ""}`,
                  `- Confidence: ${observation.confidence}`,
                  `- Validation: ${observation.validationStatus}`,
                  `- Note: ${observation.note ?? ""}`,
                  "",
                ]
              : [
                  `- Observation: ${observation.observation}`,
                  `- Intent: ${observation.intent}`,
                  `- Technique Candidates: ${observation.techniqueCandidateIds.join(", ")}`,
                  `- Confidence: ${observation.confidence}`,
                  `- Validation: ${observation.validation}`,
                  "",
                ],
          ),
      ]),
    ]
  })
  return [
    `# ${project.name}`,
    "",
    `- Genre: ${project.genre}`,
    `- Project ID: ${project.id}`,
    "",
    ...songLines,
    "## Analysis Workspace Data",
    "",
    "```analysis-workspace-json",
    JSON.stringify(subset, null, 2),
    "```",
    "",
  ].join("\n")
}

export function importProjectMarkdown(workspace, markdown) {
  const match = /```analysis-workspace-json\s*([\s\S]*?)```/.exec(markdown)
  if (!match) throw new Error("Markdown has no analysis-workspace-json block")
  const imported = JSON.parse(match[1])
  const validation = validateWorkspace(imported)
  if (!validation.valid) {
    throw new Error(`Invalid imported workspace: ${validation.errors.join("; ")}`)
  }
  const merge = (current, incoming) => {
    const map = new Map(current.map((item) => [item.id, item]))
    for (const item of incoming) map.set(item.id, item)
    return [...map.values()]
  }
  const result = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    projects: merge(workspace.projects, imported.projects),
    songs: merge(workspace.songs, imported.songs),
    sections: merge(workspace.sections, imported.sections),
    observationDefinitions: merge(
      workspace.observationDefinitions ?? [],
      imported.observationDefinitions ?? [],
    ),
    observations: merge(workspace.observations, imported.observations),
    techniques: merge(workspace.techniques, imported.techniques),
  }
  const mergedValidation = validateWorkspace(result)
  if (!mergedValidation.valid) {
    throw new Error(`Imported data conflicts with workspace: ${mergedValidation.errors.join("; ")}`)
  }
  return result
}

export function dashboardHtml(summary, drafts = []) {
  const cells = [
    ["Projects", summary.projectCount],
    ["Songs", summary.songCount],
    ["Techniques", summary.techniqueCount],
    ["Draft", summary.draftCount],
    ["Validated", summary.validatedCount],
    ["Canonical", summary.canonicalCount],
    ["Evidence", summary.evidenceCount],
    ["Observation Terms", summary.observationDefinitionCount],
    ["Observation Instances", summary.observationInstanceCount],
  ]
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
  return `<!doctype html>
<html lang="ja"><meta charset="utf-8"><title>Analysis Dashboard</title>
<style>body{font:15px system-ui;margin:32px;background:#111827;color:#f9fafb}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}.card{padding:18px;background:#1f2937;border-radius:12px}.value{font-size:28px;font-weight:700}table{width:100%;margin-top:24px;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #374151}</style>
<h1>${escape(summary.genre)} Analysis Dashboard</h1>
<div class="grid">${cells.map(([label, value]) => `<div class="card"><div>${label}</div><div class="value">${value}</div></div>`).join("")}</div>
<h2>Draft Techniques</h2><table><thead><tr><th>ID</th><th>Name</th><th>Genre</th><th>Confidence</th></tr></thead><tbody>
${drafts.map((item) => `<tr><td>${escape(item.id)}</td><td>${escape(item.name)}</td><td>${escape(item.genreSources[0]?.name ?? "")}</td><td>${item.confidence.toFixed(2)}</td></tr>`).join("")}
</tbody></table></html>`
}

export function statusRank(status) {
  return STATUS_RANK[status] ?? -2
}
