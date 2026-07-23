import type { ComposerProject } from "@/core/project"
import { getDb, PROJECT_STORE, META_STORE } from "./db"

const LAST_OPENED_KEY = "lastOpenedProjectId"

/** 17章「保存中のアプリ終了でも直前状態を復元できる」を満たすための自動保存 */
export async function saveProject(project: ComposerProject): Promise<void> {
  const db = await getDb()
  await db.put(PROJECT_STORE, { ...project, savedAt: new Date().toISOString() })
  await db.put(META_STORE, project.projectId, LAST_OPENED_KEY)
}

export async function loadProject(projectId: string): Promise<ComposerProject | undefined> {
  const db = await getDb()
  return db.get(PROJECT_STORE, projectId)
}

export async function loadLastOpenedProject(): Promise<ComposerProject | undefined> {
  const db = await getDb()
  const id = await db.get(META_STORE, LAST_OPENED_KEY)
  if (!id) return undefined
  return db.get(PROJECT_STORE, id)
}

export async function listProjects(): Promise<(ComposerProject & { savedAt: string })[]> {
  const db = await getDb()
  const all = await db.getAll(PROJECT_STORE)
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await getDb()
  await db.delete(PROJECT_STORE, projectId)
}
