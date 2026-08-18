import { useEffect, useRef, useState, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { Cloud, LoaderCircle, RefreshCw, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { syncProjectsFromCloud } from "@/storage/projectRepository"
import { Button, TextInput } from "@/ui/primitives"

/** Supabase設定時だけログインを要求し、App hydrateより先に全projectを同期する。 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(
    supabase ? undefined : null,
  )
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncAttempt, setSyncAttempt] = useState(0)
  const lastSyncedUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!supabase || !userId) {
      lastSyncedUserId.current = null
      return
    }
    if (lastSyncedUserId.current === userId) return
    lastSyncedUserId.current = userId
    setSyncing(true)
    setError(null)
    void syncProjectsFromCloud(userId)
      .catch((reason: unknown) => {
        lastSyncedUserId.current = null
        setError(syncErrorMessage(reason))
      })
      .finally(() => setSyncing(false))
  }, [syncAttempt, userId])

  if (!supabase) return <>{children}</>
  if (session === undefined || syncing) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-black text-body-muted">
        <LoaderCircle className="mr-2 animate-spin" size={17} />
        {syncing ? "プロジェクトを同期中…" : "ログイン状態を確認中…"}
      </div>
    )
  }
  if (!session) return <LoginForm />
  return (
    <>
      {error && (
        <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-3 z-[100] flex w-[calc(100%-1.5rem)] max-w-[28rem] justify-end sm:bottom-3">
          <div
            role="alert"
            className="pointer-events-auto w-full rounded-lg border border-amber-200/50 bg-amber-500/95 p-3 text-[12px] text-black shadow-xl"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Cloud同期を一時停止しました</p>
                <p className="mt-0.5 leading-5">
                  ローカルデータで続行できます。{error}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full p-1 hover:bg-black/10"
                aria-label="同期エラーを閉じる"
                onClick={() => setError(null)}
              >
                <X size={16} />
              </button>
            </div>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 rounded-sm bg-black/15 px-2.5 py-1 font-medium hover:bg-black/25"
              onClick={() => {
                setError(null)
                lastSyncedUserId.current = null
                setSyncAttempt((attempt) => attempt + 1)
              }}
            >
              <RefreshCw size={13} /> 再試行
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  )
}

function syncErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message
  if (
    typeof reason === "object" &&
    reason !== null &&
    "message" in reason &&
    typeof reason.message === "string" &&
    reason.message
  ) {
    return reason.message
  }
  return "同期に失敗しました"
}

function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (authError) setError(authError.message)
    setBusy(false)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-black px-4 text-body-on-dark">
      <form
        className="flex w-full max-w-[24rem] flex-col gap-4 rounded-lg border border-hairline bg-surface-tile-1 p-6"
        onSubmit={(event) => void submit(event)}
      >
        <div className="text-center">
          <Cloud className="mx-auto mb-2 text-primary-on-dark" size={28} />
          <h1 className="text-lg font-semibold">Composer Arranger</h1>
          <p className="mt-1 text-[12px] text-body-muted">
            コードジェネレーターと同じアカウントでログイン
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[12px] text-body-muted">
          メールアドレス
          <TextInput
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-body-muted">
          パスワード
          <TextInput
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="text-[12px] text-red-300">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "ログイン中…" : "ログイン"}
        </Button>
      </form>
    </div>
  )
}
