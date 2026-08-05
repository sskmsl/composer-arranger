import { useEffect, useMemo, useState } from "react"
import {
  Check,
  Download,
  Heart,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from "lucide-react"
import {
  previewPlayer,
  resolveReactivePreviewRange,
  type PreviewMode,
} from "@/audio/previewPlayer"
import type {
  CounterContourPlan,
  CounterCreativeRisk,
  CounterDialogueIntent,
  CounterEndingStrategy,
  CounterOpportunityKind,
  CounterRhythmGrammar,
  ReactiveLayerCandidate,
} from "@/core/reactiveLayer"
import { parseTimeSignature } from "@/core/section"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { exportMelodyMidi, downloadMidi } from "@/midi/exportMelody"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Select } from "@/ui/primitives"
import { ReadOnlyPianoRoll } from "./AccompanimentPianoRoll"

const STYLE_LABELS: Record<string, string> = {
  "bell-response": "Bell",
  "piano-echo": "Piano",
  "string-answer": "Strings",
  "guitar-fill": "Guitar",
  "synth-whisper": "Synth",
}

const ROLE_LABELS: Record<string, string> = {
  "answer-phrase": "Answer",
  "gap-fill": "Gap Fill",
  counterline: "Counterline",
  "motif-echo": "Motif Echo",
  "suspension-layer": "Suspension",
}

const RISK_LABELS: Record<CounterCreativeRisk, string> = {
  focused: "Focused",
  bold: "Bold",
  radical: "Radical",
}

const INTENT_LABELS: Record<CounterDialogueIntent, string> = {
  answer: "Answer",
  "echo-transform": "Echo Transform",
  "counter-current": "Counter-current",
  shadow: "Shadow",
  "suspended-halo": "Suspended Halo",
  "strategic-silence": "Strategic Silence",
}

const RHYTHM_LABELS: Record<CounterRhythmGrammar, string> = {
  "breath-answer": "Breath Answer",
  "long-short": "Long–Short",
  "syncopated-reply": "Syncopated Reply",
  "displaced-cell": "Displaced Cell",
  "broken-pulse": "Broken Pulse",
  "sparse-signal": "Sparse Signal",
}

const CONTOUR_LABELS: Record<CounterContourPlan, string> = {
  "ascending-staircase": "Ascending Steps",
  "descending-staircase": "Descending Steps",
  arch: "Arch",
  "inverted-arch": "Inverted Arch",
  wave: "Wave",
  "leap-recovery": "Leap & Recovery",
  "pedal-break": "Pedal Break",
}

const ENDING_LABELS: Record<CounterEndingStrategy, string> = {
  resolved: "Resolved",
  "open-fifth": "Open Fifth",
  suspended: "Suspended",
  "motif-return": "Motif Return",
  "silence-cut": "Silence Cut",
}

const OPPORTUNITY_LABELS: Record<CounterOpportunityKind, string> = {
  "answer-needed": "Answer Needed",
  "continuation-needed": "Continuation",
  "harmonic-colour-needed": "Harmonic Colour",
  "tension-support": "Tension Support",
  "motif-recall": "Motif Recall",
  "transition-support": "Transition",
  "silence-preferred": "Silence Preferred",
}

