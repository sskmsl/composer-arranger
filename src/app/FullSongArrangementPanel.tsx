import { useEffect, useMemo, useRef, useState } from "react"
import { Download, Play, RefreshCw, Square, Volume2, VolumeX } from "lucide-react"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import type { ArrangementTrackId } from "@/core/arrangementGeneration"
import { previewPlayer } from "@/audio/previewPlayer"
import { fullSongPreviewRanges, type PreviewBeatRange } from "@/audio/fullSongPreview"
import { downloadMidi } from "@/midi/exportMelody"
import { exportArrangementMidi, exportArrangementTrackMidi } from "@/midi/exportArrangement"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Select } from "@/ui/primitives"

const CHARACTER_LABEL = { safe: "Safe", edge: "Edge", surprise: "Surprise", silence: "無音" }

export function FullSongArrangementPanel() {
  const project = useProjectStore((state) => state.project)
  const generate = useProjectStore((state) => state.generateFullSongArrangement)
  const regenerate = useProjectStore((state) => state.regenerateFullSongArrangementTarget)
  const setMuted = useProjectStore((state) => state.setArrangementTrackMuted)
  const arrangement = project.fullSongArrangement
  const [playingTrack, setPlayingTrack] = useState<ArrangementTrackId | "all" | null>(null)
  const [targetSectionId, setTargetSectionId] = useState<string>("")
  const [regenerating, setRegenerating] = useState(false)
  const [generationNotice, setGenerationNotice] = useState<string | null>(null)
  const playbackRunRef = useRef(0)
  const material = useMemo(() => buildSongPlaybackMaterial(project), [project])

  const stop = () => {
    playbackRunRef.current += 1
    previewPlayer.stop()
    setPlayingTrack(null)
  }

  useEffect(() => () => {
    playbackRunRef.current += 1
    previewPlayer.stop()
  }, [])

  const playRangeSequence = (
    trackId: ArrangementTrackId | "all",
    tracks: NonNullable<typeof arrangement>["tracks"],
    ranges: PreviewBeatRange[],
    index: number,
    runId: number,
  ) => {
    if (playbackRunRef.current !== runId || index >= ranges.length) {
      if (playbackRunRef.current === runId) setPlayingTrack(null)
      return
    }
    previewPlayer.play({
      bpm: project.song.tempo,
      chords: material.chords,
      accompaniment: material.accompanimentPattern,
      arrangementTracks: tracks,
      mode: trackId === "all" ? "chords-melody" : "melody-only",
      melody: trackId === "all" ? material.lead : [],
      range: ranges[index],
      onEnded: () => playRangeSequence(trackId, tracks, ranges, index + 1, runId),
    })
  }

  const playNotes = (trackId: ArrangementTrackId | "all") => {
    if (!arrangement) return
    const tracks = trackId === "all"
      ? arrangement.tracks.filter((track) => !track.muted)
      : arrangement.tracks.filter((track) => track.id === trackId)
    if (tracks.every((track) => track.notes.length === 0)) return
    const ranges = fullSongPreviewRanges(material.totalBeats)
    if (ranges.length === 0) return
    const runId = playbackRunRef.current + 1
    playbackRunRef.current = runId
    setPlayingTrack(trackId)
    playRangeSequence(trackId, tracks, ranges, 0, runId)
  }

  const rebuild = async () => {
    if (regenerating) return
    stop()
    setRegenerating(true)
    setGenerationNotice(null)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      generate()
      setGenerationNotice("新しいrevisionで全曲案を作り直しました。")
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <section className="rounded-lg border border-primary/35 bg-primary/[0.055] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-on-dark">Arrangement Generator</p>
          <h3 className="mt-1 text-[16px] font-semibold">曲全体を解釈して、必要な役割だけをMIDI化</h3>
          <p className="mt-1 text-[12px] leading-5 text-body-muted">
            コード・保護中のMelody・Section・制作意図を先に分析し、Energy CurveとPlanを確定してから独立トラックを生成します。
          </p>
        </div>
        <Button onClick={() => void rebuild()} disabled={regenerating || project.sections.length === 0 || project.chords.length === 0}>
          <RefreshCw size={14} className={regenerating ? "animate-spin" : ""} /> {regenerating ? "全曲案を生成中…" : arrangement ? "全曲案を作り直す" : "全曲Arrangementを生成"}
        </Button>
      </div>

      {generationNotice && (
        <p className="mt-3 rounded-sm border border-emerald-300/25 bg-emerald-400/[0.07] px-3 py-2 text-[11px] text-emerald-100">
          {generationNotice}
        </p>
      )}

      {!arrangement ? (
        <div className="mt-4 rounded-md border border-dashed border-hairline p-5 text-[12px] text-body-muted">
          生成前です。AI Partnerで保持した制作意図もArrangement Planへ反映されます。Melodyは変更しません。
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-black/15 p-3">
            <span className="text-[12px] text-body-muted">Energy Curve</span>
            {arrangement.analysis.sections.map((section) => (
              <span key={section.sectionId} className="rounded-full bg-white/7 px-2.5 py-1 text-[11px]">
                {section.sectionName} <b className="text-primary-on-dark">{section.energy}</b>
              </span>
            ))}
          </div>

          <details open className="rounded-md border border-hairline bg-black/10 p-3">
            <summary className="cursor-pointer text-[13px] font-semibold">Arrangement Plan</summary>
            <div className="mt-3 grid gap-2 xl:grid-cols-2">
              {arrangement.plan.sections.map((section) => (
                <article key={section.sectionId} className="rounded-md border border-hairline bg-white/[0.025] p-3">
                  <div className="flex items-center gap-2">
                    <strong className="text-[13px]">{section.sectionName}</strong>
                    <span className="text-[11px] text-body-muted">Energy {section.energy} · {section.density}</span>
                    <span className="ml-auto rounded-full border border-primary/30 px-2 py-0.5 text-[11px] text-primary-on-dark">
                      {CHARACTER_LABEL[section.selectedTransitionCharacter]}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-body-muted">{section.intention}</p>
                  <p className="mt-2 text-[11px] text-body-muted">
                    {section.activeRoles.map((role) => arrangement.tracks.find((track) => track.id === role)?.name ?? role).join(" · ")}
                  </p>
                  {section.transitionCandidates.some((candidate) => candidate.character === section.selectedTransitionCharacter) && (
                    <p className="mt-2 border-l-2 border-primary/50 pl-2 text-[11px] leading-4 text-body-muted">
                      {section.transitionCandidates.find((candidate) => candidate.character === section.selectedTransitionCharacter)?.reason}
                    </p>
                  )}
                  {section.decorationCandidates.some((candidate) => candidate.character === section.selectedDecorationCharacter) && (
                    <p className="mt-1 border-l-2 border-violet-300/50 pl-2 text-[11px] leading-4 text-body-muted">
                      装飾: {section.decorationCandidates.find((candidate) => candidate.character === section.selectedDecorationCharacter)?.reason}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(["safe", "edge", "surprise"] as const).map((character) => (
                      <button
                        key={character}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                          section.selectedTransitionCharacter === character
                            ? "border-primary bg-primary/15 text-primary-on-dark"
                            : "border-hairline text-body-muted hover:border-primary/40 hover:text-body-on-dark"
                        }`}
                        onClick={() => {
                          regenerate({ trackId: "syn-transition-phrase", sectionId: section.sectionId, character })
                          regenerate({ trackId: "syn-high-glass", sectionId: section.sectionId, character })
                        }}
                      >
                        {CHARACTER_LABEL[character]}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="dark" onClick={playingTrack ? stop : () => playNotes("all")}>
              {playingTrack ? <Square size={14} /> : <Play size={14} />}
              {playingTrack ? "停止" : "全パートを試聴"}
            </Button>
            <Button variant="dark" onClick={() => downloadMidi(exportArrangementMidi(project, arrangement), `${project.title}-arrangement`)}>
              <Download size={14} /> 全パートMIDI
            </Button>
            <label className="ml-auto flex items-center gap-2 text-[11px] text-body-muted">
              部分再生成
              <Select value={targetSectionId} onChange={(event) => setTargetSectionId(event.target.value)}>
                <option value="">トラック全体</option>
                {arrangement.plan.sections.map((section) => <option key={section.sectionId} value={section.sectionId}>{section.sectionName}</option>)}
              </Select>
            </label>
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            {arrangement.tracks.map((track) => (
              <article key={track.id} className="flex items-center gap-2 rounded-md border border-hairline bg-surface-tile-1 p-3">
                <button title={track.muted ? "Mute解除" : "Mute"} onClick={() => setMuted(track.id, !track.muted)} className="text-body-muted hover:text-body-on-dark">
                  {track.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">{track.name}</p>
                  <p className="truncate text-[11px] text-body-muted">{track.notes.length} notes · {track.purpose}</p>
                </div>
                <button title="試聴" onClick={() => playingTrack === track.id ? stop() : playNotes(track.id)} className="rounded-full p-2 text-primary-on-dark hover:bg-white/8">
                  {playingTrack === track.id ? <Square size={14} /> : <Play size={14} />}
                </button>
                <button title={targetSectionId ? "選択Sectionだけ再生成" : "このトラックだけ再生成"} onClick={() => regenerate({ trackId: track.id, sectionId: targetSectionId || undefined })} className="rounded-full p-2 text-primary-on-dark hover:bg-white/8">
                  <RefreshCw size={14} />
                </button>
                <button title="このトラックをMIDI出力" onClick={() => downloadMidi(exportArrangementTrackMidi(project, arrangement, track.id), track.name)} className="rounded-full p-2 text-primary-on-dark hover:bg-white/8">
                  <Download size={14} />
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
