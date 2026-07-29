#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  addObservation,
  addSection,
  addSong,
  createProject,
  createTechnique,
  dashboard,
  dashboardHtml,
  draftTechniques,
  exportProjectMarkdown,
  importProjectMarkdown,
  linkEvidence,
  searchTechniques,
  setGenrePrinciple,
  setObservationValidation,
  transitionTechniqueStatus,
  validateWorkspace,
} from "./core.mjs"
import {
  OBSERVATION_SEED_COUNT,
  createObservationDefinition,
  createObservationInstance,
  exportObservationDefinitionMarkdown,
  importObservationDefinitionMarkdown,
  resolveObservationDefinition,
  searchObservationDefinitions,
  setObservationDefinitionStatus,
  validateObservationDictionary,
} from "./observation-dictionary.mjs"
import {
  DEFAULT_WORKSPACE_PATH,
  loadWorkspace,
  saveWorkspace,
  writeText,
} from "./storage.mjs"

const HELP = `Composer Intelligence Analysis Workspace

Usage:
  npm run analysis -- <command> [options]

Commands:
  project create       --genre <genre> --name <name>
  song add             --project <id> --title <title> --artist <artist>
                       --album <album> --year <year> [--bpm <bpm>]
                       [--key <key>] [--genre <genre>]
  section add          --song <id> --type <type> --start <seconds>
                       --end <seconds> [--label <label>]
  observation add      --section <id> --text <observation> --intent <intent>
                       [--techniques <id,id>] [--confidence <0..1>]
                       [--validation draft|validated]
  observation validate --id <id> --validation draft|validated
  observation-definition search
                       --query <text> [--category <category>]
                       [--status <status>] [--limit <number>]
  observation-definition add
                       --name <canonical name> --description <fact>
                       --category <category> --value-type <type>
                       [--aliases <name,name>] [--unit <unit>]
                       [--allowed-values <value,value>]
  observation-definition status
                       --id <OBS-id> --status draft|active|deprecated|merged
                       [--merged-into <OBS-id>]
  observation-definition resolve --id <OBS-id>
  observation-definition export --id <OBS-id> --output <path>
  observation-definition import --input <path>
  observation-definition validate
  observation-instance add
                       --section <id> --observation <OBS-id>
                       [--value <JSON>] [--unit <unit>]
                       [--confidence <0..1>]
                       [--validation draft|validated] [--note <text>]
  technique add        --name <name> --category <category>
                       --observation <text> --intent <intent>
                       --genre <genre> [--genre-source <id>]
                       [--confidence <0..1>]
  technique search     --query <text> [--limit <number>]
  technique principle  --id <id> --statement <text> [--confirmed true|false]
  evidence add         --observation <id> --technique <id> [--comment <text>]
                       [--intent-confirmed true|false]
  validate             --technique <id>
                       --status draft|validated|canonical|deprecated
                       --reason <text> --reviewer <name>
                       [--confidence <0..1>] [--reproducible true|false]
  dashboard            [--genre <genre>] [--html <path>]
  drafts               [--sort confidence|updated|genre]
  markdown export      --project <id> --output <path>
  markdown import      --input <path>
  workspace validate

Global:
  --data <path>         Workspace JSON path
                       (default: ${DEFAULT_WORKSPACE_PATH})

Real song and artist data should remain under reference-data/, which is gitignored.
`

function parseArguments(values) {
  const positional = []
  const options = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith("--")) {
      positional.push(value)
      continue
    }
    const key = value.slice(2)
    const next = values[index + 1]
    if (next === undefined || next.startsWith("--")) {
      options[key] = true
    } else {
      options[key] = next
      index += 1
    }
  }
  return { positional, options }
}

function required(options, key) {
  const value = options[key]
  if (value === undefined || value === true || String(value).trim() === "") {
    throw new Error(`--${key} is required`)
  }
  return String(value)
}

function booleanOption(value) {
  if (value === undefined) return undefined
  if (value === true || value === "true") return true
  if (value === "false") return false
  throw new Error("Boolean options accept true or false")
}

function commaList(value) {
  if (!value) return []
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function structuredValue(value) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(String(value))
  } catch {
    return String(value)
  }
}

function print(value) {
  process.stdout.write(
    typeof value === "string"
      ? `${value}\n`
      : `${JSON.stringify(value, null, 2)}\n`,
  )
}

function summaryTechnique(technique) {
  return {
    id: technique.id,
    name: technique.name,
    status: technique.status,
    confidence: technique.confidence,
  }
}

