export type SaveStatus = "idle" | "saving" | "saved" | "error"

/** 最新の編集を曲ごとに保持し、失敗した曲も捨てずに再試行できる保存キュー。 */
export function createSaveCoordinator<T>(write: (value: T) => Promise<void>, key: (value: T) => string, notify: (status: SaveStatus) => void) {
  const pending = new Map<string, { value: T; revision: number }>()
  let revision = 0
  let running: Promise<void> | null = null
  function start(): Promise<void> {
    if (running) return running
    const attempted = new Set<number>()
    let finish!: () => void
    const completion = new Promise<void>((resolve) => { finish = resolve })
    running = completion
    const complete = () => {
      running = null
      if ([...pending.values()].some((item) => !attempted.has(item.revision))) void start()
      finish()
    }
    void (async () => {
      notify("saving")
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
    })().then(complete, () => { running = null; finish() })
    return completion
  }
  return {
    enqueue(value: T) {
      const id = key(value)
      // 曲を切り替えて戻った編集も、lastOpenedを決める最新の保存として最後へ置く。
      pending.delete(id)
      pending.set(id, { value, revision: ++revision })
      void start()
    },
    pendingValue(id: string): T | undefined { return pending.get(id)?.value },
    hasPending(): boolean { return pending.size > 0 },
    async discard(id: string): Promise<T | undefined> {
      const retained = pending.get(id)
      pending.delete(id)
      // 既に開始した書込が終わってから削除処理へ進み、削除後の復活を防ぐ。
      while (running) await running
      const latest = pending.get(id) ?? retained
      pending.delete(id)
      notify(pending.size ? "error" : "saved")
      return latest?.value
    },
    async flush(): Promise<boolean> {
      await start()
      while (running) await running
      return pending.size === 0
    },
  }
}
