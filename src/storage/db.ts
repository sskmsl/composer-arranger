import { openDB, type DBSchema, type IDBPDatabase } from "idb"
import type { ComposerProject } from "@/core/project"

const DB_NAME = "composer-arranger"
const DB_VERSION = 1

export const PROJECT_STORE = "projects"
export const META_STORE = "meta"

interface ArrangerDB extends DBSchema {
  projects: {
    key: string
    value: ComposerProject & { savedAt: string }
  }
  meta: {
    key: string
    value: string
  }
}

let dbPromise: Promise<IDBPDatabase<ArrangerDB>> | null = null

export function getDb(): Promise<IDBPDatabase<ArrangerDB>> {
  dbPromise ??= openDB<ArrangerDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore(PROJECT_STORE, { keyPath: "projectId" })
      db.createObjectStore(META_STORE)
    },
  })
  return dbPromise
}
