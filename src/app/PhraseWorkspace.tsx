import { useEffect, useMemo, useState } from "react"
import { Download, Play, RefreshCw, Sparkles, Square } from "lucide-react"
import { previewPlayer, type PreviewMode } from "@/audio/previewPlayer"
import type { PhraseCandidate, PhraseLengthBars } from "@/core/phrase"
import { parseTimeSignature } from "@/core/section"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { exportMelodyMidi, downloadMidi } from "@/midi/exportMelody"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Select } from "@/ui/primitives"
import { ReadOnlyPianoRoll } from "./AccompanimentPianoRoll"

const RHYTHM_LABELS: Record<PhraseCandidate["intent"]["rhythmCharacter"], string> = {
  flowing: "流れるリズム",
  syncopated: "シンコペーション",
  breathing: "余白と呼吸",
  sustained: "ロングトーン",
}

const HARMONY_LABELS: Record<PhraseCandidate["intent"]["harmonicApproach"], string> = {
  "chord-anchored": "コードを軸に展開",
  "common-tone": "共通音を保持",
  "tension-release": "緊張から解決",
  anticipatory: "次コードを先取り",
}

const CADENCE_LABELS: Record<PhraseCandidate["intent"]["cadence"], string> = {
  resolved: "解決",
  open: "余韻",
  suspended: "未解決",
  "carry-forward": "次へ接続",
}

type LengthChoice = "auto" | `${PhraseLengthBars}`

