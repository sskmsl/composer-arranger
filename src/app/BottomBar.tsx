import { useEffect, useRef, useState } from "react"
import { sectionTempoChanges } from "@/core/tempoMap"
import { useProjectStore } from "@/store/useProjectStore"
import { useActiveVariant } from "./useActiveVariant"
import { previewLayersForMode, previewPlayer, type PreviewMode } from "@/audio/previewPlayer"
import { exportMelodyMidi, downloadMidi } from "@/midi/exportMelody"
import { Button, IconButton, Select } from "@/ui/primitives"
import { Play, Square, Undo2, Redo2, Download, History } from "lucide-react"
import { accompanimentEnabled } from "@/core/sectionContent"
import { accompanimentPatternNotesForSection } from "@/core/accompanimentPattern"
import { replaceVariantNotes } from "@/core/sectionLayers"
import { leadNotesForAudition } from "@/core/auditionMaterial"
import { parseTimeSignature } from "@/core/section"
import { formatPlaybackTime } from "@/audio/fullSongPreview"
import { applyArrangementTimelineToSectionEvents } from "@/core/arrangementTimelineConstraints"

export function BottomBar() {
  const project = useProjectStore((s) => s.project)
  const selectedSectionId = useProjectStore((s) => s.selectedSectionId)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const history = useProjectStore((s) => s.history)
  const future = useProjectStore((s) => s.future)
  const deleteVariant = useProjectStore((s) => s.deleteVariant)
  const selectVariantFromHistory = useProjectStore((s) => s.selectVariantFromHistory)
  const previewStartBeat = useProjectStore((s) => s.previewStartBeat)

  const variant = useActiveVariant()
  const [mode, setMode] = useState<PreviewMode>("chords-melody")
  const [playing, setPlaying] = useState(false)
  const [playbackBeat, setPlaybackBeat] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const resumeAfterSeekRef = useRef(false)
  const seekingRef = useRef(false)
  const playFromBeatRef = useRef<(beat: number) => void>(() => undefined)

  const section = project.sections.find((s) => s.id === selectedSectionId)
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const totalBeats = section ? section.lengthBars * beatsPerBar : 0
  const timelineConstraints = project.fullSongArrangement?.plan.directive?.timelineConstraints
  const rawLeadNotes = selectedSectionId
    ? leadNotesForAudition(project, selectedSectionId, variant)
    : []
  const leadNotes = section
    ? applyArrangementTimelineToSectionEvents(
        rawLeadNotes,
        timelineConstraints,
        beatsPerBar,
        section.startBar,
        true,
      )
    : []
  // Issue #41: accompaniment="none"(Silence)では伴奏を鳴らさない。
  // 保存するだけで消費しないと Silence と Chords Only が同じ音になってしまう。
  const chordsEnabled = accompanimentEnabled(section)
  const rawChords = chordsEnabled
    ? project.chords.filter((c) => c.sectionId === selectedSectionId).sort((a, b) => a.startBeat - b.startBeat)
    : []
  const chords = section
    ? applyArrangementTimelineToSectionEvents(
        rawChords,
        timelineConstraints,
        beatsPerBar,
        section.startBar,
        false,
      )
    : []
  const sectionVariants = project.melodyVariants
    .filter((v) => v.sectionId === selectedSectionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const rawAccompanimentPatternNotes = selectedSectionId
    ? accompanimentPatternNotesForSection(
        project,
        selectedSectionId,
        leadNotes,
      )
    : []
  const accompanimentPatternNotes = section
    ? applyArrangementTimelineToSectionEvents(
        rawAccompanimentPatternNotes,
        timelineConstraints,
        beatsPerBar,
        section.startBar,
        false,
      )
    : []
  const previewLayers = previewLayersForMode(mode)
  const hasPlayableMaterial =
    (previewLayers.chords && chords.length > 0) ||
    (previewLayers.melody && leadNotes.length > 0) ||
    (previewLayers.accompaniment && accompanimentPatternNotes.length > 0)

  const play = (requestedStartBeat = playbackBeat) => {
    if (!hasPlayableMaterial) return
    const startBeat = requestedStartBeat >= totalBeats ? 0 : Math.max(0, requestedStartBeat)
    setPlaybackBeat(startBeat)
    setPlaying(true)
    // セクション未分割の長尺MIDIも、8小節で切らず最後まで連続再生する。
    previewPlayer.playContinuous({
      bpm: project.song.tempo,
      tempoChanges: selectedSectionId ? sectionTempoChanges(project, selectedSectionId) : undefined,
      chords,
      melody: leadNotes,
      accompaniment: accompanimentPatternNotes,
      mode,
      startBeat,
      range: { startBeat: 0, endBeat: totalBeats },
      onEnded: () => {
        setPlaybackBeat(totalBeats)
        setPlaying(false)
      },
    })
  }
  playFromBeatRef.current = play
  const stop = (reset = false) => {
    const beat = previewPlayer.isPlaying() ? previewPlayer.getCurrentBeat() : playbackBeat
    previewPlayer.stop()
    setPlaying(false)
    setPlaybackBeat(reset ? 0 : Math.max(0, Math.min(totalBeats, beat)))
  }

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      if (previewPlayer.isPlaying()) {
        setPlaybackBeat(Math.max(0, Math.min(totalBeats, previewPlayer.getCurrentBeat())))
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [playing, totalBeats])

  useEffect(() => {
    previewPlayer.stop()
    setPlaying(false)
    setPlaybackBeat(0)
  }, [selectedSectionId, variant?.id, mode])

  useEffect(() => {
    const beat = Math.max(0, Math.min(totalBeats, previewStartBeat))
    setPlaybackBeat(beat)
    if (previewPlayer.isPlaying()) playFromBeatRef.current(beat)
  }, [previewStartBeat, totalBeats])

  useEffect(() => () => previewPlayer.stop(), [])

  const beginSeeking = () => {
    if (seekingRef.current) return
    seekingRef.current = true
    resumeAfterSeekRef.current = playing
    if (playing) {
      previewPlayer.stop()
      setPlaying(false)
    }
  }

  const commitSeek = (value: number) => {
    seekingRef.current = false
    const beat = Math.max(0, Math.min(totalBeats, value))
    setPlaybackBeat(beat)
    if (resumeAfterSeekRef.current) {
      resumeAfterSeekRef.current = false
      play(beat)
    }
  }

  // 候補ピルの切替(マウス)と再生(キーボード)を分担させ、試聴を繰り返す際に
  // 再生ボタンまでマウスを往復させなくて済むようにする(Space = 再生/停止のトグル)。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return
      event.preventDefault()
      // フォーカスされたボタンがSpaceキーで二重にクリックされないよう、先にフォーカスを外す
      target?.blur()
      if (!hasPlayableMaterial) return
      if (playing) stop()
      else play()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const exportMidi = () => {
    if (!hasPlayableMaterial || !selectedSectionId || !section) return
    const exportVariant = variant ? replaceVariantNotes(variant, leadNotes) : undefined
    const bytes = exportMelodyMidi({
      title: project.title,
      sectionName: section.name,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      chords,
      melody: previewLayers.melody ? exportVariant : undefined,
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

      <IconButton onClick={undo} disabled={history.length === 0} title="元に戻す">
        <Undo2 size={15} />
      </IconButton>
      <IconButton onClick={redo} disabled={future.length === 0} title="やり直す">
        <Redo2 size={15} />
      </IconButton>

      <div className="ml-auto" />

      {/* 曲全体の再生・書き出しは「アレンジ・書出し」画面の上部。ここは選択中のセクションだけを扱う */}
      {section && (
        <span className="hidden max-w-40 truncate text-[12px] text-body-muted md:inline" title="この下の再生・書き出しの対象">
          対象: {section.name}
        </span>
      )}

      {!hasPlayableMaterial && (
        <span className="hidden text-[12px] text-body-muted md:inline">
          再生するにはコードまたは候補を用意してください
        </span>
      )}

      <Select value={mode} onChange={(e) => setMode(e.target.value as PreviewMode)} className="!py-1">
        <option value="melody-only">主旋律のみ</option>
        <option value="chords-melody">コード＋主旋律</option>
        <option value="chords-only">コードのみ</option>
        <option value="accompaniment-only">伴奏パターンのみ</option>
      </Select>
      <IconButton
        onClick={playing ? () => stop() : () => play()}
        disabled={!hasPlayableMaterial}
        title={playing ? "停止 (Space)" : "このセクションを再生 (Space)"}
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
        <Download size={13} /> <span className="hidden sm:inline">セクションMIDI</span>
      </Button>

      {totalBeats > 0 && (
        <div className="order-last flex w-full basis-full items-center gap-2 pb-1 text-[12px] text-body-muted sm:pb-2">
          <span className="w-16 shrink-0 tabular-nums">
            {formatPlaybackTime(playbackBeat, project.song.tempo, selectedSectionId ? sectionTempoChanges(project, selectedSectionId) : undefined)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0.25, totalBeats)}
            step={0.25}
            value={Math.min(playbackBeat, totalBeats)}
            aria-label="主旋律の再生位置"
            className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/12 accent-primary"
            onChange={(event) => setPlaybackBeat(Number(event.currentTarget.value))}
            onPointerDown={beginSeeking}
            onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
            onPointerCancel={(event) => commitSeek(Number(event.currentTarget.value))}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) beginSeeking()
            }}
            onKeyUp={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                commitSeek(Number(event.currentTarget.value))
              }
            }}
            onBlur={(event) => {
              if (seekingRef.current) commitSeek(Number(event.currentTarget.value))
            }}
          />
          <span className="w-24 shrink-0 text-right tabular-nums">
            {Math.min(section?.lengthBars ?? 0, Math.floor(playbackBeat / beatsPerBar) + 1)} / {section?.lengthBars ?? 0}小節
          </span>
        </div>
      )}

      {historyOpen && (
        <div className="absolute bottom-full left-3 z-50 mb-1 max-h-72 w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-hairline bg-surface-tile-1 p-2 shadow-[3px_5px_30px_rgba(0,0,0,0.4)] sm:w-80">
          {sectionVariants.length === 0 && <p className="p-2 text-[13px] text-ink-soft">まだ候補がありません</p>}
          {sectionVariants.map((v) => (
            <div key={v.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover:bg-white/5">
              <button className="flex-1 truncate text-left" onClick={() => selectVariantFromHistory(v.id)}>
                {v.name} {project.activeMelodyId === v.id && "★"}
              </button>
              <span className="text-ink-soft">{v.sourceMode}</span>
              <button className="text-ink-soft hover:text-body-on-dark" onClick={() => deleteVariant(v.id)}>
                削除
              </button>
            </div>
          ))}
        </div>
      )}
    </footer>
  )
}
