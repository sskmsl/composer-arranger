import { useState } from "react"
import {
  ArrowRight,
  FileMusic,
  FolderOpen,
  Music2,
  Plus,
} from "lucide-react"
import { isComposerSongExchange, prepareImportedProject } from "@/core/composerSongExchange"
import { MIDI_IMPORT_ACCEPT, analyzeMidiProjectFile, type MidiImportAnalysis } from "@/midi/importMidi"
import { readProjectFile } from "@/storage/projectFile"
import { useProjectStore } from "@/store/useProjectStore"
import { Button } from "@/ui/primitives"
import type { MainTab } from "./App"
import { homeContinueAction } from "./homeNavigation"
import { MidiImportReviewDialog } from "./MidiImportReviewDialog"
import { ProjectBrowser } from "./ProjectBrowser"

export function HomeWorkspace({ onNavigate }: { onNavigate: (tab: MainTab) => void }) {
  const project = useProjectStore((state) => state.project)
  const newProject = useProjectStore((state) => state.newProject)
  const loadProject = useProjectStore((state) => state.loadProject)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [analysis, setAnalysis] = useState<MidiImportAnalysis | null>(null)
  const [importing, setImporting] = useState(false)
  const hasMusic = project.sections.length > 0
  const continueAction = homeContinueAction(project)

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-surface-black">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-8 sm:px-7 lg:py-12">
        {hasMusic && (
          <section className="flex flex-col gap-3 rounded-lg border border-primary/35 bg-primary/10 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-primary-on-dark">編集中の曲</p>
              <h2 className="mt-1 truncate text-[17px] font-semibold text-body-on-dark">{project.title}</h2>
              <p className="mt-1 text-[13px] text-body-muted">
                {project.sections.length}セクション · {project.song.key} · {project.song.tempo} BPM
              </p>
            </div>
            <Button onClick={() => onNavigate(continueAction.tab)} className="justify-center sm:min-w-44">
              {continueAction.label} <ArrowRight size={14} />
            </Button>
          </section>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="group relative flex min-h-48 cursor-pointer flex-col rounded-lg border border-primary/45 bg-surface-tile-1 p-5 transition hover:border-primary hover:bg-primary/8">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/18 text-primary-on-dark"><Music2 size={20} /></span>
            <span className="mt-5 text-[16px] font-semibold text-body-on-dark">Chord Generatorの曲から始める</span>
            <span className="mt-2 text-[13px] leading-5 text-body-muted">Chord Generatorで書き出した曲(.composer-song.json)を開き、曲名・テンポ・セクション・コード・転調・スタイルを引き継ぎます。</span>
            <span className="mt-auto pt-4 text-[13px] font-medium text-primary-on-dark">ファイルを選択 →</span>
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Chord Generatorの書き出しファイルを選択"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={async (event) => {
                const input = event.currentTarget
                const file = input.files?.[0]
                if (!file) return
                try {
                  const raw = await readProjectFile(file)
                  if (!isComposerSongExchange(raw)) {
                    throw new Error("Chord Generatorの書き出しファイルではありません。保存したComposer Projectは「保存した曲を開く」から開けます")
                  }
                  loadProject(prepareImportedProject(raw))
                  onNavigate(homeContinueAction(useProjectStore.getState().project).tab)
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : "ファイルの読み込みに失敗しました")
                } finally {
                  input.value = ""
                }
              }}
            />
          </label>

          <label className="group relative flex min-h-48 cursor-pointer flex-col rounded-lg border border-primary/45 bg-surface-tile-1 p-5 transition hover:border-primary hover:bg-primary/8">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/18 text-primary-on-dark"><FileMusic size={20} /></span>
            <span className="mt-5 text-[16px] font-semibold text-body-on-dark">MIDIからアレンジする</span>
            <span className="mt-2 text-[13px] leading-5 text-body-muted">Logic／外部曲のコード・メロディ・テンポを読み込み、全曲の方向を選んでアレンジします。AIと相談しながら仕上げられます。</span>
            <span className="mt-auto pt-4 text-[13px] font-medium text-primary-on-dark">{importing ? "MIDIを解析中…" : "MIDIを選択"} →</span>
            <input
              type="file"
              accept={MIDI_IMPORT_ACCEPT}
              disabled={importing}
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
              onChange={async (event) => {
                const input = event.currentTarget
                const file = input.files?.[0]
                if (!file) return
                setImporting(true)
                try {
                  setAnalysis(await analyzeMidiProjectFile(file))
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : "MIDIの読み込みに失敗しました")
                } finally {
                  input.value = ""
                  setImporting(false)
                }
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              newProject()
              onNavigate("melody")
            }}
            className="group flex min-h-48 flex-col rounded-lg border border-hairline bg-surface-tile-1 p-5 text-left transition hover:border-primary/70 hover:bg-white/5"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white/8 text-body-on-dark"><Plus size={20} /></span>
            <span className="mt-5 text-[16px] font-semibold text-body-on-dark">コードから新しく作る</span>
            <span className="mt-2 text-[13px] leading-5 text-body-muted">最初のAメロを自動で用意します。コードを入力したら、主旋律や各パートを生成できます。</span>
            <span className="mt-auto pt-4 text-[13px] font-medium text-primary-on-dark">新しい曲を作る →</span>
          </button>

          <button
            type="button"
            onClick={() => setBrowserOpen(true)}
            className="group flex min-h-48 flex-col rounded-lg border border-hairline bg-surface-tile-1 p-5 text-left transition hover:border-primary/70 hover:bg-white/5"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white/8 text-body-on-dark"><FolderOpen size={20} /></span>
            <span className="mt-5 text-[16px] font-semibold text-body-on-dark">保存した曲を開く</span>
            <span className="mt-2 text-[13px] leading-5 text-body-muted">端末またはクラウドに保存した曲を開き、前回の続きから再開します。</span>
            <span className="mt-auto pt-4 text-[13px] font-medium text-primary-on-dark">プロジェクトを選ぶ →</span>
          </button>
        </div>

      </section>

      {browserOpen && (
        <ProjectBrowser
          onClose={() => setBrowserOpen(false)}
          onOpen={() => onNavigate(homeContinueAction(useProjectStore.getState().project).tab)}
        />
      )}
      {analysis && (
        <MidiImportReviewDialog
          analysis={analysis}
          onCancel={() => setAnalysis(null)}
          onConfirm={(importedProject) => {
            loadProject(importedProject)
            setAnalysis(null)
            onNavigate("arrangement")
          }}
        />
      )}
    </main>
  )
}
