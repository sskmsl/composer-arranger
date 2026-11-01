// dist-e2e専用。認証入口は実コンポーネントを使い、SDK/サーバー境界だけを制御する。
type Owner = string | null
type Row = { id: string; data: unknown; updated_at: string; deleted_at: string | null }
let owner: Owner = null
let offline = false
const listeners = new Set<(event: string, session: unknown) => void>()
const remote = new Map<string, Row[]>()
const held = new Map<string, Array<(reject: boolean) => void>>()
const holding = new Set<string>()
const pushing = new Set<string>()
const heldPushes = new Map<string, Array<() => void>>()
let initialResolve: ((value: unknown) => void) | undefined
let initialCalls = 0
const calls: Array<{ owner: Owner; name: string; id?: string }> = []
const session = (id: Owner) => id ? ({ access_token: `fixture-access-${id}`, refresh_token: "fixture-refresh", expires_in: 3600, token_type: "bearer",
  user: { id, email: `${id}@example.test`, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T00:00:00Z" } }) : null
function emit(next: Owner) {
  owner = next
  sessionStorage.setItem("fixtureAuthOwner", JSON.stringify(next))
  for (const listener of listeners) listener(next ? "SIGNED_IN" : "SIGNED_OUT", session(next))
}
export let supabase: any = null
export function enableAuthFixture() {
  const query = new URLSearchParams(location.search)
  if (!query.has("auth")) return
  owner = sessionStorage.getItem("fixtureAuthOwner") !== null ? JSON.parse(sessionStorage.getItem("fixtureAuthOwner")!)
    : query.has("signedout") ? null : query.get("owner") || "A"
  offline = sessionStorage.getItem("fixtureOffline") !== null ? sessionStorage.getItem("fixtureOffline") === "true" : query.has("offline")
  for (const [id, rows] of JSON.parse(sessionStorage.getItem("fixtureRemote") || "[]")) remote.set(id, rows)
  if (query.has("holdList")) holding.add(query.get("holdList")!)
  supabase = {
    auth: {
      getSession: () => {
        if (query.has("failInitial") && initialCalls++ === 0) return Promise.reject(new Error("fixture session unavailable"))
        return query.has("holdInitial") ? new Promise(resolve => { initialResolve = resolve }) : Promise.resolve({ data: { session: session(owner) }, error: null })
      },
      getUser: async () => ({ data: { user: owner ? { id: owner } : null }, error: null }),
      onAuthStateChange: (callback: (event: string, value: unknown) => void) => {
        listeners.add(callback)
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }
      },
      signInWithPassword: async ({ email }: { email: string }) => { emit(email.split("@")[0]); return { data: { session: session(owner) }, error: null } },
      signOut: async () => { emit(null); return { error: null } },
    },
    rpc: async (name: string, args: Record<string, any> = {}) => {
      const requestOwner = owner
      calls.push({ owner: requestOwner, name, id: args.p_id })
      if (offline) throw new TypeError("Failed to fetch: fixture offline")
      if (name === "list_arranger_project_metadata" && requestOwner && holding.has(requestOwner)) {
        const rejected = await new Promise<boolean>(resolve => held.set(requestOwner, [...held.get(requestOwner) || [], resolve]))
        if (rejected) return { data: null, error: { message: "fixture stale sync failure" } }
      }
      if (!requestOwner) return { data: null, error: { message: "fixture signed out" } }
      if (name === "upsert_arranger_project" && pushing.has(requestOwner)) await new Promise<void>(resolve => heldPushes.set(requestOwner, [...heldPushes.get(requestOwner) || [], resolve]))
      const rows = remote.get(requestOwner) || []
      if (name === "list_arranger_project_metadata") return { data: rows.map(({ id, updated_at, deleted_at }) => ({ id, updated_at, deleted_at })), error: null }
      if (name === "get_arranger_project") return { data: rows.find(row => row.id === args.p_id)?.data ?? null, error: null }
      if (name === "upsert_arranger_project") {
        const old = rows.find(row => row.id === args.p_id)
        if (!old || args.p_updated_at >= old.updated_at) {
          remote.set(requestOwner, [...rows.filter(row => row.id !== args.p_id), { id: args.p_id, data: args.p_data, updated_at: args.p_updated_at, deleted_at: args.p_deleted_at }])
          sessionStorage.setItem("fixtureRemote", JSON.stringify([...remote.entries()]))
        }
        return { data: null, error: null }
      }
      return { data: null, error: { message: `Unexpected fixture RPC: ${name}` } }
    },
  }
  Object.assign(window, { authFixture: {
    emit,
    offline(value: boolean) { offline = value; sessionStorage.setItem("fixtureOffline", String(value)) },
    releaseInitial(id: Owner) { initialResolve?.({ data: { session: session(id) }, error: null }) },
    releaseList(id: string, reject = false) { holding.delete(id); for (const resolve of held.get(id) || []) resolve(reject); held.delete(id) },
    holdPush(id: string) { pushing.add(id) },
    releasePush(id: string) { pushing.delete(id); for (const resolve of heldPushes.get(id) || []) resolve(); heldPushes.delete(id) },
    calls: () => calls,
    remote: (id: string) => remote.get(id) || [],
    deleteRemote(id: string, projectId: string, deletedAt: string) {
      remote.set(id, [...(remote.get(id) || []).filter(row => row.id !== projectId), { id: projectId, data: null, updated_at: deletedAt, deleted_at: deletedAt }])
      sessionStorage.setItem("fixtureRemote", JSON.stringify([...remote.entries()]))
    },
  } })
}
