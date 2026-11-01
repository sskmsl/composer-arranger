
export interface CloudSaveStatus {
  state: "idle" | "sending" | "saved" | "error"
  pendingCount: number
}

/** 永続化済みの未送信分だけを再送する。成功した古い版の応答で新しい編集を消さない。 */
export function createCloudSaveCoordinator<T extends { ownerId: string; revision: string }>(options: {
  owner: () => string | null
  list: (owner: string) => Promise<T[]>
  send: (entry: T) => Promise<void>
  acknowledge: (entry: T) => Promise<void>
  retryable: (error: unknown) => boolean
  notify: (status: CloudSaveStatus) => void
}) {
  const running = new Map<string, Promise<void>>()
  const requested = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  const sameOwner = (owner: string) => options.owner() === owner
  const cancelTimer = () => { if (timer) clearTimeout(timer); timer = undefined }
  function later(delay: number) {
    cancelTimer()
    timer = setTimeout(() => { timer = undefined; void flush() }, delay)
  }
  async function flush(): Promise<void> {
    cancelTimer()
    const owner = options.owner()
    if (!owner) return
    const active = running.get(owner)
    if (active) { requested.add(owner); return active }
    const work = Promise.resolve().then(async () => {
      let retry = false
      let sent = false
      try {
        do {
          requested.delete(owner)
          const pending = await options.list(owner)
          if (!sameOwner(owner)) return
          let failed = false
          for (const entry of pending) {
            if (!sameOwner(owner)) return
            options.notify({ state: "sending", pendingCount: pending.length })
            try {
              await options.send(entry)
              if (!sameOwner(owner)) return
              await options.acknowledge(entry)
              sent = true
            } catch (error) {
              failed = true
              retry ||= options.retryable(error)
            }
          }
          const remaining = await options.list(owner)
          if (!sameOwner(owner)) return
          options.notify({ state: remaining.length ? failed ? "error" : "sending" : sent ? "saved" : "idle", pendingCount: remaining.length })
          if (!remaining.length) failures = 0
          // 送信待機中に新しい編集が来た場合は、次の版もこのバリア内で送る。
          if (!failed && remaining.length) requested.add(owner)
        } while (requested.has(owner) && sameOwner(owner))
      } catch (error) {
        if (sameOwner(owner)) options.notify({ state: "error", pendingCount: 0 })
        retry = options.retryable(error)
      } finally {
        running.delete(owner)
        requested.delete(owner)
        if (retry && sameOwner(owner)) later(Math.min(120_000, 5_000 * 2 ** Math.min(failures++, 5)))
      }
    })
    running.set(owner, work)
    return work
  }
  return {
    flush,
    schedule() {
      const owner = options.owner()
      if (!owner) return
      if (running.has(owner)) { requested.add(owner); return }
      // 障害中は編集のたびに待機を800msへ短縮せず、再送の連打を避ける。
      if (timer && failures > 0) return
      later(800)
    },
    accountChanged() {
      cancelTimer(); failures = 0
      options.notify({ state: "idle", pendingCount: 0 })
      if (options.owner()) later(0)
    },
    dispose: cancelTimer,
  }
}
