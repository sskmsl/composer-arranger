import { useState } from "react"
import {
  ArrowRight,
  FileMusic,
  FolderOpen,
  Plus,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react"
import { MIDI_IMPORT_ACCEPT, analyzeMidiProjectFile, type MidiImportAnalysis } from "@/midi/importMidi"
import { useProjectStore } from "@/store/useProjectStore"
import { Button } from "@/ui/primitives"
import type { MainTab } from "./App"
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
  const imported = project.sourceImport?.type === "midi"
  const hasMusicalInput = imported || project.chords.length > 0 || project.melodyVariants.length > 0

  const continueTab: MainTab = hasMusicalInput ? "ai-partner" : "melody"

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-surface-black">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-8 sm:px-7 lg:py-12">
        <div className="max-w-3xl">
          <p className="text-[12px] font-semibold tracking-[0.2em] text-primary-on-dark">COMPOSER ARRANGER</p>
          <h1 className="mt-3 text-[24px] font-semibold leading-tight text-body-on-dark sm:text-[32px]">
            曲を準備して、アレンジを始める
          </h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-6 text-body-muted">
            最初に素材の準備方法を選んでください。専門的なGenerator設定は、必要になった時だけ「詳細調整」から開けます。
          </p>
        </div>

        <ol className="grid gap-2 sm:grid-cols-3" aria-label="制作の流れ">
          {[
            ["1", "曲を準備", "MIDI読込または新規作成"],
            ["2", "方針を選ぶ", "AIが全曲を診断して提案"],
            ["3", "生成して試聴", "候補を比較してMIDI出力"],
          ].map(([number, title, description]) => (
            <li key={number} className="rounded-md border border-hairline bg-surface-tile-1 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[12px] font-semibold text-primary-on-dark">{number}</span>
                <div>
                  <p className="text-[13px] font-semibold text-body-on-dark">{title}</p>
                  <p className="mt-0.5 text-[11px] text-body-muted">{description}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        {hasMusic && (
          <section className="flex flex-col gap-3 rounded-lg border border-primary/35 bg-primary/10 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-primary-on-dark">編集中の曲</p>
              <h2 className="mt-1 truncate text-[17px] font-semibold text-body-on-dark">{project.title}</h2>
              <p className="mt-1 text-[12px] text-body-muted">
                {project.sections.length}セクション · {project.song.key} · {project.song.tempo} BPM
              </p>
            </div>
            <Button onClick={() => onNavigate(continueTab)} className="justify-center sm:min-w-44">
              続きから始める <ArrowRight size={14} />
            </Button>
          </section>
        )}

        <div className="grid gap-3 lg:grid-cols-3">
          <label className="group relative flex min-h-48 cursor-pointer flex-col rounded-lg border border-primary/45 bg-surface-tile-1 p-5 transition hover:border-primary hover:bg-primary/8">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/18 text-primary-on-dark"><FileMusic size={20} /></span>
            <span className="mt-5 text-[16px] font-semibold text-body-on-dark">MIDIからアレンジする</span>
            <span className="mt-2 text-[12px] leading-5 text-body-muted">Logic／外部曲のコード・メロディ・テンポを解析し、AI Partnerで全曲方針を提案します。</span>
            <span className="mt-auto pt-4 text-[12px] font-medium text-primary-on-dark">{importing ? "MIDIを解析中…" : "MIDIを選択"} →</span>
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
            <span className="mt-2 text-[12px] leading-5 text-body-muted">最初のAメロを自動で用意します。コードを入力したら、主旋律や各パートを生成できます。</span>
            <span className="mt-auto pt-4 text-[12px] font-medium text-primary-on-dark">新しい曲を作る →</span>
          </button>

          <button
            type="button"
            onClick={() => setBrowserOpen(true)}
            className="group flex min-h-48 flex-col rounded-lg border border-hairline bg-surface-tile-1 p-5 text-left transition hover:border-primary/70 hover:bg-white/5"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white/8 text-body-on-dark"><FolderOpen size={20} /></span>
            <span className="mt-5 text-[16px] font-semibold text-body-on-dark">保存した曲を開く</span>
            <span className="mt-2 text-[12px] leading-5 text-body-muted">端末またはCloudに保存したComposer Projectを開き、前回の続きから再開します。</span>
            <span className="mt-auto pt-4 text-[12px] font-medium text-primary-on-dark">プロジェクトを選ぶ →</span>
          </button>
        </div>

        <section className="rounded-lg border border-hairline bg-surface-tile-1 p-4">
          <div className="flex items-start gap-3">
            <Sparkles size={17} className="mt-0.5 shrink-0 text-primary-on-dark" />
            <div>
              <h2 className="text-[13px] font-semibold text-body-on-dark">AI Partnerが制作の入口になります</h2>
              <p className="mt-1 text-[12px] leading-5 text-body-muted">曲を準備した後は、全曲診断 → 5つの方針 → 必要なパート生成の順で案内します。主旋律・短いフレーズ・対旋律などを直接調整したい場合だけ「詳細調整」を開いてください。</p>
            </div>
            <SlidersHorizontal size={16} className="ml-auto hidden shrink-0 text-body-muted sm:block" />
          </div>
        </section>
      </section>

      {browserOpen && (
        <ProjectBrowser
          onClose={() => setBrowserOpen(false)}
          onOpen={() => onNavigate("ai-partner")}
        />
      )}
      {analysis && (
        <MidiImportReviewDialog
          analysis={analysis}
          onCancel={() => setAnalysis(null)}
          onConfirm={(importedProject) => {
            loadProject(importedProject)
            setAnalysis(null)
            onNavigate("ai-partner")
          }}
        />
      )}
    </main>
  )
}
