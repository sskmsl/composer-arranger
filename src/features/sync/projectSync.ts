import type { ComposerProject } from "@/core/project"
import { supabase } from "@/lib/supabase"

const UPSERT_PROJECT_RPC = "upsert_arranger_project"
const LIST_PROJECT_METADATA_RPC = "list_arranger_project_metadata"
const GET_PROJECT_RPC = "get_arranger_project"
const PUSH_DELAY_MS = 800
export const CLOUD_SYNC_COMPLETED_EVENT = "composer-arranger:cloud-sync-completed"

export type StoredComposerProject = ComposerProject & { savedAt: string }

interface ProjectSyncAdapter {
  listLocal(): Promise<StoredComposerProject[]>
  replaceLocal(
    projects: StoredComposerProject[],
    deletedProjectIds: ReadonlySet<string>,
  ): Promise<void>
}

export interface RemoteProjectRow {
  id: string
  data: StoredComposerProject | null
  deleted_at: string | null
  /** metadata-first pullではdata本体を取得せず、この時刻だけで転送要否を判定する。 */
  updated_at?: string
}

interface RemoteProjectMetadata {
  id: string
  updated_at: string
  deleted_at: string | null
}

const pendingPushes = new Map<string, ReturnType<typeof setTimeout>>()

function syncStageError(stage: string, reason: { message?: string }): Error {
  return new Error(`Cloud同期(${stage}): ${reason.message ?? "不明なエラー"}`)
}

async function ownerId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** 頻繁なノート編集でも通信を連打しないよう、project単位で最後の状態だけ送る。 */
export function scheduleProjectPush(project: StoredComposerProject): void {
  if (!supabase) return
  const pending = pendingPushes.get(project.projectId)
  if (pending) clearTimeout(pending)
  pendingPushes.set(
    project.projectId,
    setTimeout(() => {
      pendingPushes.delete(project.projectId)
      void pushProject(project).catch(() => undefined)
    }, PUSH_DELAY_MS),
  )
}

export async function pushProject(project: StoredComposerProject): Promise<void> {
  if (!supabase) return
  if (!(await ownerId())) return
  const { error } = await supabase.rpc(UPSERT_PROJECT_RPC, {
    p_id: project.projectId,
    p_data: project,
    p_updated_at: project.savedAt,
    p_deleted_at: null,
  })
  if (error) throw syncStageError("アップロード", error)
}

export async function deleteProjectRemote(
  projectId: string,
  deletedAt = new Date().toISOString(),
): Promise<void> {
  if (!supabase) return
  const pending = pendingPushes.get(projectId)
  if (pending) {
    clearTimeout(pending)
    pendingPushes.delete(projectId)
  }
  if (!(await ownerId())) return
  // 物理削除せずtombstoneを残し、別端末の古いIndexedDBから復活するのを防ぐ。
  const { error } = await supabase.rpc(UPSERT_PROJECT_RPC, {
    p_id: projectId,
    p_data: null,
    p_updated_at: deletedAt,
    p_deleted_at: deletedAt,
  })
  if (error) throw syncStageError("削除反映", error)
}

function newerProject(
  left: StoredComposerProject,
  right: StoredComposerProject,
): StoredComposerProject {
  return left.savedAt.localeCompare(right.savedAt) >= 0 ? left : right
}

export function mergeProjectCollections(
  localProjects: StoredComposerProject[],
  remoteProjects: StoredComposerProject[],
): StoredComposerProject[] {
  const merged = new Map<string, StoredComposerProject>()
  for (const project of localProjects) merged.set(project.projectId, project)
  for (const remote of remoteProjects) {
    const local = merged.get(remote.projectId)
    merged.set(remote.projectId, local ? newerProject(local, remote) : remote)
  }
  return [...merged.values()].sort((left, right) =>
    right.savedAt.localeCompare(left.savedAt),
  )
}

/** Cloudの削除印(tombstone)を先に適用してから、残るprojectを更新日時で統合する。 */
export function reconcileProjectRows(
  localProjects: StoredComposerProject[],
  remoteRows: RemoteProjectRow[],
  locallyDeletedIds: Iterable<string> = [],
): StoredComposerProject[] {
  const deletedIds = new Set(locallyDeletedIds)
  for (const row of remoteRows) {
    if (row.deleted_at !== null) deletedIds.add(row.id)
  }
  return mergeProjectCollections(
    localProjects.filter((project) => !deletedIds.has(project.projectId)),
    remoteRows
      .filter(
        (row): row is RemoteProjectRow & { data: StoredComposerProject } =>
          row.data !== null &&
          row.deleted_at === null &&
          !deletedIds.has(row.id),
      )
      .map((row) => row.data),
  )
}

