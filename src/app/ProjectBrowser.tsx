import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useProjectStore } from "@/store/useProjectStore"
import { listProjects, getLastOpenedId, putProjectRecord } from "@/storage/projectRepository"
import type { ComposerProject } from "@/core/project"
import { summarizeProject, sortSummariesByRecency, filterSummaries, type ProjectSummary } from "@/core/projectBrowser"
import { Button, TextInput } from "@/ui/primitives"
import { X, FolderOpen, Copy, Pencil, Trash2, AlertTriangle, Check, Cloud } from "lucide-react"
import { isCloudSyncConfigured } from "@/features/sync/projectSync"

/**
 * Issue #14: IndexedDBへ自動保存したプロジェクトを一覧・整理するブラウザー。
 * Open / Duplicate / Rename / Delete と、自動保存状態・最終保存時刻・検索・更新日時順を提供する。
 */
export function ProjectBrowser({
  onClose,
  onOpen,
}: {
  onClose: () => void
  onOpen?: () => void
}) {
  const currentId = useProjectStore((s) => s.project.projectId)
  const loadProjectById = useProjectStore((s) => s.loadProjectById)
  const duplicateStoredProject = useProjectStore((s) => s.duplicateStoredProject)
  const renameStoredProject = useProjectStore((s) => s.renameStoredProject)
  const deleteStoredProject = useProjectStore((s) => s.deleteStoredProject)

  const [items, setItems] = useState<ProjectSummary[]>([])
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  /** 直近削除の復元用(セッション内)。wasActiveは削除時点で現在編集中のプロジェクトだったか */
  const [recentlyDeleted, setRecentlyDeleted] = useState<{ summary: ProjectSummary; record: ComposerProject; wasActive: boolean } | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    const [records, last] = await Promise.all([listProjects(), getLastOpenedId()])
    setItems(records.map((r) => summarizeProject(r)))
    setLastOpenedId(last)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = useMemo(() => sortSummariesByRecency(filterSummaries(items, query)), [items, query])

  const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "未保存")

  const open = async (id: string) => {
    await loadProjectById(id)
    onClose()
    onOpen?.()
  }

  const duplicate = async (id: string) => {
    await duplicateStoredProject(id)
    await refresh()
  }

  const commitRename = async (id: string) => {
    const title = renameValue.trim()
    setRenamingId(null)
    if (title) {
      await renameStoredProject(id, title)
      await refresh()
    }
  }

  const doDelete = async (summary: ProjectSummary) => {
    // 復元用に削除前レコードを控えてから削除する(セッション内で元に戻せる)。
    // 削除時点で「現在編集中のプロジェクトだったか」も記録し、復元方法を分岐させる。
    const all = await listProjects()
    const record = all.find((r) => r.projectId === summary.projectId) ?? null
    const wasActive = summary.projectId === currentId
    await deleteStoredProject(summary.projectId)
    setConfirmDeleteId(null)
    if (record) setRecentlyDeleted({ summary, record, wasActive })
    await refresh()
  }

  const restoreDeleted = async () => {
    if (!recentlyDeleted) return
    if (recentlyDeleted.wasActive) {
      // 削除時点で編集中だったプロジェクトの復元は、編集セッションへ戻すのが自然
      useProjectStore.getState().loadProject(recentlyDeleted.record)
    } else {
      // 編集中でない(無関係な)プロジェクトの復元は、IndexedDBへ書き戻すだけに留め、
      // 現在の編集セッション(project/selectedSectionId/history/lastOpened)には触れない
      await putProjectRecord(recentlyDeleted.record)
    }
    setRecentlyDeleted(null)
    await refresh()
  }

  // LeftPanelの<aside>(translate transform + overflow-y-auto)の内側にマウントされると、
  // fixed inset-0のオーバーレイがその<aside>を基準にクリップ/縮小されてしまう
  // (transformを持つ祖先はfixed要素の包含ブロックになるCSS仕様のため)。
  // document.bodyへポータルし、常にビューポート全体を覆うようにする(Issue #14 PR#36レビュー対応)。
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-hairline bg-surface-tile-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-body-on-dark">保存済みプロジェクト</h2>
            {isCloudSyncConfigured() && (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-primary-on-dark">
                <Cloud size={10} /> Cloud同期有効
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-body-muted hover:bg-white/10 hover:text-body-on-dark" aria-label="閉じる">
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-hairline px-4 py-2">
          <TextInput className="w-full" placeholder="タイトルで検索…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {recentlyDeleted && (
          <div className="flex items-center justify-between gap-2 border-b border-hairline bg-amber-500/10 px-4 py-2 text-[12px] text-body-on-dark">
            <span>「{recentlyDeleted.summary.title}」を削除しました</span>
            <Button variant="secondary" onClick={restoreDeleted}>
              元に戻す
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-4 text-center text-[13px] text-ink-muted-48">読み込み中…</p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-center text-[13px] text-ink-muted-48">保存済みプロジェクトがありません</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visible.map((s) => (
                <li key={s.projectId} className="rounded-sm border border-hairline bg-surface-tile-2 p-2.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {renamingId === s.projectId ? (
                        <div className="flex items-center gap-1.5">
                          <TextInput
                            autoFocus
                            className="flex-1"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitRename(s.projectId)
                              if (e.key === "Escape") setRenamingId(null)
                            }}
                          />
                          <button type="button" className="rounded-full p-1 text-emerald-400 hover:bg-white/10" onClick={() => void commitRename(s.projectId)} aria-label="確定">
                            <Check size={14} />
                          </button>
                        </div>
                      ) : (
                        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-body-on-dark">
                          {s.title}
                          {s.projectId === currentId && <span className="rounded-sm bg-primary/20 px-1 text-[11px] text-primary-on-dark">編集中</span>}
                          {s.timingAmbiguous && (
                            <span className="flex items-center gap-0.5 rounded-sm bg-amber-500/20 px-1 text-[11px] text-amber-400" title="時間単位を自動判定できません。開いた際に確認できます">
                              <AlertTriangle size={9} /> 移行要確認
                            </span>
                          )}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-ink-muted-48">
                        {s.sectionCount}セクション · {s.key} · {s.tempo}bpm · {s.timeSignature} · {fmtTime(s.savedAt)}
                        {s.projectId === lastOpenedId && <span className="ml-1 text-primary-on-dark">(最後に開いた)</span>}
                      </p>
                    </div>
                  </div>
                  {confirmDeleteId === s.projectId ? (
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <span className="mr-auto text-[11px] text-amber-400">削除しますか?(元に戻せます)</span>
                      <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
                        やめる
                      </Button>
                      <Button variant="primary" onClick={() => void doDelete(s)}>
                        削除
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <Button variant="dark" onClick={() => void open(s.projectId)}>
                        <FolderOpen size={12} /> 開く
                      </Button>
                      <Button variant="dark" onClick={() => void duplicate(s.projectId)}>
                        <Copy size={12} /> 複製
                      </Button>
                      <Button
                        variant="dark"
                        onClick={() => {
                          setRenamingId(s.projectId)
                          setRenameValue(s.title)
                        }}
                      >
                        <Pencil size={12} /> 改名
                      </Button>
                      <Button variant="dark" onClick={() => setConfirmDeleteId(s.projectId)}>
                        <Trash2 size={12} /> 削除
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
