import {
  OBSERVATION_SEED_COUNT,
  createObservationSeed,
} from "./observation-seed.mjs"

export const OBSERVATION_CATEGORIES = [
  "arrangement",
  "density",
  "register",
  "harmony",
  "melody",
  "phrase",
  "rhythm",
  "groove",
  "dynamics",
  "timbre",
  "texture",
  "stereo",
  "space",
  "reverb",
  "delay",
  "automation",
  "transition",
  "instrumentation",
  "articulation",
  "silence",
]

export const OBSERVATION_VALUE_TYPES = [
  "boolean",
  "number",
  "range",
  "enum",
  "text",
]

export const OBSERVATION_STATUSES = [
  "draft",
  "active",
  "deprecated",
  "merged",
]

export const OBSERVATION_VALIDATION_STATUSES = ["draft", "validated"]

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

function normalizeTerm(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
    .trim()
}

function bigrams(value) {
  const normalized = normalizeTerm(value).replace(/\s+/g, "")
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

function nextId(items, prefix) {
  const expression = new RegExp(`^${prefix}-(\\d+)$`)
  const maximum = items.reduce((max, item) => {
    const match = expression.exec(item.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}-${String(maximum + 1).padStart(4, "0")}`
}

function findDefinition(workspace, observationId) {
  const definition = workspace.observationDefinitions.find(
    (item) => item.id === observationId,
  )
  if (!definition) {
    throw new Error(`Observation Definition not found: ${observationId}`)
  }
  return definition
}

function replaceDefinition(definitions, replacement) {
  return definitions.map((item) =>
    item.id === replacement.id ? replacement : item,
  )
}

function validateCategory(category) {
  const normalized = requireText(category, "category").toLowerCase()
  if (!OBSERVATION_CATEGORIES.includes(normalized)) {
    throw new Error(`Unsupported Observation category: ${category}`)
  }
  return normalized
}

function validateValueType(valueType) {
  const normalized = requireText(valueType, "value type").toLowerCase()
  if (!OBSERVATION_VALUE_TYPES.includes(normalized)) {
    throw new Error(`Unsupported Observation value type: ${valueType}`)
  }
  return normalized
}

function validateStatus(status) {
  const normalized = requireText(status, "status").toLowerCase()
  if (!OBSERVATION_STATUSES.includes(normalized)) {
    throw new Error(`Unsupported Observation status: ${status}`)
  }
  return normalized
}

export function ensureObservationWorkspace(workspace, includeSeed = true) {
  const normalized = clone(workspace)
  if (!Array.isArray(normalized.observationDefinitions)) {
    normalized.observationDefinitions = includeSeed
      ? createObservationSeed()
      : []
  }
  return normalized
}

export function searchObservationDefinitions(
  workspace,
  query,
  options = {},
) {
  const normalizedWorkspace = ensureObservationWorkspace(workspace)
  const normalizedQuery = normalizeTerm(query ?? "")
  const queryBigrams = bigrams(normalizedQuery)
  const limit = Number(options.limit ?? 10)
  return normalizedWorkspace.observationDefinitions
    .filter(
      (definition) =>
        !options.category ||
        definition.category === String(options.category).toLowerCase(),
    )
    .filter(
      (definition) =>
        !options.status ||
        definition.status === String(options.status).toLowerCase(),
    )
    .map((definition) => {
      const fields = [
        definition.id,
        definition.canonicalName,
        ...definition.aliases,
        definition.description,
        definition.category,
        definition.status,
      ].map(normalizeTerm)
      const contains = normalizedQuery
        ? fields.some((field) => field.includes(normalizedQuery))
        : true
      const similarity = normalizedQuery
        ? Math.max(
            ...fields.map((field) =>
              Math.max(
                field.includes(normalizedQuery) ||
                  normalizedQuery.includes(field)
                  ? 0.8
                  : 0,
                jaccard(queryBigrams, bigrams(field)),
              ),
            ),
          )
        : 1
      return {
        definition: clone(definition),
        score: contains ? Math.max(0.9, similarity) : similarity,
      }
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.definition.id.localeCompare(right.definition.id),
    )
    .slice(0, limit)
}

function findNameConflicts(workspace, input, excludedId = null) {
  const terms = [
    input.canonicalName,
    ...(input.aliases ?? []),
  ].map(normalizeTerm)
  return workspace.observationDefinitions.filter((definition) => {
    if (definition.id === excludedId) return false
    const existing = [
      definition.canonicalName,
      ...definition.aliases,
    ].map(normalizeTerm)
    return terms.some((term) => existing.includes(term))
  })
}

export function createObservationDefinition(workspace, input, clock) {
  const normalizedWorkspace = ensureObservationWorkspace(workspace)
  const canonicalName = requireText(input.canonicalName, "canonical name")
  const aliases = [
    ...new Set(
      (input.aliases ?? [])
        .map((alias) => requireText(alias, "alias"))
        .filter(
          (alias) => normalizeTerm(alias) !== normalizeTerm(canonicalName),
        ),
    ),
  ]
  const valueType = validateValueType(input.valueType)
  const allowedValues = input.allowedValues
    ? [...new Set(input.allowedValues.map((value) => requireText(value, "allowed value")))]
    : undefined
  if (valueType === "enum" && (!allowedValues || allowedValues.length === 0)) {
    throw new Error("enum Observation requires allowedValues")
  }
  if (valueType !== "enum" && allowedValues) {
    throw new Error("allowedValues can only be used with enum Observations")
  }
  const exactConflicts = findNameConflicts(normalizedWorkspace, {
    canonicalName,
    aliases,
  })
  if (exactConflicts.length > 0) {
    throw new Error(
      `Observation name or alias already exists: ${exactConflicts.map((item) => item.id).join(", ")}`,
    )
  }
  const createdAt = nowIso(clock)
  const definition = {
    id: nextId(normalizedWorkspace.observationDefinitions, "OBS"),
    canonicalName,
    description: requireText(input.description, "description"),
    category: validateCategory(input.category),
    aliases,
    valueType,
    ...(input.unit ? { unit: requireText(input.unit, "unit") } : {}),
    ...(allowedValues ? { allowedValues } : {}),
    ...(input.parentObservationId
      ? { parentObservationId: requireText(input.parentObservationId, "parent Observation ID") }
      : {}),
    relatedObservationIds: [...new Set(input.relatedObservationIds ?? [])],
    oppositeObservationIds: [...new Set(input.oppositeObservationIds ?? [])],
    status: "draft",
    createdAt,
    updatedAt: createdAt,
  }
  const candidateQuery = [
    definition.canonicalName,
    ...definition.aliases,
  ].join(" ")
  const duplicateCandidates = searchObservationDefinitions(
    normalizedWorkspace,
    candidateQuery,
    { limit: 5 },
  ).filter((candidate) => candidate.score >= 0.3)
  const result = {
    ...normalizedWorkspace,
    observationDefinitions: [
      ...normalizedWorkspace.observationDefinitions,
      definition,
    ],
  }
  const validation = validateObservationDictionary(result)
  if (!validation.valid) {
    throw new Error(validation.errors.join("; "))
  }
  return {
    workspace: result,
    definition,
    duplicateCandidates,
  }
}

export function setObservationDefinitionStatus(workspace, input, clock) {
  const normalizedWorkspace = ensureObservationWorkspace(workspace)
  const definition = clone(
    findDefinition(normalizedWorkspace, input.observationId),
  )
  const status = validateStatus(input.status)
  if (status === "merged") {
    const mergedIntoObservationId = requireText(
      input.mergedIntoObservationId,
      "merged target",
    )
    if (mergedIntoObservationId === definition.id) {
      throw new Error("Observation cannot be merged into itself")
    }
    findDefinition(normalizedWorkspace, mergedIntoObservationId)
    definition.mergedIntoObservationId = mergedIntoObservationId
  } else {
    delete definition.mergedIntoObservationId
  }
  definition.status = status
  definition.updatedAt = nowIso(clock)
  const result = {
    ...normalizedWorkspace,
    observationDefinitions: replaceDefinition(
      normalizedWorkspace.observationDefinitions,
      definition,
    ),
  }
  const validation = validateObservationDictionary(result)
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join("; "))
  }
  return { workspace: result, definition }
}

export function resolveObservationDefinition(workspace, observationId) {
  const normalizedWorkspace = ensureObservationWorkspace(workspace)
  const visited = new Set()
  const path = []
  let definition = findDefinition(normalizedWorkspace, observationId)
  while (definition.status === "merged") {
    if (visited.has(definition.id)) {
      throw new Error(`Circular merged Observation reference: ${path.join(" -> ")}`)
    }
    visited.add(definition.id)
    path.push(definition.id)
    if (!definition.mergedIntoObservationId) {
      throw new Error(`Merged Observation ${definition.id} has no target`)
    }
    definition = findDefinition(
      normalizedWorkspace,
      definition.mergedIntoObservationId,
    )
  }
  return { definition: clone(definition), resolutionPath: path }
}

export function validateObservationValue(definition, value, unit) {
  const errors = []
  if (value !== undefined) {
    if (definition.valueType === "boolean" && typeof value !== "boolean") {
      errors.push("value must be boolean")
    } else if (
      definition.valueType === "number" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      errors.push("value must be a finite number")
    } else if (
      definition.valueType === "range" &&
      (!Array.isArray(value) ||
        value.length !== 2 ||
        value.some((item) => typeof item !== "number" || !Number.isFinite(item)) ||
        value[0] > value[1])
    ) {
      errors.push("value must be an ascending [number, number] range")
    } else if (
      definition.valueType === "enum" &&
      (typeof value !== "string" ||
        !definition.allowedValues?.includes(value))
    ) {
      errors.push(
        `value must be one of: ${(definition.allowedValues ?? []).join(", ")}`,
      )
    } else if (
      definition.valueType === "text" &&
      (typeof value !== "string" || value.trim().length === 0)
    ) {
      errors.push("value must be non-empty text")
    }
  }
  if (unit && !definition.unit) {
    errors.push("unit is not defined for this Observation")
  } else if (
    value !== undefined &&
    definition.unit &&
    unit !== definition.unit
  ) {
    errors.push(`unit must be ${definition.unit}`)
  }
  return { valid: errors.length === 0, errors }
}

export function createObservationInstance(workspace, input, clock) {
  const normalizedWorkspace = ensureObservationWorkspace(workspace)
  const section = normalizedWorkspace.sections.find(
    (item) => item.id === input.sectionId,
  )
  if (!section) throw new Error(`Section not found: ${input.sectionId}`)
  const song = normalizedWorkspace.songs.find(
    (item) => item.id === section.songId,
  )
  if (!song) throw new Error(`Song not found: ${section.songId}`)
  const resolved = resolveObservationDefinition(
    normalizedWorkspace,
    input.observationId,
  )
  const definition = resolved.definition
  const validationStatus = String(
    input.validationStatus ?? "draft",
  ).toLowerCase()
  if (!OBSERVATION_VALIDATION_STATUSES.includes(validationStatus)) {
    throw new Error("Validation status must be draft or validated")
  }
  const confidence = Number(input.confidence ?? 0.5)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("confidence must be between 0 and 1")
  }
  const valueValidation = validateObservationValue(
    definition,
    input.value,
    input.unit,
  )
  if (!valueValidation.valid) {
    throw new Error(valueValidation.errors.join("; "))
  }
  const createdAt = nowIso(clock)
  const instance = {
    id: nextId(normalizedWorkspace.observations, "OBSERVATION"),
    kind: "dictionary-instance",
    observationId: definition.id,
    songId: song.id,
    sectionId: section.id,
    ...(input.evidenceId
      ? { evidenceId: requireText(input.evidenceId, "Evidence ID") }
      : {}),
    ...(input.value !== undefined ? { value: clone(input.value) } : {}),
    ...(input.unit ? { unit: requireText(input.unit, "unit") } : {}),
    confidence,
    validationStatus,
    ...(input.note ? { note: String(input.note).trim() } : {}),
    createdAt,
    updatedAt: createdAt,
  }
  const warnings = []
  if (resolved.resolutionPath.length > 0) {
    warnings.push(
      `Merged Observation resolved: ${resolved.resolutionPath.join(" -> ")} -> ${definition.id}`,
    )
  }
  if (definition.status === "deprecated") {
    warnings.push(`Deprecated Observation used: ${definition.id}`)
  }
  if (definition.status === "draft") {
    warnings.push(`Draft Observation used: ${definition.id}`)
  }
  return {
    workspace: {
      ...normalizedWorkspace,
      observations: [...normalizedWorkspace.observations, instance],
    },
    instance,
    warnings,
  }
}

export function validateObservationDictionary(workspace) {
  const normalizedWorkspace = ensureObservationWorkspace(workspace, false)
  const definitions = normalizedWorkspace.observationDefinitions
  const errors = []
  const warnings = []
  const ids = new Set()
  const names = new Map()
  const definitionObjects = definitions.filter(
    (definition) => definition && typeof definition === "object",
  )
  if (definitionObjects.length !== definitions.length) {
    errors.push("Observation Definition must be an object")
  }
  for (const definition of definitionObjects) {
    if (!/^OBS-\d{4,}$/.test(definition.id)) {
      errors.push(`Invalid Observation ID: ${definition.id}`)
    }
    if (ids.has(definition.id)) {
      errors.push(`Duplicate Observation ID: ${definition.id}`)
    }
    ids.add(definition.id)
    if (!OBSERVATION_CATEGORIES.includes(definition.category)) {
      errors.push(`Invalid Observation category: ${definition.id}`)
    }
    if (!OBSERVATION_VALUE_TYPES.includes(definition.valueType)) {
      errors.push(`Invalid Observation value type: ${definition.id}`)
    }
    if (!OBSERVATION_STATUSES.includes(definition.status)) {
      errors.push(`Invalid Observation status: ${definition.id}`)
    }
    if (
      definition.valueType === "enum" &&
      (!Array.isArray(definition.allowedValues) ||
        definition.allowedValues.length === 0)
    ) {
      errors.push(`Enum Observation has no allowedValues: ${definition.id}`)
    }
    const localNames = new Set()
    for (const label of [
      definition.canonicalName,
      ...(definition.aliases ?? []),
    ]) {
      const normalized = normalizeTerm(label)
      if (localNames.has(normalized)) {
        errors.push(`Duplicate name or alias within ${definition.id}: ${label}`)
      }
      localNames.add(normalized)
      const existing = names.get(normalized)
      if (existing && existing !== definition.id) {
        errors.push(`Duplicate Observation name or alias: ${label}`)
      } else {
        names.set(normalized, definition.id)
      }
    }
  }
  const evidenceIds = new Set(
    (normalizedWorkspace.techniques ?? []).flatMap((technique) =>
      (technique.evidence ?? []).map((evidence) => evidence.id),
    ),
  )
  const references = [
    ["parentObservationId", false],
    ["relatedObservationIds", true],
    ["oppositeObservationIds", true],
  ]
  for (const definition of definitionObjects) {
    for (const [field, multiple] of references) {
      const values = multiple
        ? definition[field] ?? []
        : definition[field]
          ? [definition[field]]
          : []
      for (const target of values) {
        if (!ids.has(target)) {
          errors.push(`${definition.id} has invalid ${field}: ${target}`)
        }
      }
    }
    if (definition.status === "merged") {
      if (
        !definition.mergedIntoObservationId ||
        !ids.has(definition.mergedIntoObservationId)
      ) {
        errors.push(`Merged Observation ${definition.id} has invalid target`)
      }
    }
  }
  const visiting = new Set()
  const visited = new Set()
  const visitParent = (definition) => {
    if (visiting.has(definition.id)) {
      errors.push(`Circular parent Observation reference: ${definition.id}`)
      return
    }
    if (visited.has(definition.id)) return
    visiting.add(definition.id)
    if (definition.parentObservationId) {
      const parent = definitionObjects.find(
        (item) => item.id === definition.parentObservationId,
      )
      if (parent) visitParent(parent)
    }
    visiting.delete(definition.id)
    visited.add(definition.id)
  }
  for (const definition of definitionObjects) visitParent(definition)
  for (const definition of definitionObjects) {
    if (definition.status !== "merged") continue
    try {
      resolveObservationDefinition(normalizedWorkspace, definition.id)
    } catch (error) {
      errors.push(error.message)
    }
  }

  for (const instance of normalizedWorkspace.observations ?? []) {
    if (instance.kind !== "dictionary-instance") continue
    const definition = definitionObjects.find(
      (item) => item.id === instance.observationId,
    )
    if (!definition) {
      errors.push(`${instance.id} has invalid Observation ID`)
      continue
    }
    const valueValidation = validateObservationValue(
      definition,
      instance.value,
      instance.unit,
    )
    errors.push(
      ...valueValidation.errors.map(
        (message) => `${instance.id}: ${message}`,
      ),
    )
    if (
      !Number.isFinite(instance.confidence) ||
      instance.confidence < 0 ||
      instance.confidence > 1
    ) {
      errors.push(`${instance.id} has invalid confidence`)
    }
    if (
      !OBSERVATION_VALIDATION_STATUSES.includes(
        instance.validationStatus,
      )
    ) {
      errors.push(`${instance.id} has invalid validationStatus`)
    }
    if (instance.evidenceId && !evidenceIds.has(instance.evidenceId)) {
      errors.push(`${instance.id} has invalid evidenceId`)
    }
    if (definition.status === "deprecated") {
      warnings.push(`${instance.id} references deprecated ${definition.id}`)
    }
    if (definition.status === "merged") {
      warnings.push(`${instance.id} references merged ${definition.id}`)
    }
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  }
}

export function exportObservationDefinitionMarkdown(workspace, observationId) {
  const normalizedWorkspace = ensureObservationWorkspace(workspace)
  const definition = findDefinition(normalizedWorkspace, observationId)
  const lines = [
    "---",
    `id: ${definition.id}`,
    `canonicalName: ${JSON.stringify(definition.canonicalName)}`,
    `description: ${JSON.stringify(definition.description)}`,
    `category: ${definition.category}`,
    ...(definition.aliases.length > 0
      ? [
          "aliases:",
          ...definition.aliases.map(
            (alias) => `  - ${JSON.stringify(alias)}`,
          ),
        ]
      : ["aliases: []"]),
    `valueType: ${definition.valueType}`,
    ...(definition.unit ? [`unit: ${JSON.stringify(definition.unit)}`] : []),
    ...(definition.allowedValues
      ? [
          "allowedValues:",
          ...definition.allowedValues.map(
            (value) => `  - ${JSON.stringify(value)}`,
          ),
        ]
      : []),
    ...(definition.parentObservationId
      ? [`parentObservationId: ${definition.parentObservationId}`]
      : []),
    ...(definition.relatedObservationIds.length > 0
      ? [
          "relatedObservationIds:",
          ...definition.relatedObservationIds.map(
            (id) => `  - ${id}`,
          ),
        ]
      : ["relatedObservationIds: []"]),
    ...(definition.oppositeObservationIds.length > 0
      ? [
          "oppositeObservationIds:",
          ...definition.oppositeObservationIds.map(
            (id) => `  - ${id}`,
          ),
        ]
      : ["oppositeObservationIds: []"]),
    `status: ${definition.status}`,
    ...(definition.mergedIntoObservationId
      ? [`mergedIntoObservationId: ${definition.mergedIntoObservationId}`]
      : []),
    `createdAt: ${definition.createdAt}`,
    `updatedAt: ${definition.updatedAt}`,
    "---",
    "",
    `# ${definition.canonicalName}`,
    "",
    definition.description,
    "",
    "```observation-definition-json",
    JSON.stringify(definition, null, 2),
    "```",
    "",
  ]
  return lines.join("\n")
}

function parseFrontMatterScalar(value) {
  const trimmed = value.trim()
  if (trimmed === "[]") return []
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return JSON.parse(trimmed)
  }
  return trimmed
}

function parseObservationDefinitionFrontMatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  if (!match) {
    throw new Error("Markdown has no Observation Definition front matter")
  }
  const result = {}
  let activeArray = null
  for (const rawLine of match[1].split(/\r?\n/)) {
    const arrayMatch = /^\s+-\s+(.+)$/.exec(rawLine)
    if (arrayMatch && activeArray) {
      result[activeArray].push(parseFrontMatterScalar(arrayMatch[1]))
      continue
    }
    const fieldMatch = /^([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/.exec(
      rawLine,
    )
    if (!fieldMatch) continue
    const [, key, rawValue = ""] = fieldMatch
    if (rawValue.trim() === "") {
      result[key] = []
      activeArray = key
    } else {
      result[key] = parseFrontMatterScalar(rawValue)
      activeArray = null
    }
  }
  return result
}

export function importObservationDefinitionMarkdown(workspace, markdown) {
  const normalizedWorkspace = ensureObservationWorkspace(workspace)
  const match = /```observation-definition-json\s*([\s\S]*?)```/.exec(
    markdown,
  )
  const definition = match
    ? JSON.parse(match[1])
    : parseObservationDefinitionFrontMatter(markdown)
  if (!/^OBS-\d{4,}$/.test(definition.id)) {
    throw new Error(`Invalid Observation ID: ${definition.id}`)
  }
  const existing = normalizedWorkspace.observationDefinitions.some(
    (item) => item.id === definition.id,
  )
  const definitions = existing
    ? replaceDefinition(
        normalizedWorkspace.observationDefinitions,
        definition,
      )
    : [...normalizedWorkspace.observationDefinitions, definition]
  const result = {
    ...normalizedWorkspace,
    observationDefinitions: definitions,
  }
  const validation = validateObservationDictionary(result)
  if (!validation.valid) {
    throw new Error(
      `Invalid Observation Definition: ${validation.errors.join("; ")}`,
    )
  }
  return result
}

export { OBSERVATION_SEED_COUNT }
