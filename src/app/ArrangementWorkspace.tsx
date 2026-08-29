import { useState } from "react"
import { GripVertical, Play, Square, Download, ChevronUp, ChevronDown, Copy, Trash2 } from "lucide-react"
import { useProjectStore } from "@/store/useProjectStore"
import { parseTimeSignature, SECTION_ROLE_LABELS } from "@/core/section"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { previewPlayer } from "@/audio/previewPlayer"
import { downloadMidi, exportSongMidi } from "@/midi/exportMelody"
import { Button, IconButton, Select } from "@/ui/primitives"
import type { MainTab } from "./App"
import { WholeSongDirectorPanel } from "./WholeSongDirectorPanel"
import { MultiPartArrangementPanel } from "./MultiPartArrangementPanel"
import { LogicProductionPackagePanel } from "./LogicProductionPackagePanel"

export function ArrangementWorkspace({ onNavigate }: { onNavigate: (tab: MainTab) => void }) {
  const project = useProjectStore((state) => state.project)
  const moveSection = useProjectStore((state) => state.moveSection)
  const selectSection = useProjectStore((state) => state.selectSection)
  const assignVariant = useProjectStore((state) => state.assignVariantToSection)
  const duplicateSection = useProjectStore((state) => state.duplicateSection)
  const removeSection = useProjectStore((state) => state.removeSection)
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)

  const playSong = () => {
    const material = buildSongPlaybackMaterial(project)
    if (
      material.melody.length === 0 &&
      material.chords.length === 0 &&
      material.accompanimentPattern.length === 0
    ) return
    setPlaying(true)
    previewPlayer.play({
      bpm: project.song.tempo,
      chords: material.chords,
      melody: material.melody,
      accompaniment: material.accompanimentPattern,
      mode: "chords-melody",
      range: { startBeat: 0, endBeat: material.totalBeats },
      onEnded: () => setPlaying(false),
    })
  }

  const stop = () => {
    previewPlayer.stop()
    setPlaying(false)
  }

  const playBoundary = (sectionStartBar: number) => {
    const material = buildSongPlaybackMaterial(project)
    const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
    const boundaryBeat = (sectionStartBar - 1) * beatsPerBar
    const range = {
      startBeat: Math.max(0, boundaryBeat - beatsPerBar),
      endBeat: Math.min(material.totalBeats, boundaryBeat + beatsPerBar),
    }
    setPlaying(true)
    previewPlayer.play({
      bpm: project.song.tempo,
      chords: material.chords,
      melody: material.melody,
      accompaniment: material.accompanimentPattern,
      mode: "chords-melody",
      range,
      onEnded: () => setPlaying(false),
    })
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[16px] font-semibold">曲全体タイムライン</h2>
        <Button variant="dark" onClick={playing ? stop : playSong} disabled={project.sections.length === 0}>
          {playing ? <Square size={14} /> : <Play size={14} />}
          {playing ? "停止" : "曲全体を再生"}
        </Button>
        <Button
          variant="dark"
          disabled={project.sections.length === 0}
          onClick={() => {
            const bytes = exportSongMidi(project, true)
            downloadMidi(bytes, `${project.title}-full-song`)
          }}
        >
          <Download size={14} /> 曲全体MIDI
        </Button>
      </div>

      <p className="text-[12px] text-ink-muted-48">
        セクションをドラッグして曲順を変更し、各セクションで採用するMelody Variantを指定します。
      </p>

      {project.sections.length > 0 && (
        <>
          <WholeSongDirectorPanel onNavigate={onNavigate} />
          <MultiPartArrangementPanel onNavigate={onNavigate} />
          <LogicProductionPackagePanel />
        </>
      )}

      <div className="flex flex-col gap-2">
        {project.sections.map((section, index) => {
          const variants = project.melodyVariants
            .filter((variant) => variant.sectionId === section.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          const assignedId = project.sectionMelodyAssignments[section.id] ?? ""
          return (
            <article
              key={section.id}
              draggable
              onDragStart={() => setDraggedSectionId(section.id)}
              onDragEnd={() => setDraggedSectionId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggedSectionId) moveSection(draggedSectionId, index)
                setDraggedSectionId(null)
              }}
              className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-tile-1 p-3 sm:flex-row sm:items-center"
            >
              <div className="flex items-center gap-2 sm:w-60">
                <GripVertical size={16} className="cursor-grab text-ink-muted-48" />
                <button className="min-w-0 flex-1 text-left" onClick={() => selectSection(section.id)}>
                  <span className="block truncate text-[14px] font-medium">{section.name}</span>
                  <span className="text-[11px] text-ink-muted-48">
                    {SECTION_ROLE_LABELS[section.role]} · {section.startBar}–{section.startBar + section.lengthBars - 1}小節
                  </span>
                </button>
                <div className="flex">
                  <IconButton
                    title="上へ"
                    disabled={index === 0}
                    onClick={() => moveSection(section.id, index - 1)}
                  >
                    <ChevronUp size={13} />
                  </IconButton>
                  <IconButton
                    title="下へ"
                    disabled={index === project.sections.length - 1}
                    onClick={() => moveSection(section.id, index + 1)}
                  >
                    <ChevronDown size={13} />
                  </IconButton>
                </div>
              </div>

              <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-muted-48">
                採用Melody
                <Select
                  className="min-w-0 flex-1"
                  value={assignedId}
                  onChange={(event) => assignVariant(section.id, event.target.value || null)}
                >
                  <option value="">未選択</option>
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.name}
                      {variant.generatorProfile ? ` · ${variant.generatorProfile}` : ""}
                      {variant.patternIndex ? ` · Pattern ${variant.patternIndex}` : ""}
                    </option>
                  ))}
                </Select>
              </label>

              {/* Issue #58: セクション編集画面へ戻らずアレンジ画面から直接複製・削除できるようにする */}
              <div className="flex shrink-0 gap-1">
                {index > 0 && (
                  <IconButton title="前セクションとの境界を再生" onClick={() => playBoundary(section.startBar)}>
                    <Play size={13} />
                  </IconButton>
                )}
                <IconButton title="複製" onClick={() => duplicateSection(section.id)}>
                  <Copy size={13} />
                </IconButton>
                <IconButton title="削除" onClick={() => removeSection(section.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            </article>
          )
        })}
      </div>

      {project.sections.length === 0 && (
        <div className="rounded-lg border border-dashed border-hairline p-8 text-center text-[13px] text-ink-muted-48">
          Melodyタブでセクションを追加してください。
        </div>
      )}
    </main>
  )
}
