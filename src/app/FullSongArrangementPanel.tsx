import { useEffect, useMemo, useRef, useState } from "react"
import { songTempoChanges } from "@/core/tempoMap"
import { Download, Play, Square, Volume2, VolumeX } from "lucide-react"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import type { ArrangementTrackId } from "@/core/arrangementGeneration"
import { arrangementTrackColor, arrangementTrackLabel, arrangementTrackOrder } from "@/core/arrangementChat"
import { previewPlayer } from "@/audio/previewPlayer"
import { downloadMidi } from "@/midi/exportMelody"
import { exportArrangementTrackMidi } from "@/midi/exportArrangement"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * アレンジ画面「詳しい調整」の、パートごとの確認と書き出し。
 * ミュート・単独再生・MIDI保存だけを扱う(全曲アレンジを作る・変えるのは、方向選びとアレンジ相談で行う)。
 */
export function FullSongArrangementPanel() {
  const project = useProjectStore((state) => state.project)
  const setMuted = useProjectStore((state) => state.setArrangementTrackMuted)
  const arrangement = project.fullSongArrangement
  const [playingTrack, setPlayingTrack] = useState<ArrangementTrackId | null>(null)
  const playbackRunRef = useRef(0)
  const material = useMemo(
    () => buildSongPlaybackMaterial(project, arrangement?.plan.directive?.timelineConstraints),
    [arrangement?.plan.directive?.timelineConstraints, project],
  )
  const tracks = useMemo(
    () => [...(arrangement?.tracks ?? [])].sort((a, b) => arrangementTrackOrder(a.id) - arrangementTrackOrder(b.id)),
    [arrangement?.tracks],
  )

  const stop = () => {
    playbackRunRef.current += 1
    previewPlayer.stop()
    setPlayingTrack(null)
  }

  useEffect(() => () => {
    playbackRunRef.current += 1
    previewPlayer.stop()
  }, [])

  const playTrack = (trackId: ArrangementTrackId) => {
    const track = arrangement?.tracks.find((item) => item.id === trackId)
    if (!track || track.notes.length === 0) return
    const runId = playbackRunRef.current + 1
    playbackRunRef.current = runId
    setPlayingTrack(trackId)
    previewPlayer.playContinuous({
      bpm: project.song.tempo,
      tempoChanges: songTempoChanges(project),
      chords: [],
      accompaniment: [],
      arrangementTracks: [track],
      mode: "melody-only",
      melody: [],
      startBeat: 0,
      range: { startBeat: 0, endBeat: material.totalBeats },
      onEnded: () => {
        if (playbackRunRef.current !== runId) return
        setPlayingTrack(null)
      },
    })
  }

  if (!arrangement) return null
  return (
    <section className="flex min-w-0 max-w-full flex-col gap-3" aria-labelledby="generated-parts-heading">
      <div>
        <h3 id="generated-parts-heading" className="text-[14px] font-semibold text-body-on-dark">パートごとに聴く・書き出す</h3>
        <p className="mt-1 text-[13px] leading-5 text-body-muted">
          全パートをまとめた書き出しは、画面上部の「曲全体MIDI」です。1パートだけのMIDIは、Logic Proの1小節目に置いてください。
        </p>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {tracks.map((track) => {
          const label = arrangementTrackLabel(track.id)
          const playing = playingTrack === track.id
          return (
            <article
              key={track.id}
              className={`flex min-w-0 items-center gap-2 rounded-md border border-hairline bg-surface-tile-1 px-3 py-2 ${track.muted ? "opacity-55" : ""}`}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: arrangementTrackColor(track.id) }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-body-on-dark">{label}</p>
                {track.muted && <p className="text-[12px] text-ink-soft">ミュート中（曲全体の再生とMIDIに入りません）</p>}
              </div>
              <button
                type="button"
                title={track.muted ? "ミュートを解除" : "ミュート"}
                aria-label={`${label}を${track.muted ? "ミュート解除" : "ミュート"}`}
                aria-pressed={track.muted}
                onClick={() => setMuted(track.id, !track.muted)}
                className="rounded-full p-2 text-body-muted hover:bg-white/8 hover:text-body-on-dark"
              >
                {track.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <button
                type="button"
                title={playing ? "停止" : "このパートだけ再生"}
                aria-label={playing ? `${label}の再生を停止` : `${label}だけ再生`}
                onClick={() => playing ? stop() : playTrack(track.id)}
                className="rounded-full p-2 text-primary-on-dark hover:bg-white/8"
              >
                {playing ? <Square size={15} /> : <Play size={15} />}
              </button>
              <button
                type="button"
                title="このパートのMIDIを保存"
                aria-label={`${label}のMIDIを保存`}
                onClick={() => downloadMidi(exportArrangementTrackMidi(project, arrangement, track.id), `${track.name}-bar-1`)}
                className="rounded-full p-2 text-primary-on-dark hover:bg-white/8"
              >
                <Download size={15} />
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}
