export type SaveStatus = "idle" | "saving" | "saved" | "error"

/** 最新の編集を曲ごとに保持し、失敗した曲も捨てずに再試行できる保存キュー。 */
export function createSaveCoordinator<T>(write: (value: T) => Promise<void>, key: (value: T) => string, notify: (status: SaveStatus) => void) {
  const pending = new Map<string, { value: T; revision: number }>()
  let revision = 0
  let running: Promise<void> | null = null
  function start(): Promise<void> {
    if (running) return running
    running = (async () => {
      notify("saving")
      const attempted = new Set<number>()
      while (true) {
        const next = [...pending.entries()].find(([, item]) => !attempted.has(item.revision))
        if (!next) break
        const [id, item] = next
        attempted.add(item.revision)
        try {
          await write(item.value)
          if (pending.get(id) === item) pending.delete(id)
        } catch {
          // 失敗した版を保持する。新しい編集または明示的な再試行で再び試す。
        }
      }
      notify(pending.size ? "error" : "saved")
    })().finally(() => { running = null })
    return running
  }
  return {
    enqueue(value: T) {
      pending.set(key(value), { value, revision: ++revision })
      void start()
    },
    async flush(): Promise<boolean> {
      await start()
      return pending.size === 0
    },
  }
}
