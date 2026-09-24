import { useEffect, useMemo, useRef, useState } from "react"
import { songTempoChanges } from "@/core/tempoMap"
import { Download, Play, Square, Volume2, VolumeX } from "lucide-react"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import type { ArrangementTrackId } from "@/core/arrangementGeneration"
import { arrangementStructureChangeLabel } from "@/ai-arranger/structureChanges"
import {
  arrangementSoundInstructionFromText,
  arrangementSoundInstructionLabel,
} from "@/core/arrangementIntent"
import { previewPlayer } from "@/audio/previewPlayer"
import { formatPlaybackTime } from "@/audio/fullSongPreview"
import { downloadMidi } from "@/midi/exportMelody"
import { arrangementTrackPlacement, exportArrangementTrackMidi } from "@/midi/exportArrangement"
import { useProjectStore } from "@/store/useProjectStore"
import { Button } from "@/ui/primitives"

type AuditionMix = "source" | "combined" | "generated"

const AUDITION_MIX_LABEL: Record<AuditionMix, string> = {
  source: "原曲のみ",
  combined: "原曲＋AI生成",
  generated: "AI生成のみ",
}

/**
 * アレンジ画面「詳しい調整」の中の、パート別の確認と書き出し。
 * 原曲との聴き比べ、パートごとのミュート・単独試聴・MIDI保存だけを扱う
 * (全曲アレンジを作る・変えるのは、方向選びとアレンジ相談で行う)。
 */
