import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { emptyWorkspace, validateWorkspace } from "./core.mjs"

export const DEFAULT_WORKSPACE_PATH = resolve(
  "reference-data/analysis-workspace/workspace.json",
)

export async function loadWorkspace(path = DEFAULT_WORKSPACE_PATH) {
  try {
    const workspace = JSON.parse(await readFile(path, "utf8"))
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
  const validation = validateWorkspace(workspace)
  if (!validation.valid) {
    throw new Error(`Refusing to save invalid workspace: ${validation.errors.join("; ")}`)
  }
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8")
  await rename(temporaryPath, path)
}

export async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}
