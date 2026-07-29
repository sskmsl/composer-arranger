import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { emptyWorkspace, validateWorkspace } from "./core.mjs"
import { ensureObservationWorkspace } from "./observation-dictionary.mjs"

export const DEFAULT_WORKSPACE_PATH = resolve(
  "reference-data/analysis-workspace/workspace.json",
)

export async function loadWorkspace(path = DEFAULT_WORKSPACE_PATH) {
  try {
    const workspace = ensureObservationWorkspace(
      JSON.parse(await readFile(path, "utf8")),
    )
    const validation = validateWorkspace(workspace)
    if (!validation.valid) {
      throw new Error(`Invalid workspace: ${validation.errors.join("; ")}`)
    }
    return workspace
  } catch (error) {
    if (error?.code === "ENOENT") return emptyWorkspace()
    throw error
  }
}

export async function saveWorkspace(path, workspace) {
  const normalizedWorkspace = ensureObservationWorkspace(workspace)
  const validation = validateWorkspace(normalizedWorkspace)
  if (!validation.valid) {
    throw new Error(`Refusing to save invalid workspace: ${validation.errors.join("; ")}`)
  }
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  await writeFile(
    temporaryPath,
    `${JSON.stringify(normalizedWorkspace, null, 2)}\n`,
    "utf8",
  )
  await rename(temporaryPath, path)
}

export async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

export async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

export async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  await writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  )
  await rename(temporaryPath, path)
}