export function CounterWorkspace() {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const activeBatchId = useProjectStore((state) => state.activeReactiveBatchId)
  const activeIndex = useProjectStore((state) => state.activeReactiveCandidateIndex)
  const generate = useProjectStore((state) => state.generateCounterForSection)
  const setActiveIndex = useProjectStore(
    (state) => state.setActiveReactiveCandidateIndex,
  )
  const regenerate = useProjectStore((state) => state.regenerateCounter)
  const setReview = useProjectStore((state) => state.setReactiveLayerReviewState)
  const assign = useProjectStore((state) => state.assignReactiveLayer)
  const workflowNotice = useProjectStore((state) => state.workflowNotice)
  const [previewMode, setPreviewMode] =
    useState<PreviewMode>("chords-melody-reactive")
  const [playingId, setPlayingId] = useState<string | null>(null)

  const section = project.sections.find(
    (candidate) => candidate.id === selectedSectionId,
  )
  const { beatsPerBar } = parseTimeSignature(project.song.timeSignature)
  const totalBeats = section ? section.lengthBars * beatsPerBar : 0
  const chords = project.chords
    .filter((chord) => chord.sectionId === selectedSectionId)
    .sort((a, b) => a.startBeat - b.startBeat)
  const activeMelodyId = selectedSectionId
    ? project.sectionMelodyAssignments[selectedSectionId]
    : undefined
  const activeMelody = project.melodyVariants.find(
    (variant) =>
      variant.id === activeMelodyId && variant.sectionId === selectedSectionId,
  )
  const chordHasError =
    chords.length > 0 && diagnoseChordInput(chords, totalBeats).hasError
  const sectionCandidates = useMemo(
    () =>
      (project.reactiveLayerCandidates ?? [])
        .filter(
          (candidate) =>
            candidate.sectionId === selectedSectionId &&
            candidate.kind === "counter" &&
            candidate.targetMelodyVariantId === activeMelodyId,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [activeMelodyId, project.reactiveLayerCandidates, selectedSectionId],
  )
  const effectiveBatchId =
    activeBatchId &&
    sectionCandidates.some((candidate) => candidate.batchId === activeBatchId)
      ? activeBatchId
      : sectionCandidates[0]?.batchId ?? null
  const batch = useMemo(
    () =>
      sectionCandidates.filter(
        (candidate) => candidate.batchId === effectiveBatchId,
      ),
    [effectiveBatchId, sectionCandidates],
  )
  const activeCandidate =
    batch[Math.min(activeIndex, Math.max(0, batch.length - 1))]
  const assignedId = selectedSectionId
    ? project.sectionReactiveLayerAssignments?.[selectedSectionId]
    : undefined

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

  const play = (candidate: ReactiveLayerCandidate) => {
    if (playingId === candidate.id) {
      stop()
      return
    }
    setActiveIndex(batch.findIndex((item) => item.id === candidate.id))
    setPlayingId(candidate.id)
    const previewRange = resolveReactivePreviewRange(
      candidate.notes,
      totalBeats,
    )
    previewPlayer.play({
      bpm: project.song.tempo,
      chords,
      melody: activeMelody?.notes ?? [],
      reactive: candidate.notes,
      mode: previewMode,
      range: previewRange,
      onEnded: () => setPlayingId(null),
    })
  }

  const exportCandidate = (candidate: ReactiveLayerCandidate) => {
    const bytes = exportMelodyMidi({
      title: project.title,
      sectionName: `${section.name} Counter`,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      chords,
      melody: activeMelody,
      reactiveNotes: candidate.notes,
      includeChords: previewMode === "chords-melody-reactive",
      range: { startBeat: 0, endBeat: totalBeats },
    })
    downloadMidi(bytes, `${project.title}-${section.name}-${candidate.name}`)
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-tile-1 p-3">
        <div className="mr-auto">
          <h2 className="text-[15px] font-semibold text-body-on-dark">
            Counter Generator
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-muted-48">
            主旋律へ何を返し、どこで黙るかまで設計した独立Counterを10案提案します
          </p>
        </div>
        <Button
          onClick={() => generate(section.id)}
          disabled={!activeMelody || chords.length === 0 || chordHasError}
        >
          <Sparkles size={14} /> Generate 10 Counters
        </Button>
      </section>

      {!activeMelody && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          Melodyタブで、このセクションのActive Melodyを設定してください。
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
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            {batch.map((candidate, index) => (
              <article
                key={candidate.id}
                className={`rounded-lg border p-3 transition ${
                  candidate.id === activeCandidate?.id
                    ? "border-primary-focus bg-primary/10"
                    : "border-hairline bg-surface-tile-1"
                }`}
              >
                <button
                  className="w-full text-left"
                  onClick={() => setActiveIndex(index)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-[13px] font-semibold text-body-on-dark">
                      {candidate.name}
                    </h3>
                    <span className="shrink-0 text-[10px] text-ink-muted-48">
                      Quality {Math.round(candidate.quality.overallQuality)}
                    </span>
                  </div>
                  {candidate.techniqueExperiment && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="rounded-full border border-primary-focus/50 px-1.5 py-0.5 text-primary-focus">
                        A/B:{" "}
                        {candidate.techniqueExperiment.mode ===
                        "baseline"
                          ? "Normal"
                          : candidate.techniqueExperiment
                              .presetLabel}
                      </span>
                      <span className="text-ink-muted-48">
                        Fit{" "}
                        {candidate.techniqueFitScore === undefined
                          ? "—"
                          : `${Math.round(
                              candidate.techniqueFitScore * 100,
                            )}%`}
                      </span>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                      {STYLE_LABELS[candidate.generatorStyle ?? ""] ?? "Counter"}
                    </span>
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                      {ROLE_LABELS[candidate.role] ?? candidate.role}
                    </span>
                    {candidate.counterPlan && (
                      <>
                        <span
                          className={`rounded-pill px-2 py-0.5 text-[10px] ${
                            candidate.counterPlan.creativeRisk === "radical"
                              ? "bg-fuchsia-400/20 text-fuchsia-200"
                              : candidate.counterPlan.creativeRisk === "bold"
                                ? "bg-orange-400/20 text-orange-200"
                                : "bg-white/6 text-body-muted"
                          }`}
                        >
                          {RISK_LABELS[candidate.counterPlan.creativeRisk]}
                        </span>
                        <span className="rounded-pill bg-primary/15 px-2 py-0.5 text-[10px] text-primary-light">
                          {INTENT_LABELS[candidate.counterPlan.dialogueIntent]}
                        </span>
                        <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                          {RHYTHM_LABELS[candidate.counterPlan.rhythmGrammar]}
                        </span>
                        <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                          {CONTOUR_LABELS[candidate.counterPlan.contour]}
                        </span>
                        <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                          {ENDING_LABELS[candidate.counterPlan.ending]}
                        </span>
                        {candidate.counterPlan.opportunityKinds?.[0] && (
                          <span className="rounded-pill bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-200">
                            {OPPORTUNITY_LABELS[
                              candidate.counterPlan.opportunityKinds[0]
                            ]}
                          </span>
                        )}
                      </>
                    )}
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                      Gap {Math.round(candidate.quality.gapUsage)}%
                    </span>
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                      MIDI{" "}
                      {candidate.notes.length > 0
                        ? `${Math.min(...candidate.notes.map((note) => note.pitch))}–${Math.max(...candidate.notes.map((note) => note.pitch))}`
                        : "—"}
                    </span>
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[10px] text-body-muted">
                      {candidate.notes.length} notes / {totalBeats} beats
                    </span>
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[10px] ${
                        candidate.collisions.hasBlockingCollision
                          ? "bg-red-400/15 text-red-300"
                          : "bg-emerald-400/10 text-emerald-200"
                      }`}
                    >
                      {candidate.collisions.hasBlockingCollision
                        ? "Collision warning"
                        : "Collision clear"}
                    </span>
                    {assignedId === candidate.id && (
                      <span className="rounded-pill bg-primary/20 px-2 py-0.5 text-[10px] text-primary">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-2 truncate text-[10px] text-ink-muted-48">
                    Target: {activeMelody?.name ?? candidate.targetMelodyVariantId}
                  </p>
                  {candidate.counterQuality && (
                    <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-ink-muted-48">
                      <span>Dialogue {Math.round(candidate.counterQuality.dialogueClarity)}</span>
                      <span>Independent {Math.round(candidate.counterQuality.independence)}</span>
                      <span>Rhythm {Math.round(candidate.counterQuality.rhythmicCharacter)}</span>
                      <span>Necessity {Math.round(candidate.counterQuality.emotionalNecessity)}</span>
                      <span>Audacity {Math.round(candidate.counterQuality.audacity)}</span>
                      <span>Control {Math.round(candidate.counterQuality.controlledRisk)}</span>
                      {candidate.counterQuality.harmonicNarrative !== undefined && (
                        <span>Harmony {Math.round(candidate.counterQuality.harmonicNarrative)}</span>
                      )}
                      {candidate.counterQuality.melodicComplement !== undefined && (
                        <span>Complement {Math.round(candidate.counterQuality.melodicComplement)}</span>
                      )}
                      {candidate.counterQuality.placementPurpose !== undefined && (
                        <span>Purpose {Math.round(candidate.counterQuality.placementPurpose)}</span>
                      )}
                    </div>
                  )}
                </button>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  <Button
                    variant="dark"
                    className="!px-2 !text-[11px]"
                    onClick={() => play(candidate)}
                  >
                    {playingId === candidate.id ? (
                      <Square size={12} />
                    ) : (
                      <Play size={12} />
                    )}
                    試聴
                  </Button>
                  <Button
                    variant="dark"
                    className="!px-2 !text-[11px]"
                    onClick={() => regenerate(candidate.id)}
                  >
                    <RefreshCw size={12} /> 再生成
                  </Button>
                  <Button
                    variant="dark"
                    className="!px-2 !text-[11px]"
                    onClick={() => exportCandidate(candidate)}
                  >
                    <Download size={12} /> MIDI
                  </Button>
                  <Button
                    variant="dark"
                    className="!px-2 !text-[11px]"
                    onClick={() =>
                      setReview(
                        candidate.id,
                        candidate.reviewState === "favorite" ? null : "favorite",
                      )
                    }
                  >
                    <Heart size={12} /> Favorite
                  </Button>
                  <Button
                    variant="dark"
                    className="!px-2 !text-[11px]"
                    onClick={() =>
                      setReview(
                        candidate.id,
                        candidate.reviewState === "rejected" ? null : "rejected",
                      )
                    }
                  >
                    <X size={12} /> Reject
                  </Button>
                  <Button
                    variant="secondary"
                    className="!px-2 !text-[11px]"
                    onClick={() => assign(candidate.id)}
                  >
                    <Check size={12} /> Set Active
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-ink-muted-48">試聴:</span>
            <span className="text-[10px] text-ink-muted-48">
              候補の前後だけを自動再生
            </span>
            <Select
              value={previewMode}
              onChange={(event) => {
                stop()
                setPreviewMode(event.target.value as PreviewMode)
              }}
              className="!py-1"
            >
              <option value="reactive-only">Counter Only</option>
              <option value="melody-reactive">Melody + Counter</option>
              <option value="chords-melody-reactive">
                Chords + Melody + Counter
              </option>
            </Select>
          </div>
        </>
      )}

      {activeCandidate ? (
        <ReadOnlyPianoRoll
          notes={activeCandidate.notes}
          chords={chords}
          totalBeats={totalBeats}
          timeSignature={project.song.timeSignature}
          songKey={project.song.key}
          title={activeCandidate.name}
          subtitle="表示専用 · MIDI出力と同一"
          accentColor="#b38cff"
          accentStroke="#ddc8ff"
          ariaLabel="Counter Candidate Piano Roll"
          noteLabel="Counter Candidate"
        />
      ) : (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-tile-1 text-center">
          <div>
            <p className="text-[13px] text-body-muted">
              まだCounter候補がありません
            </p>
            <p className="mt-1 text-[11px] text-ink-muted-48">
              Active Melodyを尊重する独立した10案を生成します
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
