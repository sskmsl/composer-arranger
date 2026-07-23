import { useState } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { useActiveVariant } from "./useActiveVariant"
import { previewPlayer, type PreviewMode } from "@/audio/previewPlayer"
import { exportMelodyMidi, downloadMidi } from "@/midi/exportMelody"
import { Button, IconButton, Select } from "@/ui/primitives"
import { Play, Square, Undo2, Redo2, Download, History } from "lucide-react"

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

  const chords = project.chords.filter((c) => c.sectionId === selectedSectionId).sort((a, b) => a.startBeat - b.startBeat)
  const sectionVariants = project.melodyVariants
    .filter((v) => v.sectionId === selectedSectionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const play = () => {
    if (!variant) return
    setPlaying(true)
    previewPlayer.play({ bpm: project.song.tempo, chords, melody: variant.notes, mode, onEnded: () => setPlaying(false) })
  }
  const stop = () => {
    previewPlayer.stop()
    setPlaying(false)
  }

  const exportMidi = () => {
    if (!variant || !selectedSectionId) return
    const section = project.sections.find((s) => s.id === selectedSectionId)
    if (!section) return
    const bytes = exportMelodyMidi({
      title: project.title,
      sectionName: section.name,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      chords,
      melody: variant,
      includeChords: mode !== "melody-only",
    })
    downloadMidi(bytes, `${project.title}-${section.name}-${variant.name}`)
  }

  return (
    <footer className="relative flex h-14 shrink-0 items-center gap-2 border-t border-hairline bg-surface-tile-3 px-3">
      <Button variant="dark" onClick={() => setHistoryOpen((v) => !v)}>
        <History size={13} /> 生成履歴 ({sectionVariants.length})
      </Button>

      <div className="mx-1 h-6 w-px bg-hairline" />

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
      </Select>
      <IconButton onClick={playing ? stop : play} disabled={!variant} className="bg-primary text-on-primary hover:bg-primary-focus">
        {playing ? <Square size={14} /> : <Play size={14} />}
      </IconButton>

      <div className="mx-1 h-6 w-px bg-hairline" />

      <Button variant="dark" onClick={exportMidi} disabled={!variant}>
        <Download size={13} /> MIDI書き出し
      </Button>

      {historyOpen && (
        <div className="absolute bottom-14 left-3 max-h-72 w-80 overflow-y-auto rounded-lg border border-hairline bg-surface-tile-1 p-2 shadow-[3px_5px_30px_rgba(0,0,0,0.4)]">
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
