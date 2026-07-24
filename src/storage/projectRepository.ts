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

/**
 * Issue #16: 時間単位の自動変換/確認待ちが発生する直前の生データをそのまま退避する。
 * 変換の判定を誤っていた場合でも、ユーザーが元のデータへ戻れるようにするための安全網。
 */
export async function backupProjectTimingSnapshot(raw: unknown): Promise<void> {
  const projectId = (raw as { projectId?: string })?.projectId ?? "unknown"
  const db = await getDb()
  const key = `timingBackup:${projectId}:${Date.now()}`
  await db.put(META_STORE, JSON.stringify(raw), key)
}
