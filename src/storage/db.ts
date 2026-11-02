import { openDB, type DBSchema, type IDBPDatabase } from "idb"
import type { ComposerProject } from "@/core/project"

const DB_NAME = "composer-arranger"
const DB_VERSION = 2

export const PROJECT_STORE = "projects"
export const META_STORE = "meta"
export const CLOUD_OUTBOX_STORE = "cloudOutbox"

interface ArrangerDB extends DBSchema {
  projects: {
    key: string
    value: ComposerProject & { savedAt: string }
  }
  meta: {
    key: string
    value: string
  }
  cloudOutbox: {
    key: string
    value: import("./cloudOutbox").PendingCloudOperation
  }
}

let dbPromise: Promise<IDBPDatabase<ArrangerDB>> | null = null

export function getDb(): Promise<IDBPDatabase<ArrangerDB>> {
  dbPromise ??= new Promise<IDBPDatabase<ArrangerDB>>((resolve, reject) => {
    let abandoned = false
    const opening = openDB<ArrangerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore(PROJECT_STORE, { keyPath: "projectId" })
          db.createObjectStore(META_STORE)
        }
        if (oldVersion < 2) db.createObjectStore(CLOUD_OUTBOX_STORE)
      },
      blocked() {
        abandoned = true
        const error = new Error("ほかのタブでこのアプリを開いている場合は、そのタブを閉じてから再試行してください。")
        error.name = "StorageDatabaseBlockedError"
        reject(error)
      },
      blocking() {
        const previous = dbPromise
        dbPromise = null
        void previous?.then((db) => db.close()).catch(() => undefined)
      },
    })
    void opening.then((db) => { if (abandoned) db.close(); else resolve(db) }, reject)
  }).catch((error: unknown) => {
    // 一時的な起動失敗を永久にキャッシュしない。既存DBは削除しない。
    dbPromise = null
    throw error
  })
  return dbPromise
}
