import type { ComposerProject } from "@/core/project"
import { getDb, CLOUD_OUTBOX_STORE } from "./db"

export interface PendingCloudSave {
  ownerId: string
  revision: string
  project: ComposerProject & { savedAt: string }
}
const prefix = (ownerId: string) => `cloudPendingSave:${encodeURIComponent(ownerId)}:`
export const cloudSaveKey = (ownerId: string, projectId: string) => prefix(ownerId) + encodeURIComponent(projectId)
export const pendingCloudSave = (ownerId: string, project: PendingCloudSave["project"]): PendingCloudSave => ({ ownerId, project, revision: crypto.randomUUID() })
export async function readPendingCloudSave(ownerId: string, projectId: string) {
  return (await getDb()).get(CLOUD_OUTBOX_STORE, cloudSaveKey(ownerId, projectId))
}

export async function listPendingCloudSaves(ownerId: string): Promise<PendingCloudSave[]> {
  const db = await getDb()
  const tx = db.transaction(CLOUD_OUTBOX_STORE)
  void tx.done.catch(() => undefined)
  const keys = await tx.store.getAllKeys()
  const entries = await Promise.all(keys.filter((key) => key.startsWith(prefix(ownerId))).map((key) => tx.store.get(key)))
  await tx.done
  return entries.filter((entry): entry is PendingCloudSave => Boolean(entry && entry.ownerId === ownerId))
    .sort((a, b) => a.project.savedAt.localeCompare(b.project.savedAt))
}

export async function acknowledgeCloudSave(entry: PendingCloudSave): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(CLOUD_OUTBOX_STORE, "readwrite")
  const key = cloudSaveKey(entry.ownerId, entry.project.projectId)
  try {
    const current = await tx.store.get(key)
    if (current?.revision === entry.revision) await tx.store.delete(key)
    await tx.done
  } catch (error) {
    try { tx.abort() } catch { /* already finished */ }
    await tx.done.catch(() => undefined)
    throw error
  }
}