async function main() {
  const { positional, options } = parseArguments(process.argv.slice(2))
  if (positional.length === 0 || options.help || positional[0] === "help") {
    print(HELP)
    return
  }
  const dataPath = resolve(String(options.data ?? DEFAULT_WORKSPACE_PATH))
  let workspace = await loadWorkspace(dataPath)
  const [command, action] = positional
  let result
  let mutated = false

  if (command === "project" && action === "create") {
    result = createProject(workspace, {
      name: required(options, "name"),
      genre: required(options, "genre"),
    })
    workspace = result.workspace
    result = result.project
    mutated = true
  } else if (command === "song" && action === "add") {
    result = addSong(workspace, {
      projectId: required(options, "project"),
      title: required(options, "title"),
      artist: required(options, "artist"),
      album: required(options, "album"),
      year: required(options, "year"),
      bpm: options.bpm,
      key: options.key,
      genre: options.genre,
    })
    workspace = result.workspace
    result = result.song
    mutated = true
  } else if (command === "section" && action === "add") {
    result = addSection(workspace, {
      songId: required(options, "song"),
      type: required(options, "type"),
      startSeconds: required(options, "start"),
      endSeconds: required(options, "end"),
      label: options.label,
    })
    workspace = result.workspace
    result = result.section
    mutated = true
  } else if (command === "observation" && action === "add") {
    result = addObservation(workspace, {
      sectionId: required(options, "section"),
      observation: required(options, "text"),
      intent: required(options, "intent"),
      techniqueCandidateIds: options.techniques
        ? String(options.techniques).split(",").filter(Boolean)
        : [],
      confidence: options.confidence,
      validation: options.validation,
    })
    workspace = result.workspace
    result = result.observation
    mutated = true
  } else if (command === "observation" && action === "validate") {
    result = setObservationValidation(workspace, {
      observationId: required(options, "id"),
      validation: required(options, "validation"),
    })
    workspace = result.workspace
    result = result.observation
    mutated = true
  } else if (
    command === "observation-definition" &&
    action === "search"
  ) {
    result = searchObservationDefinitions(
      workspace,
      options.query ?? "",
      {
        category: options.category,
        status: options.status,
        limit: Number(options.limit ?? 10),
      },
    ).map((candidate) => ({
      id: candidate.definition.id,
      canonicalName: candidate.definition.canonicalName,
      category: candidate.definition.category,
      status: candidate.definition.status,
      score: candidate.score,
    }))
  } else if (
    command === "observation-definition" &&
    action === "add"
  ) {
    const created = createObservationDefinition(workspace, {
      canonicalName: required(options, "name"),
      description: required(options, "description"),
      category: required(options, "category"),
      valueType: required(options, "value-type"),
      aliases: commaList(options.aliases),
      unit: options.unit,
      allowedValues: options["allowed-values"]
        ? commaList(options["allowed-values"])
        : undefined,
      parentObservationId: options.parent,
      relatedObservationIds: commaList(options.related),
      oppositeObservationIds: commaList(options.opposite),
    })
    workspace = created.workspace
    result = {
      definition: created.definition,
      duplicateCandidates: created.duplicateCandidates.map(
        (candidate) => ({
          id: candidate.definition.id,
          canonicalName: candidate.definition.canonicalName,
          score: candidate.score,
        }),
      ),
    }
    mutated = true
  } else if (
    command === "observation-definition" &&
    action === "status"
  ) {
    const changed = setObservationDefinitionStatus(workspace, {
      observationId: required(options, "id"),
      status: required(options, "status"),
      mergedIntoObservationId: options["merged-into"],
    })
    workspace = changed.workspace
    result = changed.definition
    mutated = true
  } else if (
    command === "observation-definition" &&
    action === "resolve"
  ) {
    result = resolveObservationDefinition(
      workspace,
      required(options, "id"),
    )
  } else if (
    command === "observation-definition" &&
    action === "export"
  ) {
    const outputPath = resolve(required(options, "output"))
    await writeText(
      outputPath,
      exportObservationDefinitionMarkdown(
        workspace,
        required(options, "id"),
      ),
    )
    result = { output: outputPath }
  } else if (
    command === "observation-definition" &&
    action === "import"
  ) {
    const inputPath = resolve(required(options, "input"))
    workspace = importObservationDefinitionMarkdown(
      workspace,
      await readFile(inputPath, "utf8"),
    )
    result = { imported: inputPath }
    mutated = true
  } else if (
    command === "observation-definition" &&
    action === "validate"
  ) {
    result = {
      ...validateObservationDictionary(workspace),
      seedCount: OBSERVATION_SEED_COUNT,
    }
    if (!result.valid) process.exitCode = 1
  } else if (
    command === "observation-instance" &&
    action === "add"
  ) {
    const created = createObservationInstance(workspace, {
      sectionId: required(options, "section"),
      observationId: required(options, "observation"),
      value: structuredValue(options.value),
      unit: options.unit,
      confidence: options.confidence,
      validationStatus: options.validation,
      note: options.note,
      evidenceId: options.evidence,
    })
    workspace = created.workspace
    result = {
      instance: created.instance,
      warnings: created.warnings,
    }
    mutated = true
  } else if (command === "technique" && action === "add") {
    const genre = required(options, "genre")
    const created = createTechnique(workspace, {
      name: required(options, "name"),
      category: required(options, "category"),
      observation: required(options, "observation"),
      intent: required(options, "intent"),
      genre,
      genreSourceId:
        options["genre-source"] ??
        `genre-source-${genre.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
      confidence: options.confidence,
    })
    workspace = created.workspace
    result = {
      technique: summaryTechnique(created.technique),
      duplicateCandidates: created.duplicateCandidates.map((candidate) => ({
        ...summaryTechnique(candidate.technique),
        similarity: candidate.score,
      })),
    }
    mutated = true
  } else if (command === "technique" && action === "search") {
    result = searchTechniques(
      workspace,
      required(options, "query"),
      Number(options.limit ?? 10),
    ).map((candidate) => ({
      ...summaryTechnique(candidate.technique),
      similarity: candidate.score,
    }))
  } else if (command === "technique" && action === "principle") {
    const changed = setGenrePrinciple(workspace, {
      techniqueId: required(options, "id"),
      statement: required(options, "statement"),
      confirmed: booleanOption(options.confirmed) ?? false,
    })
    workspace = changed.workspace
    result = summaryTechnique(changed.technique)
    mutated = true
  } else if (command === "evidence" && action === "add") {
    const changed = linkEvidence(workspace, {
      observationId: required(options, "observation"),
      techniqueId: required(options, "technique"),
      comment: options.comment,
      intentConfirmed: booleanOption(options["intent-confirmed"]),
    })
    workspace = changed.workspace
    result = changed.evidence
    mutated = true
  } else if (command === "validate" && !action) {
    const changed = transitionTechniqueStatus(workspace, {
      techniqueId: required(options, "technique"),
      targetStatus: required(options, "status"),
      reason: required(options, "reason"),
      reviewer: required(options, "reviewer"),
      confidence: options.confidence,
      reproducibilityConfirmed: booleanOption(options.reproducible),
    })
    if (!changed.validation.eligible) {
      throw new Error(changed.validation.reasons.join("; "))
    }
    workspace = changed.workspace
    result = summaryTechnique(changed.technique)
    mutated = true
  } else if (command === "dashboard" && !action) {
    const summary = dashboard(workspace, options.genre ?? null)
    const drafts = draftTechniques(workspace).filter(
      (technique) =>
        !options.genre ||
        technique.genreSources.some(
          (source) => source.name === options.genre,
        ),
    )
    if (options.html) {
      const outputPath = resolve(String(options.html))
      await writeText(outputPath, dashboardHtml(summary, drafts))
      result = { ...summary, html: outputPath }
    } else {
      result = summary
    }
  } else if (command === "drafts" && !action) {
    result = draftTechniques(workspace, options.sort ?? "confidence").map(
      summaryTechnique,
    )
  } else if (command === "markdown" && action === "export") {
    const outputPath = resolve(required(options, "output"))
    await writeText(
      outputPath,
      exportProjectMarkdown(workspace, required(options, "project")),
    )
    result = { output: outputPath }
  } else if (command === "markdown" && action === "import") {
    const inputPath = resolve(required(options, "input"))
    workspace = importProjectMarkdown(
      workspace,
      await readFile(inputPath, "utf8"),
    )
    result = { imported: inputPath }
    mutated = true
  } else if (command === "workspace" && action === "validate") {
    result = validateWorkspace(workspace)
    if (!result.valid) process.exitCode = 1
  } else {
    throw new Error(`Unknown command: ${positional.join(" ")}\n\n${HELP}`)
  }

  if (mutated) await saveWorkspace(dataPath, workspace)
  print(result)
}

main().catch((error) => {
  process.stderr.write(`Analysis Workspace error: ${error.message}\n`)
  process.exitCode = 1
})