/** Cloudと同じか新しいprojectは再送せず、大容量projectの不要な同時通信を避ける。 */
export function projectsNeedingUpload(
  localProjects: StoredComposerProject[],
  remoteRows: RemoteProjectRow[],
  locallyDeletedIds: Iterable<string> = [],
): StoredComposerProject[] {
  const deletedIds = new Set(locallyDeletedIds)
  const remoteById = new Map<string, RemoteProjectRow>()
  for (const row of remoteRows) {
    remoteById.set(row.id, row)
    if (row.deleted_at !== null) deletedIds.add(row.id)
  }
  return localProjects.filter((project) => {
    if (deletedIds.has(project.projectId)) return false
    const remote = remoteById.get(project.projectId)
    if (!remote || remote.deleted_at !== null) return true
    const remoteUpdatedAt = remote.updated_at ?? remote.data?.savedAt
    if (!remoteUpdatedAt) return true
    return project.savedAt.localeCompare(remoteUpdatedAt) > 0
  })
}

/** Cloud本体を取得する必要があるprojectだけを抽出し、大容量JSONの全件selectを避ける。 */
export function projectIdsNeedingDownload(
  localProjects: StoredComposerProject[],
  remoteRows: RemoteProjectMetadata[],
  locallyDeletedIds: Iterable<string> = [],
): string[] {
  const localById = new Map(
    localProjects.map((project) => [project.projectId, project]),
  )
  const deletedIds = new Set(locallyDeletedIds)
  return remoteRows
    .filter((row) => {
      if (row.deleted_at !== null) return false
      if (deletedIds.has(row.id)) return false
      const local = localById.get(row.id)
      return !local || row.updated_at.localeCompare(local.savedAt) > 0
    })
    .map((row) => row.id)
}

/** 初回導入時は既存ローカルprojectを採用し、別accountへの切替時だけ端末データを隔離する。 */
export function shouldResetLocalForOwner(
  previousOwnerId: string | null,
  nextOwnerId: string,
): boolean {
  return previousOwnerId !== null && previousOwnerId !== nextOwnerId
}

/**
 * ログイン時に端末とCloudを突き合わせる。同一IDは更新日時が新しい方を採用し、
 * 片側にしかないprojectは失わない。結果を両側へ戻すため端末変更も収束する。
 */
export async function syncPullAndReconcile(
  adapter: ProjectSyncAdapter,
  locallyDeletedIds: Iterable<string> = [],
): Promise<StoredComposerProject[]> {
  if (!supabase) return adapter.listLocal()
  const [{ data: remoteMetadata, error }, localProjects] = await Promise.all([
    // 専用RPCはmetadataだけを返し、一般authenticated roleより長い同期専用timeoutを持つ。
    supabase.rpc(LIST_PROJECT_METADATA_RPC),
    adapter.listLocal(),
  ])
  if (error) throw syncStageError("一覧取得", error)

  const metadata = (remoteMetadata ?? []) as RemoteProjectMetadata[]
  const downloadIds = projectIdsNeedingDownload(
    localProjects,
    metadata,
    locallyDeletedIds,
  )
  const downloadedById = new Map<string, StoredComposerProject>()
  // 大容量projectを同時取得せず、必要な最新版だけを順次取得する。
  for (const id of downloadIds) {
    const { data: remote, error: downloadError } = await supabase.rpc(
      GET_PROJECT_RPC,
      { p_id: id },
    )
    if (downloadError) throw syncStageError("ダウンロード", downloadError)
    const project = remote as StoredComposerProject | null | undefined
    if (project) downloadedById.set(id, project)
  }
  const rows: RemoteProjectRow[] = metadata.map((row) => ({
    ...row,
    data: downloadedById.get(row.id) ?? null,
  }))
  const projects = reconcileProjectRows(
    localProjects,
    rows,
    locallyDeletedIds,
  )
  const uploadProjects = projectsNeedingUpload(
    localProjects,
    rows,
    locallyDeletedIds,
  )
  const deletedProjectIds = new Set(locallyDeletedIds)
  for (const row of metadata) {
    if (row.deleted_at !== null) deletedProjectIds.add(row.id)
  }
  await adapter.replaceLocal(projects, deletedProjectIds)
  // 大きいprojectを並列送信するとブラウザ/Supabase側で一時失敗しやすいため順次送る。
  for (const project of uploadProjects) await pushProject(project)
  return projects
}

export function isCloudSyncConfigured(): boolean {
  return supabase !== null
}
