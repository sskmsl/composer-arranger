import { useEffect, useMemo, useRef, useState } from "react"
import { GripVertical, Play, Square, Download, ChevronUp, ChevronDown, Copy, Trash2 } from "lucide-react"
import { useProjectStore } from "@/store/useProjectStore"
import { parseTimeSignature, SECTION_ROLE_LABELS } from "@/core/section"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import { previewPlayer } from "@/audio/previewPlayer"
import { formatPlaybackTime, fullSongPreviewRanges, type PreviewBeatRange } from "@/audio/fullSongPreview"
import { downloadMidi, exportSongMidi } from "@/midi/exportMelody"
import { Button, IconButton, Select } from "@/ui/primitives"
import type { MainTab } from "./App"
import { WholeSongDirectorPanel } from "./WholeSongDirectorPanel"
import { MultiPartArrangementPanel } from "./MultiPartArrangementPanel"
import { LogicProductionPackagePanel } from "./LogicProductionPackagePanel"
import { FullSongArrangementPanel } from "./FullSongArrangementPanel"

export function ArrangementWorkspace({ onNavigate }: { onNavigate: (tab: MainTab) => void }) {
  const project = useProjectStore((state) => state.project)
  const moveSection = useProjectStore((state) => state.moveSection)
  const selectSection = useProjectStore((state) => state.selectSection)
  const assignVariant = useProjectStore((state) => state.assignVariantToSection)
  const duplicateSection = useProjectStore((state) => state.duplicateSection)
  const removeSection = useProjectStore((state) => state.removeSection)
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playbackBeat, setPlaybackBeat] = useState(0)
  const playbackRunRef = useRef(0)
  const seekingRef = useRef(false)
  const material = useMemo(() => buildSongPlaybackMaterial(project), [project])

  const playRangeSequence = (
    ranges: PreviewBeatRange[],
    index: number,
    runId: number,
  ) => {
    if (playbackRunRef.current !== runId || index >= ranges.length) {
      if (playbackRunRef.current === runId) {
        setPlaybackBeat(material.totalBeats)
        setPlaying(false)
      }
      return
    }
    previewPlayer.play({
      bpm: project.song.tempo,
      chords: material.chords,
      melody: material.melody,
      accompaniment: material.accompanimentPattern,
      mode: "chords-melody",
      range: ranges[index],
      onEnded: () => {
        setPlaybackBeat(ranges[index].endBeat)
        playRangeSequence(ranges, index + 1, runId)
      },
    })
  }

  const playSong = (requestedStartBeat = playbackBeat) => {
    if (
      material.melody.length === 0 &&
      material.chords.length === 0 &&
      material.accompanimentPattern.length === 0
    ) return
    const startBeat = requestedStartBeat >= material.totalBeats ? 0 : requestedStartBeat
    const ranges = fullSongPreviewRanges(material.totalBeats, 32, startBeat)
    if (ranges.length === 0) return
    const runId = playbackRunRef.current + 1
    playbackRunRef.current = runId
    setPlaybackBeat(startBeat)
    setPlaying(true)
    playRangeSequence(ranges, 0, runId)
  }

  const beginSeeking = () => {
    if (seekingRef.current) return
    seekingRef.current = true
    if (playing) {
      // ドラッグ中に旧再生位置がバーへ書き戻されないよう、一時停止する。
      playbackRunRef.current += 1
      previewPlayer.stop()
    }
  }

  const commitSeek = (value: number) => {
    const wasSeeking = seekingRef.current
    seekingRef.current = false
    const beat = Math.max(0, Math.min(material.totalBeats, value))
    setPlaybackBeat(beat)
    if (wasSeeking && playing) playSong(beat)
  }

  const stop = (reset = false) => {
    const currentBeat = previewPlayer.isPlaying()
      ? previewPlayer.getCurrentBeat()
      : playbackBeat
    playbackRunRef.current += 1
    previewPlayer.stop()
    setPlaying(false)
    setPlaybackBeat(reset ? 0 : Math.max(0, Math.min(material.totalBeats, currentBeat)))
  }

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      if (seekingRef.current || !previewPlayer.isPlaying()) return
      setPlaybackBeat(Math.max(0, Math.min(material.totalBeats, previewPlayer.getCurrentBeat())))
    }, 100)
    return () => window.clearInterval(timer)
  }, [material.totalBeats, playing])

  useEffect(() => () => {
    playbackRunRef.current += 1
    previewPlayer.stop()
  }, [])

  const playBoundary = (sectionStartBar: number) => {
    const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
    const boundaryBeat = (sectionStartBar - 1) * beatsPerBar
    const range = {
      startBeat: Math.max(0, boundaryBeat - beatsPerBar),
      endBeat: Math.min(material.totalBeats, boundaryBeat + beatsPerBar),
    }
    playbackRunRef.current += 1
    setPlaybackBeat(range.startBeat)
    setPlaying(true)
    previewPlayer.play({
      bpm: project.song.tempo,
      chords: material.chords,
      melody: material.melody,
      accompaniment: material.accompanimentPattern,
      mode: "chords-melody",
      range,
      onEnded: () => {
        setPlaybackBeat(range.endBeat)
        setPlaying(false)
      },
    })
  }

  return (
    <main className="flex w-full min-w-0 max-w-full flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-3 py-4 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[16px] font-semibold">曲全体タイムライン</h2>
        <Button variant="dark" onClick={playing ? () => stop() : () => playSong()} disabled={project.sections.length === 0}>
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

      {project.sections.length > 0 && (
        <div className="min-w-0 max-w-full rounded-md border border-hairline bg-surface-tile-1 px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] text-body-muted">
            <span>{playing ? "曲全体を再生中" : "曲全体の再生位置"}</span>
            <span className="tabular-nums text-body-on-dark">
              {formatPlaybackTime(playbackBeat, project.song.tempo)} / {formatPlaybackTime(material.totalBeats, project.song.tempo)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0.25, material.totalBeats)}
            step={0.25}
            value={Math.min(playbackBeat, material.totalBeats)}
            aria-label="曲全体タイムラインの再生位置"
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/12 accent-primary"
            onChange={(event) => setPlaybackBeat(Number(event.currentTarget.value))}
            onPointerDown={beginSeeking}
            onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
            onPointerCancel={(event) => commitSeek(Number(event.currentTarget.value))}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                beginSeeking()
              }
            }}
            onKeyUp={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return
              commitSeek(Number(event.currentTarget.value))
            }}
            onBlur={(event) => commitSeek(Number(event.currentTarget.value))}
          />
        </div>
      )}

      <p className="text-[12px] text-ink-muted-48">
        セクションをドラッグして曲順を変更し、各セクションで採用するMelody Variantを指定します。
      </p>

      {project.sections.length > 0 && (
        <>
          <FullSongArrangementPanel />
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
              className="flex min-w-0 max-w-full flex-col gap-3 overflow-hidden rounded-lg border border-hairline bg-surface-tile-1 p-3 sm:flex-row sm:items-center"
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
        <div className="rounded-lg border border-dashed border-hairline p-8 text-center">
          <p className="text-[15px] font-semibold text-body-on-dark">アレンジする曲がまだありません</p>
          <p className="mt-2 text-[12px] text-body-muted">先にMIDIを読み込むか、新しい曲のセクションを作成してください。</p>
          <Button className="mt-4" onClick={() => onNavigate("home")}>ホームで曲を準備する</Button>
        </div>
      )}
    </main>
  )
}
