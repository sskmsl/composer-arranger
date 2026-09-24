import { useEffect, useMemo, useState } from "react"
import { Check, Download, Play, RefreshCw, Sparkles, Square } from "lucide-react"
import { previewPlayer, type PreviewMode } from "@/audio/previewPlayer"
import type { PhraseContour } from "@/core/melody"
import type { PhraseCandidate, PhraseLengthBars } from "@/core/phrase"
import { parseTimeSignature } from "@/core/section"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { exportMelodyMidi, downloadMidi } from "@/midi/exportMelody"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Select } from "@/ui/primitives"
import { ReadOnlyPianoRoll } from "./AccompanimentPianoRoll"
import {
  DirectorRecommendationBadge,
  PerformanceReviewBadge,
} from "./PerformanceReviewBadge"
import { ArrangementNecessityBadge } from "./ArrangementNecessityBadge"
import { EmptySectionState } from "./EmptySectionState"
import { CandidatePlacementHint } from "./CandidatePlacementHint"
import { CandidatePicker } from "./CandidatePicker"

const CONTOUR_LABELS: Record<PhraseContour, string> = {
  ascending: "上がっていく",
  descending: "下がっていく",
  arch: "上がって戻る",
  "inverted-arch": "下がって戻る",
  wave: "上下に動く",
}

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
  const toggleAssignment = useProjectStore((state) => state.togglePhraseAssignment)
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
  const assignedId = selectedSectionId
    ? project.sectionPhraseAssignments?.[selectedSectionId]
    : undefined
  const effectiveBatchId =
    activeBatchId && sectionCandidates.some((candidate) => candidate.batchId === activeBatchId)
      ? activeBatchId
      : sectionCandidates.find((candidate) => candidate.id === assignedId)?.batchId ??
        sectionCandidates[0]?.batchId ??
        null
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
    return <EmptySectionState title="短いフレーズを作るセクションが必要です" />
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

  const generateControls = (
    <>
    <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
      長さ
      <Select
        value={lengthChoice}
        onChange={(event) => setLengthChoice(event.target.value as LengthChoice)}
        className="!py-1"
      >
        <option value="auto">自動</option>
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
        <Sparkles size={14} /> {batch.length > 0 ? "作り直す" : "フレーズ候補を生成"}
      </Button>
    </>
  )
  const activePosition = activeCandidate
    ? batch.findIndex((candidate) => candidate.id === activeCandidate.id)
    : -1

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* 主旋律と同じ並び: 候補番号 → 選んだ候補の操作 → ピアノロール */}
      <section className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-tile-1 p-3">
        {batch.length > 0 ? (
          <CandidatePicker
            items={batch.map((candidate) => ({
              id: candidate.id,
              adopted: assignedId === candidate.id,
            }))}
            activeId={activeCandidate?.id}
            onSelect={setActiveIndex}
            trailing={generateControls}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[13px] text-body-muted">
              コードとセクションの役割から、Logic Proで組み合わせられる2〜8小節の独立した着想を作ります
            </p>
            {generateControls}
          </div>
        )}
        {activeCandidate && (
          <div className="flex flex-col gap-2 border-t border-hairline pt-3">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[13px] font-semibold text-body-on-dark">
                候補 {activePosition + 1}
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[12px] text-body-muted">
                {activeCandidate.intent.lengthBars}小節
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[12px] text-body-muted">
                品質 {Math.round(activeCandidate.qualityScore)}
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[12px] text-body-muted">
                {CONTOUR_LABELS[activeCandidate.intent.contour]}
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[12px] text-body-muted">
                {RHYTHM_LABELS[activeCandidate.intent.rhythmCharacter]}
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[12px] text-body-muted">
                {HARMONY_LABELS[activeCandidate.intent.harmonicApproach]}
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[12px] text-body-muted">
                {CADENCE_LABELS[activeCandidate.intent.cadence]}
              </span>
              {activeCandidate.techniqueExperiment && (
                <span
                  className="rounded-pill border border-primary-focus/50 px-2 py-0.5 text-[12px] text-primary-on-dark"
                  title={
                    activeCandidate.techniqueFitScore === undefined
                      ? undefined
                      : `適合 ${Math.round(activeCandidate.techniqueFitScore * 100)}%`
                  }
                >
                  比較:{" "}
                  {activeCandidate.techniqueExperiment.mode === "baseline"
                    ? "通常"
                    : activeCandidate.techniqueExperiment.presetLabel}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ArrangementNecessityBadge necessity={activeCandidate.arrangementNecessity} compact />
              <PerformanceReviewBadge
                review={project.candidatePerformanceReviews?.[activeCandidate.id]}
                compact
              />
              <DirectorRecommendationBadge
                recommendation={project.performanceBatchRecommendations?.[activeCandidate.batchId]}
                candidateId={activeCandidate.id}
              />
            </div>
            <CandidatePlacementHint
              section={section}
              notes={activeCandidate.notes}
              beatsPerBar={beatsPerBar}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant={assignedId === activeCandidate.id ? "secondary" : "primary"}
                onClick={() => toggleAssignment(activeCandidate.id)}
              >
                <Check size={13} />
                {assignedId === activeCandidate.id ? "採用中(外す)" : "全曲に採用"}
              </Button>
              <Button variant="dark" onClick={() => play(activeCandidate)}>
                {playingId === activeCandidate.id ? <Square size={12} /> : <Play size={12} />}
                試聴
              </Button>
              <Button
                variant="dark"
                onClick={() => {
                  if (playingId === activeCandidate.id) stop()
                  regenerate(activeCandidate.id)
                }}
              >
                <RefreshCw size={12} /> この案を再生成
              </Button>
              <Button variant="dark" onClick={() => exportCandidate(activeCandidate)}>
                <Download size={12} /> MIDI
              </Button>
            </div>
          </div>
        )}
      </section>

      {section.lengthBars < 2 && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-200">
          フレーズ生成には2小節以上のセクションが必要です。
        </p>
      )}
      {allChords.length === 0 && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-200">
          左パネルの「コード進行」を入力すると、フレーズ候補を生成できます。
        </p>
      )}
      {chordHasError && (
        <p className="rounded-sm border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-300">
          無効なコードがあります。左のパネルで修正してください。
        </p>
      )}
      {workflowNotice && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-200">
          {workflowNotice}
        </p>
      )}

      {activeCandidate ? (
        <>
          <ReadOnlyPianoRoll
            notes={activeCandidate.notes}
            chords={phraseChords}
            totalBeats={activeCandidate.phraseLengthBeats}
            timeSignature={project.song.timeSignature}
            songKey={section?.key?.trim() || project.song.key}
            title={`候補 ${activePosition + 1}`}
            subtitle="表示専用 · MIDI出力と同じ内容"
            accentColor="#4ea8de"
            accentStroke="#90d7ff"
            ariaLabel="短いフレーズ候補のピアノロール"
            noteLabel="短いフレーズ"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-emerald-200">
              採用した候補は曲全体再生と曲全体MIDIに入ります
            </span>
            <span className="text-[12px] text-ink-soft">試聴方法</span>
            <Select
              value={previewMode}
              onChange={(event) => {
                stop()
                setPreviewMode(event.target.value as PreviewMode)
              }}
              className="!py-1"
            >
              <option value="melody-only">フレーズのみ</option>
              <option value="chords-melody">コード＋フレーズ</option>
            </Select>
          </div>
        </>
      ) : (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-tile-1 text-center">
          <div>
            <p className="text-[13px] text-body-muted">まだフレーズ候補がありません</p>
            <p className="mt-1 text-[12px] text-ink-soft">
              現在のコード進行から、始まり・展開・着地点を持つ3案を生成します
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
