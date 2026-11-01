import { create } from "zustand"
import type { CloudSaveStatus } from "./cloudSaveCoordinator"
export const useCloudSaveState = create<CloudSaveStatus>(() => ({ state: "idle", pendingCount: 0 }))
