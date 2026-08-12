import type { ComposerProject } from "@/core/project"
import { duplicateProjectData, nextLastOpenedAfterDelete } from "@/core/projectBrowser"
import { getDb, PROJECT_STORE, META_STORE } from "./db"
import {
  deleteProjectRemote,
  scheduleProjectPush,
  syncPullAndReconcile,
  type StoredComposerProject,
} from "@/features/sync/projectSync"

const LAST_OPENED_KEY = "lastOpenedProjectId"

/** 17章「保存中のアプリ終了でも直前状態を復元できる」を満たすための自動保存 */
export async function saveProject(project: ComposerProject): Promise<void> {
  const db = await getDb()
  const record = { ...project, savedAt: new Date().toISOString() }
  await db.put(PROJECT_STORE, record)
  await db.put(META_STORE, project.projectId, LAST_OPENED_KEY)
  scheduleProjectPush(record)
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

/**
 * メタ情報(lastOpened)を変更せずに保存レコードだけを更新する(Rename/Duplicate/削除の復元用)。
 * 現在編集中のセッション(store.project/selectedSectionId/history等)には一切触れない。
 */
export async function putProjectRecord(project: ComposerProject): Promise<void> {
  const db = await getDb()
  const record = { ...project, savedAt: new Date().toISOString() }
  await db.put(PROJECT_STORE, record)
  scheduleProjectPush(record)
}

/**
 * Issue #14: プロジェクトを削除する。lastOpened だったレコードを消した場合は、
 * meta の lastOpened も安全に更新する(残りの先頭、無ければクリア)。
 */
export async function deleteProject(projectId: string): Promise<void> {
  const db = await getDb()
  const lastOpened = (await db.get(META_STORE, LAST_OPENED_KEY)) ?? null
  const allIds = (await db.getAllKeys(PROJECT_STORE)) as string[]
  await db.delete(PROJECT_STORE, projectId)
  void deleteProjectRemote(projectId).catch(() => undefined)
  const nextLast = nextLastOpenedAfterDelete(projectId, lastOpened, allIds)
  if (nextLast) await db.put(META_STORE, nextLast, LAST_OPENED_KEY)
  else await db.delete(META_STORE, LAST_OPENED_KEY)
}

/** Issue #14: 保存済みプロジェクトを複製する(新しいprojectId・全データ保持)。複製したプロジェクトを返す */
export async function duplicateProject(projectId: string): Promise<ComposerProject | undefined> {
  const db = await getDb()
  const record = await db.get(PROJECT_STORE, projectId)
  if (!record) return undefined
  const { savedAt: _savedAt, ...project } = record as ComposerProject & { savedAt?: string }
  const copy = duplicateProjectData(project)
  await putProjectRecord(copy)
  return copy
}

/** Issue #14: 保存済みプロジェクトのタイトルを変更する(lastOpenedは変えない)。更新後を返す */
export async function renameProject(projectId: string, title: string): Promise<ComposerProject | undefined> {
  const db = await getDb()
  const record = await db.get(PROJECT_STORE, projectId)
  if (!record) return undefined
  const { savedAt: _savedAt, ...project } = record as ComposerProject & { savedAt?: string }
  const renamed = { ...project, title }
  await putProjectRecord(renamed)
  return renamed
}

export async function getLastOpenedId(): Promise<string | null> {
  const db = await getDb()
  return (await db.get(META_STORE, LAST_OPENED_KEY)) ?? null
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

async function replaceAllLocalProjects(
  projects: StoredComposerProject[],
): Promise<void> {
  const db = await getDb()
  const transaction = db.transaction(PROJECT_STORE, "readwrite")
  await transaction.store.clear()
  await Promise.all(projects.map((project) => transaction.store.put(project)))
  await transaction.done
}

/** AuthGateから呼ばれる、全保存projectの端末間同期。 */
export async function syncProjectsFromCloud(): Promise<void> {
  await syncPullAndReconcile({
    listLocal: listProjects,
    replaceLocal: replaceAllLocalProjects,
  })
}
