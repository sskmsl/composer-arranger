import type { ComposerProject } from "@/core/project"
import { getDb, CLOUD_OUTBOX_STORE } from "./db"

export interface PendingCloudSave {
  kind: "save"
  ownerId: string
  revision: string
  project: ComposerProject & { savedAt: string }
}
export interface PendingCloudDelete {
  kind: "delete"
  ownerId: string
  revision: string
  projectId: string
  deletedAt: string
}
export type PendingCloudOperation = PendingCloudSave | PendingCloudDelete
export const cloudOperationProjectId = (entry: PendingCloudOperation) => entry.kind === "save" ? entry.project.projectId : entry.projectId
const prefix = (ownerId: string) => `cloudPendingSave:${encodeURIComponent(ownerId)}:`
export const cloudSaveKey = (ownerId: string, projectId: string) => prefix(ownerId) + encodeURIComponent(projectId)
export const pendingCloudSave = (ownerId: string, project: PendingCloudSave["project"]): PendingCloudSave => ({ kind: "save", ownerId, project, revision: crypto.randomUUID() })
export const pendingCloudDelete = (ownerId: string, projectId: string, deletedAt: string): PendingCloudDelete => ({ kind: "delete", ownerId, projectId, deletedAt, revision: crypto.randomUUID() })
export async function readPendingCloudSave(ownerId: string, projectId: string) {
  return (await getDb()).get(CLOUD_OUTBOX_STORE, cloudSaveKey(ownerId, projectId))
}

export async function listCloudOutboxEntries(ownerId: string): Promise<PendingCloudOperation[]> {
  const db = await getDb()
  const tx = db.transaction(CLOUD_OUTBOX_STORE)
  void tx.done.catch(() => undefined)
  const keys = await tx.store.getAllKeys()
  const entries = await Promise.all(keys.filter((key) => key.startsWith(prefix(ownerId))).map((key) => tx.store.get(key)))
  await tx.done
  return entries.filter((entry): entry is PendingCloudOperation => Boolean(entry && entry.ownerId === ownerId))
}
export async function listPendingCloudSaves(ownerId: string): Promise<PendingCloudSave[]> {
  return (await listCloudOutboxEntries(ownerId)).filter((entry): entry is PendingCloudSave => entry.kind === "save")
    .sort((a, b) => a.project.savedAt.localeCompare(b.project.savedAt))
}

export async function acknowledgeCloudSave(entry: PendingCloudOperation): Promise<void> {
  const db = await getDb()
  const tx = db.transaction([CLOUD_OUTBOX_STORE, "meta"], "readwrite")
  const key = cloudSaveKey(entry.ownerId, cloudOperationProjectId(entry))
  try {
    const current = await tx.objectStore(CLOUD_OUTBOX_STORE).get(key)
    if (current?.revision === entry.revision) await tx.objectStore(CLOUD_OUTBOX_STORE).delete(key)
    if (entry.kind === "delete") {
      const deletionKey = `cloudPendingDeletions:${entry.ownerId}`
      const raw = await tx.objectStore("meta").get(deletionKey)
      const remaining = (raw ? JSON.parse(raw) as Array<{ projectId: string; deletedAt: string }> : [])
        .filter(item => item.projectId !== entry.projectId || item.deletedAt !== entry.deletedAt)
      if (remaining.length) await tx.objectStore("meta").put(JSON.stringify(remaining), deletionKey)
      else await tx.objectStore("meta").delete(deletionKey)
    }
    await tx.done
  } catch (error) {
    try { tx.abort() } catch { /* already finished */ }
    await tx.done.catch(() => undefined)
    throw error
  }
}
