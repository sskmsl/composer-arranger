import type { ComposerProject } from "@/core/project"
import { supabase } from "@/lib/supabase"

const PROJECTS_TABLE = "arranger_projects"
const UPSERT_PROJECT_RPC = "upsert_arranger_project"
const PUSH_DELAY_MS = 800

export type StoredComposerProject = ComposerProject & { savedAt: string }

interface ProjectSyncAdapter {
  listLocal(): Promise<StoredComposerProject[]>
  replaceLocal(projects: StoredComposerProject[]): Promise<void>
}

export interface RemoteProjectRow {
  id: string
  data: StoredComposerProject | null
  deleted_at: string | null
}

const pendingPushes = new Map<string, ReturnType<typeof setTimeout>>()

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
  if (error) throw error
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
  if (error) throw error
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
  const [{ data: remoteRows, error }, localProjects] = await Promise.all([
    supabase.from(PROJECTS_TABLE).select("id,data,deleted_at"),
    adapter.listLocal(),
  ])
  if (error) throw error

  const projects = reconcileProjectRows(
    localProjects,
    (remoteRows ?? []) as RemoteProjectRow[],
    locallyDeletedIds,
  )
  await adapter.replaceLocal(projects)
  await Promise.all(projects.map(pushProject))
  return projects
}

export function isCloudSyncConfigured(): boolean {
  return supabase !== null
}