export function FullSongArrangementPanel() {
  const project = useProjectStore((state) => state.project)
  const setMuted = useProjectStore((state) => state.setArrangementTrackMuted)
  const arrangement = project.fullSongArrangement
  const timelineConstraints = arrangement?.plan.directive?.timelineConstraints
  const hasTimelineInstructions = Boolean(
    (timelineConstraints?.melodyStartBar && timelineConstraints.melodyStartBar > 1)
    || timelineConstraints?.fullSilenceRanges.length
    || timelineConstraints?.melodySilenceRanges.length,
  )
  const appliedSoundInstruction = arrangement?.plan.directive?.soundInstruction
    ?? (arrangement ? arrangementSoundInstructionFromText(`${arrangement.plan.brief} ${arrangement.plan.directive?.intention ?? ""}`) : undefined)
  const [playingTrack, setPlayingTrack] = useState<ArrangementTrackId | "all" | null>(null)
  const [playbackBeat, setPlaybackBeat] = useState(0)
  const [auditionMix, setAuditionMix] = useState<AuditionMix>("combined")
  const playbackRunRef = useRef(0)
  const seekingRef = useRef(false)
  const material = useMemo(
    () => buildSongPlaybackMaterial(project, arrangement?.plan.directive?.timelineConstraints),
    [arrangement?.plan.directive?.timelineConstraints, project],
  )

  const stop = (reset = false) => {
    const currentBeat = previewPlayer.isPlaying()
      ? previewPlayer.getCurrentBeat()
      : playbackBeat
    playbackRunRef.current += 1
    previewPlayer.stop()
    setPlayingTrack(null)
    setPlaybackBeat(reset ? 0 : Math.max(0, Math.min(material.totalBeats, currentBeat)))
  }

  useEffect(() => () => {
    playbackRunRef.current += 1
    previewPlayer.stop()
  }, [])

  useEffect(() => {
    if (!playingTrack) return
    const timer = window.setInterval(() => {
      if (seekingRef.current || !previewPlayer.isPlaying()) return
      setPlaybackBeat(Math.max(0, Math.min(material.totalBeats, previewPlayer.getCurrentBeat())))
    }, 100)
    return () => window.clearInterval(timer)
  }, [material.totalBeats, playingTrack])

  const playNotes = (
    trackId: ArrangementTrackId | "all",
    requestedStartBeat = playbackBeat,
    mix: AuditionMix = auditionMix,
  ) => {
    if (!arrangement) return
    const tracks = trackId === "all"
      ? arrangement.tracks.filter((track) => !track.muted)
      : arrangement.tracks.filter((track) => track.id === trackId)
    const sourceHasNotes = material.melody.length > 0 || material.importedBacking.length > 0 || material.chords.length > 0
    const generatedHasNotes = tracks.some((track) => track.notes.length > 0)
    if (trackId === "all") {
      if (mix === "source" && !sourceHasNotes) return
      if (mix === "generated" && !generatedHasNotes) return
      if (mix === "combined" && !sourceHasNotes && !generatedHasNotes) return
    } else if (!generatedHasNotes) return
    const startBeat = requestedStartBeat >= material.totalBeats ? 0 : requestedStartBeat
    const runId = playbackRunRef.current + 1
    playbackRunRef.current = runId
    setAuditionMix(mix)
    setPlaybackBeat(startBeat)
    setPlayingTrack(trackId)
    const includeSource = trackId !== "all" || mix !== "generated"
    const includeGenerated = trackId !== "all" || mix !== "source"
    const importedSource = project.sourceImport?.type === "midi"
    previewPlayer.playContinuous({
      bpm: project.song.tempo,
      tempoChanges: songTempoChanges(project),
      // Imported MIDIでは、推定コードを合成し直さず実際の原演奏を比較対象にする。
      chords: includeSource && !importedSource ? material.chords : [],
      accompaniment: includeSource
        ? importedSource ? material.importedBacking : material.accompanimentPattern
        : [],
      arrangementTracks: includeGenerated ? tracks : [],
      mode: trackId === "all" && includeSource ? "chords-melody" : "melody-only",
      melody: trackId === "all" && includeSource ? material.melody : [],
      startBeat,
      range: { startBeat, endBeat: material.totalBeats },
      onEnded: () => {
        if (playbackRunRef.current !== runId) return
        setPlaybackBeat(material.totalBeats)
        setPlayingTrack(null)
      },
    })
  }

  const beginSeeking = () => {
    if (seekingRef.current) return
    seekingRef.current = true
    if (playingTrack) {
      playbackRunRef.current += 1
      previewPlayer.stop()
    }
  }

  const commitSeek = (value: number) => {
    const wasSeeking = seekingRef.current
    seekingRef.current = false
    const beat = Math.max(0, Math.min(material.totalBeats, value))
    setPlaybackBeat(beat)
    if (wasSeeking && playingTrack) playNotes(playingTrack, beat, auditionMix)
  }

  return (
    arrangement && (
        <div className="flex min-w-0 max-w-full flex-col gap-4">
          {timelineConstraints && hasTimelineInstructions && (
            <div className="rounded-md border border-emerald-300/25 bg-emerald-400/[0.07] px-3 py-2.5 text-[13px] text-emerald-50">
              <strong className="font-semibold">指定した小節を反映済み</strong>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-emerald-100/85">
                <span>主旋律の音程・リズムは変更しません</span>
                {timelineConstraints.melodyStartBar && timelineConstraints.melodyStartBar > 1 && (
                  <span>主旋律：{timelineConstraints.melodyStartBar}小節目から</span>
                )}
                {timelineConstraints.fullSilenceRanges.length > 0 && (
                  <span>
                    完全無音：{timelineConstraints.fullSilenceRanges.map((range) =>
                      range.startBar === range.endBar ? `${range.startBar}小節` : `${range.startBar}〜${range.endBar}小節`,
                    ).join("、")}
                  </span>
                )}
                {timelineConstraints.melodySilenceRanges.length > 0 && (
                  <span>
                    主旋律を休む：{timelineConstraints.melodySilenceRanges.map((range) =>
                      range.startBar === range.endBar ? `${range.startBar}小節` : `${range.startBar}〜${range.endBar}小節`,
                    ).join("、")}
                  </span>
                )}
              </div>
            </div>
          )}
          {(arrangement.plan.directive?.structureChanges?.length ?? 0) > 0 && (
            <div className="rounded-md border border-sky-300/25 bg-sky-400/[0.07] px-3 py-2.5 text-[13px] text-sky-50">
              <strong className="font-semibold">曲構成へ反映済み</strong>
              <div className="mt-1 text-[12px] text-sky-100/85">
                {arrangement.plan.directive?.structureChanges?.map(arrangementStructureChangeLabel).join(" ／ ")}
              </div>
            </div>
          )}
          {appliedSoundInstruction && (
            <div className="rounded-md border border-violet-300/25 bg-violet-400/[0.07] px-3 py-2.5 text-[13px] text-violet-50">
              <strong className="font-semibold">指定を音へ反映済み</strong>
              <span className="ml-2 text-[12px] text-violet-100/85">{arrangementSoundInstructionLabel(appliedSoundInstruction)}</span>
            </div>
          )}
          <div className="rounded-lg border border-primary/30 bg-primary/[0.055] p-3">
            <h4 className="text-[13px] font-semibold text-body-on-dark">原曲と聴き比べる</h4>
            <p className="mt-1 text-[12px] leading-4 text-body-muted">
              「原曲＋AI生成」で、原曲を変えずに足したパートだけを重ねて確認できます。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {(["source", "combined", "generated"] as const).map((mix) => {
                const isPlaying = playingTrack === "all" && auditionMix === mix
                return (
                  <Button
                    key={mix}
                    variant={mix === "combined" ? "primary" : "dark"}
                    className="w-full"
                    onClick={isPlaying ? () => stop() : () => playNotes("all", playbackBeat, mix)}
                  >
                    {isPlaying ? <Square size={14} /> : <Play size={14} />}
                    {isPlaying ? "停止" : AUDITION_MIX_LABEL[mix]}
                  </Button>
                )
              })}
            </div>
            <div className="mt-3 rounded-md border border-hairline bg-black/15 px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px] text-body-muted">
                <span>{AUDITION_MIX_LABEL[auditionMix]}の再生位置</span>
                <span className="shrink-0 tabular-nums text-body-on-dark">
                  {formatPlaybackTime(playbackBeat, project.song.tempo, songTempoChanges(project))} / {formatPlaybackTime(material.totalBeats, project.song.tempo, songTempoChanges(project))}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0.25, material.totalBeats)}
                step={0.25}
                value={Math.min(playbackBeat, material.totalBeats)}
                aria-label="生成前後を聴き比べる再生位置"
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/12 accent-primary"
                onChange={(event) => setPlaybackBeat(Number(event.currentTarget.value))}
                onPointerDown={beginSeeking}
                onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
                onPointerCancel={(event) => commitSeek(Number(event.currentTarget.value))}
                onKeyDown={(event) => {
                  if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) beginSeeking()
                }}
                onKeyUp={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return
                  commitSeek(Number(event.currentTarget.value))
                }}
                onBlur={(event) => commitSeek(Number(event.currentTarget.value))}
              />
            </div>
            <p className="mt-2 text-[12px] text-body-muted">
              {project.sourceImport?.type === "midi"
                ? "原曲側は、MIDIから読み込んだ主旋律と伴奏ノートをそのまま使用します。"
                : "原曲側は、現在のコード・主旋律・採用中の伴奏を使用します。"}
            </p>
          </div>


          <section className="space-y-3" aria-labelledby="generated-parts-heading">
            <div>
              <h4 id="generated-parts-heading" className="text-[13px] font-semibold text-body-on-dark">パートごとに確認する</h4>
              <p className="mt-1 text-[12px] leading-4 text-body-muted">
                パートごとにミュート・単独試聴・MIDI保存ができます。全パートをまとめた書き出しは、画面上部の「曲全体MIDI」です。
                個別MIDIは曲中の位置を保っているので、Logic Proではすべて1小節目に置いてください。
              </p>
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
            {arrangement.tracks.map((track) => {
              const placement = arrangementTrackPlacement(project, track)
              return <article key={track.id} className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md border border-hairline bg-surface-tile-1 p-3">
                <button title={track.muted ? "ミュート解除" : "ミュート"} aria-label={`${track.name}を${track.muted ? "ミュート解除" : "ミュート"}`} onClick={() => setMuted(track.id, !track.muted)} className="text-body-muted hover:text-body-on-dark">
                  {track.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{track.name}</p>
                  <p className="truncate text-[12px] text-body-muted">{track.notes.length}音 · {track.purpose}</p>
                  {placement && (
                    <p className="truncate text-[12px] text-sky-100">
                      Logic配置: {placement.importBar}小節目 · 最初の音: {placement.firstSoundingBar}小節目
                    </p>
                  )}
                </div>
                <button title="単独で試聴" aria-label={`${track.name}を単独で試聴`} onClick={() => playingTrack === track.id ? stop() : playNotes(track.id)} className="rounded-full p-2 text-primary-on-dark hover:bg-white/8">
                  {playingTrack === track.id ? <Square size={14} /> : <Play size={14} />}
                </button>
                <button title="MIDI保存（Logicの1小節目へ配置）" aria-label={`${track.name}のMIDIを保存`} onClick={() => downloadMidi(exportArrangementTrackMidi(project, arrangement, track.id), `${track.name}-bar-1`)} className="rounded-full p-2 text-primary-on-dark hover:bg-white/8">
                  <Download size={14} />
                </button>
              </article>
            })}
            </div>
          </section>
        </div>
    )
  )
}
