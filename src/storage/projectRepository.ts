import type { ComposerProject } from "@/core/project"
import { duplicateProjectData, nextLastOpenedAfterDelete } from "@/core/projectBrowser"
import { getDb, PROJECT_STORE, META_STORE } from "./db"
import {
  deleteProjectRemote,
  mergeProjectCollections,
  scheduleProjectPush,
  shouldResetLocalForOwner,
  syncPullAndReconcile,
  type StoredComposerProject,
} from "@/features/sync/projectSync"

const LAST_OPENED_KEY = "lastOpenedProjectId"
const CLOUD_OWNER_KEY = "cloudSyncOwnerId"

interface PendingCloudDeletion {
  projectId: string
  deletedAt: string
}

function pendingDeletionKey(ownerId: string): string {
  return `cloudPendingDeletions:${ownerId}`
}

async function readPendingDeletions(
  ownerId: string,
): Promise<PendingCloudDeletion[]> {
  const db = await getDb()
  const raw = await db.get(META_STORE, pendingDeletionKey(ownerId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as PendingCloudDeletion[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writePendingDeletions(
  ownerId: string,
  pending: PendingCloudDeletion[],
): Promise<void> {
  const db = await getDb()
  const key = pendingDeletionKey(ownerId)
  if (pending.length === 0) await db.delete(META_STORE, key)
  else await db.put(META_STORE, JSON.stringify(pending), key)
}

async function queueCloudDeletion(
  ownerId: string,
  projectId: string,
): Promise<PendingCloudDeletion> {
  const pending = await readPendingDeletions(ownerId)
  const existing = pending.find((item) => item.projectId === projectId)
  if (existing) return existing
  const deletion = { projectId, deletedAt: new Date().toISOString() }
  await writePendingDeletions(ownerId, [...pending, deletion])
  return deletion
}

async function flushCloudDeletion(
  ownerId: string,
  deletion: PendingCloudDeletion,
): Promise<void> {
  await deleteProjectRemote(deletion.projectId, deletion.deletedAt)
  const pending = await readPendingDeletions(ownerId)
  await writePendingDeletions(
    ownerId,
    pending.filter((item) => item.projectId !== deletion.projectId),
  )
}

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
  const cloudOwnerId = await db.get(META_STORE, CLOUD_OWNER_KEY)
  if (cloudOwnerId) {
    const deletion = await queueCloudDeletion(cloudOwnerId, projectId)
    void flushCloudDeletion(cloudOwnerId, deletion).catch(() => undefined)
  }
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
  deletedProjectIds: ReadonlySet<string>,
): Promise<void> {
  const db = await getDb()
  const transaction = db.transaction(PROJECT_STORE, "readwrite")
  // 同期中にも編集を続けられるよう、同期開始後に保存されたローカル版を
  // savedAtで再統合する。Cloud tombstoneだけは復活させない。
  const liveLocalProjects = (await transaction.store.getAll()).filter(
    (project) => !deletedProjectIds.has(project.projectId),
  )
  const latestProjects = mergeProjectCollections(projects, liveLocalProjects)
  await transaction.store.clear()
  await Promise.all(
    latestProjects.map((project) => transaction.store.put(project)),
  )
  await transaction.done
}

/** AuthGateから呼ばれる、全保存projectの端末間同期。 */
export async function syncProjectsFromCloud(ownerId: string): Promise<void> {
  const db = await getDb()
  const previousOwnerId =
    (await db.get(META_STORE, CLOUD_OWNER_KEY)) ?? null
  if (shouldResetLocalForOwner(previousOwnerId, ownerId)) {
    const transaction = db.transaction(
      [PROJECT_STORE, META_STORE],
      "readwrite",
    )
    await transaction.objectStore(PROJECT_STORE).clear()
    await transaction.objectStore(META_STORE).delete(LAST_OPENED_KEY)
    await transaction.done
  }
  await db.put(META_STORE, ownerId, CLOUD_OWNER_KEY)

  const pending = await readPendingDeletions(ownerId)
  for (const deletion of pending) {
    try {
      await flushCloudDeletion(ownerId, deletion)
    } catch {
      // Cloudが復旧するまでpending tombstoneを維持し、pullでも復活させない。
    }
  }
  const remainingDeletedIds = (await readPendingDeletions(ownerId)).map(
    (item) => item.projectId,
  )
  await syncPullAndReconcile({
    listLocal: listProjects,
    replaceLocal: replaceAllLocalProjects,
  }, remainingDeletedIds)
}
