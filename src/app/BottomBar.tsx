import { useState } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { useActiveVariant } from "./useActiveVariant"
import { previewLayersForMode, previewPlayer, type PreviewMode } from "@/audio/previewPlayer"
import { exportMelodyMidi, downloadMidi } from "@/midi/exportMelody"
import { Button, IconButton, Select } from "@/ui/primitives"
import { Play, Square, Undo2, Redo2, Download, History } from "lucide-react"
import { accompanimentEnabled } from "@/core/sectionContent"
import { accompanimentPatternNotesForSection } from "@/core/accompanimentPattern"
import { notesByPartRole } from "@/core/sectionLayers"

export function BottomBar() {
  const project = useProjectStore((s) => s.project)
  const selectedSectionId = useProjectStore((s) => s.selectedSectionId)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const history = useProjectStore((s) => s.history)
  const future = useProjectStore((s) => s.future)
  const deleteVariant = useProjectStore((s) => s.deleteVariant)
  const selectVariantFromHistory = useProjectStore((s) => s.selectVariantFromHistory)

  const variant = useActiveVariant()
  const [mode, setMode] = useState<PreviewMode>("chords-melody")
  const [playing, setPlaying] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const section = project.sections.find((s) => s.id === selectedSectionId)
  // Issue #41: accompaniment="none"(Silence)では伴奏を鳴らさない。
  // 保存するだけで消費しないと Silence と Chords Only が同じ音になってしまう。
  const chordsEnabled = accompanimentEnabled(section)
  const chords = chordsEnabled
    ? project.chords.filter((c) => c.sectionId === selectedSectionId).sort((a, b) => a.startBeat - b.startBeat)
    : []
  const sectionVariants = project.melodyVariants
    .filter((v) => v.sectionId === selectedSectionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const accompanimentPatternNotes = selectedSectionId
    ? accompanimentPatternNotesForSection(
        project,
        selectedSectionId,
        variant ? notesByPartRole(variant, "lead") : undefined,
      )
    : []
  const previewLayers = previewLayersForMode(mode)
  const hasPlayableMaterial =
    (previewLayers.chords && chords.length > 0) ||
    (previewLayers.melody && (variant?.notes.length ?? 0) > 0) ||
    (previewLayers.accompaniment && accompanimentPatternNotes.length > 0)

  const play = () => {
    if (!hasPlayableMaterial) return
    setPlaying(true)
    previewPlayer.play({
      bpm: project.song.tempo,
      chords,
      melody: variant?.notes ?? [],
      accompaniment: accompanimentPatternNotes,
      mode,
      onEnded: () => setPlaying(false),
    })
  }
  const stop = () => {
    previewPlayer.stop()
    setPlaying(false)
  }

  const exportMidi = () => {
    if (!hasPlayableMaterial || !selectedSectionId || !section) return
    const bytes = exportMelodyMidi({
      title: project.title,
      sectionName: section.name,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      chords,
      melody: previewLayers.melody ? variant : undefined,
      accompanimentPatternNotes: previewLayers.accompaniment ? accompanimentPatternNotes : [],
      // Issue #41: 伴奏なし設定のセクションでは、再生モードに関わらずコードを書き出さない
      includeChords: chordsEnabled && previewLayers.chords,
    })
    downloadMidi(bytes, `${project.title}-${section.name}-${variant?.name ?? "Accompaniment Pattern"}`)
  }

  return (
    <footer className="relative flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-t border-hairline bg-surface-tile-3 px-3 py-2 sm:py-0">
      <Button variant="dark" onClick={() => setHistoryOpen((v) => !v)}>
        <History size={13} /> <span className="hidden sm:inline">生成履歴</span> ({sectionVariants.length})
      </Button>

      <div className="mx-1 hidden h-6 w-px bg-hairline sm:block" />

      <IconButton onClick={undo} disabled={history.length === 0} title="Undo">
        <Undo2 size={15} />
      </IconButton>
      <IconButton onClick={redo} disabled={future.length === 0} title="Redo">
        <Redo2 size={15} />
      </IconButton>

      <div className="ml-auto" />

      <Select value={mode} onChange={(e) => setMode(e.target.value as PreviewMode)} className="!py-1">
        <option value="melody-only">Melody Only</option>
        <option value="chords-melody">Chords + Melody</option>
        <option value="chords-only">Chords Only</option>
        <option value="accompaniment-only">Arpeggio Only</option>
      </Select>
      <IconButton
        onClick={playing ? stop : play}
        disabled={!hasPlayableMaterial}
        className="bg-primary text-on-primary hover:bg-primary-focus"
      >
        {playing ? <Square size={14} /> : <Play size={14} />}
      </IconButton>

      <div className="mx-1 hidden h-6 w-px bg-hairline sm:block" />

      <Button
        variant="dark"
        onClick={exportMidi}
        disabled={!hasPlayableMaterial}
      >
        <Download size={13} /> <span className="hidden sm:inline">MIDI書き出し</span>
      </Button>

      {historyOpen && (
        <div className="absolute bottom-full left-3 z-50 mb-1 max-h-72 w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-hairline bg-surface-tile-1 p-2 shadow-[3px_5px_30px_rgba(0,0,0,0.4)] sm:w-80">
          {sectionVariants.length === 0 && <p className="p-2 text-[12px] text-ink-muted-48">まだ候補がありません</p>}
          {sectionVariants.map((v) => (
            <div key={v.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-white/5">
              <button className="flex-1 truncate text-left" onClick={() => selectVariantFromHistory(v.id)}>
                {v.name} {project.activeMelodyId === v.id && "★"}
              </button>
              <span className="text-ink-muted-48">{v.sourceMode}</span>
              <button className="text-ink-muted-48 hover:text-body-on-dark" onClick={() => deleteVariant(v.id)}>
                削除
              </button>
            </div>
          ))}
        </div>
      )}
    </footer>
  )
}