export function PhraseWorkspace() {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const activeBatchId = useProjectStore((state) => state.activePhraseBatchId)
  const activeIndex = useProjectStore((state) => state.activePhraseCandidateIndex)
  const generate = useProjectStore((state) => state.generatePhrasesForSection)
  const setActiveIndex = useProjectStore((state) => state.setActivePhraseCandidateIndex)
  const regenerate = useProjectStore((state) => state.regeneratePhrase)
  const workflowNotice = useProjectStore((state) => state.workflowNotice)
  const [lengthChoice, setLengthChoice] = useState<LengthChoice>("auto")
  const [previewMode, setPreviewMode] = useState<PreviewMode>("chords-melody")
  const [playingId, setPlayingId] = useState<string | null>(null)

  const section = project.sections.find((candidate) => candidate.id === selectedSectionId)
  const { beatsPerBar } = parseTimeSignature(project.song.timeSignature)
  const sectionBeats = section ? section.lengthBars * beatsPerBar : 0
  const allChords = project.chords
    .filter((chord) => chord.sectionId === selectedSectionId)
    .sort((a, b) => a.startBeat - b.startBeat)
  const chordHasError = allChords.length > 0 && diagnoseChordInput(allChords, sectionBeats).hasError

  const sectionCandidates = useMemo(
    () =>
      project.phraseCandidates
        .filter((candidate) => candidate.sectionId === selectedSectionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [project.phraseCandidates, selectedSectionId],
  )
  const effectiveBatchId =
    activeBatchId && sectionCandidates.some((candidate) => candidate.batchId === activeBatchId)
      ? activeBatchId
      : sectionCandidates[0]?.batchId ?? null
  const batch = useMemo(
    () =>
      sectionCandidates
        .filter((candidate) => candidate.batchId === effectiveBatchId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [effectiveBatchId, sectionCandidates],
  )
  const activeCandidate = batch[Math.min(activeIndex, Math.max(0, batch.length - 1))]
  const phraseChords = activeCandidate
    ? allChords.filter((chord) => chord.startBeat < activeCandidate.phraseLengthBeats)
    : []

  useEffect(
    () => () => {
      previewPlayer.stop()
    },
    [],
  )

  if (!section) {
    return (
      <main className="flex flex-1 items-center justify-center text-ink-muted-48">
        左のパネルからセクションを選択してください
      </main>
    )
  }

  const stop = () => {
    previewPlayer.stop()
    setPlayingId(null)
  }

  const play = (candidate: PhraseCandidate) => {
    if (playingId === candidate.id) {
      stop()
      return
    }
    setActiveIndex(batch.findIndex((item) => item.id === candidate.id))
    setPlayingId(candidate.id)
    previewPlayer.play({
      bpm: project.song.tempo,
      chords: allChords.filter((chord) => chord.startBeat < candidate.phraseLengthBeats),
      melody: candidate.notes,
      mode: previewMode,
      range: { startBeat: 0, endBeat: candidate.phraseLengthBeats },
      onEnded: () => setPlayingId(null),
    })
  }

  const exportCandidate = (candidate: PhraseCandidate) => {
    const bytes = exportMelodyMidi({
      title: project.title,
      sectionName: `${section.name} Phrase`,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      chords: allChords,
      melodyNotes: candidate.notes,
      leadTrackName: "Phrase",
      includeChords: previewMode !== "melody-only",
      range: { startBeat: 0, endBeat: candidate.phraseLengthBeats },
    })
    downloadMidi(bytes, `${project.title}-${section.name}-${candidate.name}`)
  }

  const requestedLength =
    lengthChoice === "auto" ? undefined : (Number(lengthChoice) as PhraseLengthBars)
  const maxLength = Math.min(8, section.lengthBars)

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-tile-1 p-3">
        <div className="mr-auto">
          <h2 className="text-[15px] font-semibold text-body-on-dark">Phrase Ideas</h2>
          <p className="mt-0.5 text-[11px] text-ink-muted-48">
            コードとセクションの役割から、Logic Proで組み合わせられる2〜8小節の独立した着想を作ります
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-muted-48">
          長さ
          <Select
            value={lengthChoice}
            onChange={(event) => setLengthChoice(event.target.value as LengthChoice)}
            className="!py-1"
          >
            <option value="auto">Auto</option>
            {[2, 3, 4, 5, 6, 7, 8].map((bars) => (
              <option key={bars} value={bars} disabled={bars > maxLength}>
                {bars}小節
              </option>
            ))}
          </Select>
        </label>
        <Button
          onClick={() => generate(section.id, requestedLength)}
          disabled={section.lengthBars < 2 || allChords.length === 0 || chordHasError}
        >
          <Sparkles size={14} /> Generate Phrases
        </Button>
      </section>

      {section.lengthBars < 2 && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          フレーズ生成には2小節以上のセクションが必要です。
        </p>
      )}
      {chordHasError && (
        <p className="rounded-sm border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-red-300">
          無効なコードがあります。左のパネルで修正してください。
        </p>
      )}
      {workflowNotice && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          {workflowNotice}
        </p>
      )}

      {batch.length > 0 && (
        <>
          <div className="grid gap-2 lg:grid-cols-3">
            {batch.map((candidate, index) => (
              <article
                key={candidate.id}
                className={`rounded-lg border p-3 transition ${
                  candidate.id === activeCandidate?.id
                    ? "border-primary-focus bg-primary/10"
                    : "border-hairline bg-surface-tile-1"
                }`}
              >
                <button className="w-full text-left" onClick={() => setActiveIndex(index)}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold text-body-on-dark">{candidate.name}</h3>
                    <span className="text-[10px] text-ink-muted-48">
                      {candidate.intent.lengthBars}小節 · Quality {Math.round(candidate.qualityScore)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                      {candidate.intent.contour}
                    </span>
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                      {RHYTHM_LABELS[candidate.intent.rhythmCharacter]}
                    </span>
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                      {HARMONY_LABELS[candidate.intent.harmonicApproach]}
                    </span>
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                      {CADENCE_LABELS[candidate.intent.cadence]}
                    </span>
                  </div>
                </button>
                <div className="mt-3 flex gap-1.5">
                  <Button variant="dark" className="min-w-0 flex-1 !px-2 !text-[11px]" onClick={() => play(candidate)}>
                    {playingId === candidate.id ? <Square size={12} /> : <Play size={12} />}
                    試聴
                  </Button>
                  <Button
                    variant="dark"
                    className="min-w-0 flex-1 !px-2 !text-[11px]"
                    onClick={() => {
                      if (playingId === candidate.id) stop()
                      regenerate(candidate.id)
                    }}
                  >
                    <RefreshCw size={12} /> 再生成
                  </Button>
                  <Button
                    variant="dark"
                    className="min-w-0 flex-1 !px-2 !text-[11px]"
                    onClick={() => exportCandidate(candidate)}
                  >
                    <Download size={12} /> MIDI
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-ink-muted-48">試聴:</span>
            <Select
              value={previewMode}
              onChange={(event) => {
                stop()
                setPreviewMode(event.target.value as PreviewMode)
              }}
              className="!py-1"
            >
              <option value="melody-only">Phrase Only</option>
              <option value="chords-melody">Chords + Phrase</option>
            </Select>
          </div>
        </>
      )}

      {activeCandidate ? (
        <ReadOnlyPianoRoll
          notes={activeCandidate.notes}
          chords={phraseChords}
          totalBeats={activeCandidate.phraseLengthBeats}
          timeSignature={project.song.timeSignature}
          songKey={project.song.key}
          title={activeCandidate.name}
          subtitle="表示専用 · MIDI出力と同一"
          accentColor="#4ea8de"
          accentStroke="#90d7ff"
          ariaLabel="Phrase Candidate Piano Roll"
          noteLabel="Phrase Candidate"
        />
      ) : (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-tile-1 text-center">
          <div>
            <p className="text-[13px] text-body-muted">まだフレーズ候補がありません</p>
            <p className="mt-1 text-[11px] text-ink-muted-48">
              現在のコード進行から、始まり・展開・着地点を持つ3案を生成します
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
