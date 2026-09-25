import { useEffect, useRef, useState } from "react"
import { clsx } from "clsx"
import { useProjectStore } from "@/store/useProjectStore"
import { prepareImportedProject } from "@/core/composerSongExchange"
import { MIDI_IMPORT_ACCEPT, analyzeMidiProjectFile, type MidiImportAnalysis } from "@/midi/importMidi"
import { downloadProjectFile, readProjectFile } from "@/storage/projectFile"
import { ProjectBrowser } from "./ProjectBrowser"
import { MidiImportReviewDialog } from "./MidiImportReviewDialog"
import { Button } from "@/ui/primitives"
import { ChevronDown, Download, FilePlus2, FolderOpen, Music2, Route, Upload } from "lucide-react"

/**
 * 上部バーの「曲」メニュー。新しい曲・開く・保存用JSON・JSON/MIDIの読み込みと、
 * 読み込んだMIDIの情報をまとめる。以前は旋律タブの左の列の上部にあり、
 * セクション一覧を下へ押し出していた。
 */
export function ProjectMenu({ onOpenImportGuide }: { onOpenImportGuide?: () => void }) {
  const project = useProjectStore((s) => s.project)
  const newProject = useProjectStore((s) => s.newProject)
  const loadProject = useProjectStore((s) => s.loadProject)
  const [open, setOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [midiImportAnalysis, setMidiImportAnalysis] = useState<MidiImportAnalysis | null>(null)
  const [midiImportBusy, setMidiImportBusy] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", closeOnOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded-pill border border-hairline px-2.5 py-1 text-[13px] text-body-muted transition hover:bg-white/10 hover:text-body-on-dark"
        title="新しい曲・開く・保存・読み込み"
      >
        <FolderOpen size={13} /> 曲 <ChevronDown size={12} />
      </button>
      {open && (
        <div role="menu" className="fixed left-3 right-3 top-24 z-[70] max-h-[75vh] overflow-y-auto rounded-md border border-hairline bg-surface-tile-1 p-3 shadow-xl sm:absolute sm:left-0 sm:right-auto sm:top-9 sm:w-80">
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="dark"
                onClick={() => {
                  // 現在のプロジェクトは自動保存済み(プロジェクトブラウザーから再度開ける)。念のため確認する
                  if (window.confirm("新しい曲を作ります。いまの曲は自動で保存されているので、「開く」からまた開けます。よろしいですか？")) {
                    newProject()
                  }
                }}
              >
                <FilePlus2 size={13} /> 新しい曲
              </Button>
              <Button variant="dark" onClick={() => setBrowserOpen(true)}>
                <FolderOpen size={13} /> 開く
              </Button>
              <Button variant="dark" onClick={() => downloadProjectFile(project)}>
                <Download size={13} /> ファイルに保存
              </Button>
              <label className="relative inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-sm bg-white/10 px-[15px] py-[8px] text-[13px] font-normal text-body-on-dark transition hover:bg-white/15 active:scale-95">
                <Upload size={13} /> ファイルから開く
                <input
                  type="file"
                  accept="application/json,.json"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={async (event) => {
                    const input = event.currentTarget
                    const file = input.files?.[0]
                    if (!file) return
                    try {
                      const raw = await readProjectFile(file)
                      loadProject(prepareImportedProject(raw))
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : "JSONの読み込みに失敗しました")
                    } finally {
                      input.value = ""
                    }
                  }}
                />
              </label>
              <label
                className={clsx(
                  "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm bg-white/10 px-[15px] py-[8px] text-[13px] font-normal text-body-on-dark transition hover:bg-white/15 active:scale-95",
                  midiImportBusy ? "cursor-wait opacity-60" : "cursor-pointer",
                )}
              >
                <Music2 size={13} /> {midiImportBusy ? "MIDI解析中…" : "MIDIを読み込む"}
                <input
                  type="file"
                  accept={MIDI_IMPORT_ACCEPT}
                  disabled={midiImportBusy}
                  className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
                  onChange={async (event) => {
                    const input = event.currentTarget
                    const file = input.files?.[0]
                    if (!file) return
                    setMidiImportBusy(true)
                    try {
                      setMidiImportAnalysis(await analyzeMidiProjectFile(file))
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : "MIDIの読み込みに失敗しました")
                    } finally {
                      input.value = ""
                      setMidiImportBusy(false)
                    }
                  }}
                />
              </label>
            </div>
            <p className="mt-2 text-[12px] leading-4 text-ink-soft">
              Logic Proでは「ファイル ＞ 書き出す ＞ 選択範囲をMIDIファイルとして」で書き出してください（.logicx や MP3 は読み込めません）。
            </p>
            {project.sourceImport?.type === "midi" && (
              <div className="mt-3 rounded-sm border border-primary/30 bg-primary/8 p-2 text-[12px] leading-relaxed text-body-muted">
                <p className="font-medium text-body-on-dark">
                  {project.sourceImport.sourceKind === "logic-project" ? "Logic Pro往復プロジェクト" : "外部曲MIDI解析プロジェクト"}
                </p>
                <p className="mt-1 break-all">{project.sourceImport.fileName}</p>
                <p>
                  Melody: {project.sourceImport.melodyTrackName} · {project.sourceImport.reviewConfirmed
                    ? "確認済み"
                    : `自動推定 ${Math.round(project.sourceImport.melodyTrackConfidence * 100)}%`}
                </p>
                <p>コード推定: {Math.round(project.sourceImport.chordInferenceConfidence * 100)}%</p>
                {project.sourceImport.keyInferenceConfidence !== undefined && (
                  <p>
                    Key: {project.song.key} · {project.sourceImport.keyInferenceSource === "user-confirmed"
                      ? "手動確認済み"
                      : project.sourceImport.keyInferenceSource === "midi-signature"
                        ? "MIDI情報"
                        : `自動推定 ${Math.round(project.sourceImport.keyInferenceConfidence * 100)}%`}
                  </p>
                )}
                <p>
                  原演奏保持: {project.importedArrangement?.tracks.length ?? 0} tracks · {project.importedArrangement?.tracks.reduce((sum, track) => sum + track.notes.length, 0) ?? 0} notes
                </p>
                {project.sourceImport.warnings.map((warning) => (
                  <p key={warning} className="mt-1 text-amber-300">・{warning}</p>
                ))}
                {onOpenImportGuide && (
                  <Button variant="secondary" className="mt-2 !px-3 !py-1.5 !text-[12px]" onClick={onOpenImportGuide}>
                    <Route size={12} /> 開始ガイド
                  </Button>
                )}
              </div>
            )}
        </div>
      )}
      {browserOpen && <ProjectBrowser onClose={() => setBrowserOpen(false)} />}
      {midiImportAnalysis && (
        <MidiImportReviewDialog
          analysis={midiImportAnalysis}
          onCancel={() => setMidiImportAnalysis(null)}
          onConfirm={(imported) => {
            loadProject(imported)
            setMidiImportAnalysis(null)
            onOpenImportGuide?.()
          }}
        />
      )}
    </div>
  )
}
