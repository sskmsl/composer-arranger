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
import type { ReactiveLayerCandidate } from "@/core/reactiveLayer"
import { parseTimeSignature } from "@/core/section"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { buildReactiveContextAuditionMaterial } from "@/core/reactiveContextAudition"
import {
  DEFAULT_DECORATION_SETTINGS,
  type DecorationSettings,
} from "@/melody-engine/decorationGenerator"
import { exportMelodyMidi, downloadMidi } from "@/midi/exportMelody"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Select, TextInput } from "@/ui/primitives"
import { ReadOnlyPianoRoll } from "./AccompanimentPianoRoll"
import {
  DirectorRecommendationBadge,
  PerformanceReviewBadge,
} from "./PerformanceReviewBadge"
import { ArrangementNecessityBadge } from "./ArrangementNecessityBadge"

const TYPE_LABELS: Record<string, string> = {
  "decorative-fill": "Decorative",
  "transition-fill": "Transition",
  "ending-fill": "Ending",
}

const SHAPE_LABELS: Record<string, string> = {
  rising: "Rising",
  falling: "Falling",
  sequence: "Sequence",
  "repeated-sequence": "Repeated Sequence",
  turn: "Turn",
  "neighbor-motion": "Neighbor",
  "arpeggiated-fill": "Arpeggio",
  suspense: "Suspense",
  "sparse-accent": "Sparse Accent",
}

const GESTURE_LABELS: Record<string, string> = {
  response: "Response",
  transition: "Transition",
  ending: "Ending",
  swell: "Swell",
  pedal: "Pedal",
  pickup: "Pickup",
}

const NEED_LABELS: Record<string, string> = {
  recommended: "Recommended",
  optional: "Optional",
  silence: "Silence First",
}

export function DecorationWorkspace() {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const activeBatchId = useProjectStore((state) => state.activeReactiveBatchId)
  const activeIndex = useProjectStore((state) => state.activeReactiveCandidateIndex)
  const generate = useProjectStore((state) => state.generateDecorationsForSection)
  const regenerate = useProjectStore((state) => state.regenerateDecoration)
  const setActiveIndex = useProjectStore(
    (state) => state.setActiveReactiveCandidateIndex,
  )
  const setReview = useProjectStore((state) => state.setReactiveLayerReviewState)
  const assign = useProjectStore((state) => state.assignReactiveLayer)
  const workflowNotice = useProjectStore((state) => state.workflowNotice)
  const [settings, setSettings] = useState<DecorationSettings>(
    DEFAULT_DECORATION_SETTINGS,
  )
  const [previewMode, setPreviewMode] =
    useState<PreviewMode>("active-context-reactive")
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
            candidate.kind === "decoration",
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [project.reactiveLayerCandidates, selectedSectionId],
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
    ? project.sectionDecorationLayerAssignments?.[selectedSectionId]
    : undefined

  useEffect(
    () => () => {
      previewPlayer.stop()
    },
    [],
  )

  useEffect(() => {
    setPreviewMode("active-context-reactive")
  }, [activeMelody, selectedSectionId])

  if (!section) {
    return (
      <main className="flex flex-1 items-center justify-center text-ink-muted-48">
        左のパネルからセクションを選択してください
      </main>
    )
  }

  const updateSetting = <K extends keyof DecorationSettings>(
    key: K,
    value: DecorationSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }))

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
    const contextMaterial = buildReactiveContextAuditionMaterial(
      project,
      section.id,
      candidate,
    )
    const useActiveContext = previewMode === "active-context-reactive"
    previewPlayer.play({
      bpm: project.song.tempo,
      chords,
      melody: useActiveContext
        ? contextMaterial.melody
        : activeMelody?.notes ?? [],
      accompaniment: useActiveContext
        ? contextMaterial.accompaniment
        : [],
      reactive: useActiveContext
        ? contextMaterial.reactive
        : candidate.notes,
      mode: previewMode,
      range: previewRange,
      onEnded: () => setPlayingId(null),
    })
  }

  const exportCandidate = (candidate: ReactiveLayerCandidate) => {
    const includeMelody =
      previewMode === "chords-melody-reactive" ||
      previewMode === "active-context-reactive"
    const bytes = exportMelodyMidi({
      title: project.title,
      sectionName: `${section.name} Decoration`,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      chords,
      melody: includeMelody ? activeMelody : undefined,
      includeLeadTrack: includeMelody,
      reactiveNotes: candidate.notes,
      reactiveTrackName: "Decoration",
      includeChords:
        previewMode === "chords-reactive" ||
        previewMode === "chords-melody-reactive" ||
        previewMode === "active-context-reactive",
      range: { startBeat: 0, endBeat: totalBeats },
    })
    downloadMidi(bytes, `${project.title}-${section.name}-${candidate.name}`)
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <section className="rounded-lg border border-hairline bg-surface-tile-1 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="text-[15px] font-semibold text-body-on-dark">
              Decoration Generator
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-muted-48">
              Silence GateとPhrase Boundaryを判断し、6つの役割から採用価値のある10 Gestureを提案します
            </p>
          </div>
          <Button
            onClick={() => generate(section.id, settings)}
            disabled={chords.length === 0 || chordHasError}
          >
            <Sparkles size={14} /> Generate Decorations
          </Button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-[11px] text-ink-muted-48">
            Type
            <Select
              value={settings.type}
              onChange={(event) =>
                updateSetting(
                  "type",
                  event.target.value as DecorationSettings["type"],
                )
              }
              className="mt-1 w-full"
            >
              <option value="auto">Auto</option>
              <option value="decorative-fill">Decorative Fill</option>
              <option value="transition-fill">Transition Fill</option>
              <option value="ending-fill">Ending Fill</option>
            </Select>
          </label>
          <label className="text-[11px] text-ink-muted-48">
            Character
            <Select
              value={settings.character}
              onChange={(event) =>
                updateSetting(
                  "character",
                  event.target.value as DecorationSettings["character"],
                )
              }
              className="mt-1 w-full"
            >
              <option value="auto">Auto</option>
              <option value="strings">Strings</option>
              <option value="bell">Bell</option>
              <option value="piano">Piano</option>
              <option value="generic">Generic</option>
            </Select>
          </label>
          <label className="text-[11px] text-ink-muted-48">
            Length
            <Select
              value={String(settings.length)}
              onChange={(event) =>
                updateSetting(
                  "length",
                  event.target.value === "bar"
                    ? "bar"
                    : (Number(event.target.value) as 2 | 4),
                )
              }
              className="mt-1 w-full"
            >
              <option value="2">2 Beats</option>
              <option value="4">4 Beats</option>
              <option value="bar">1 Bar</option>
            </Select>
          </label>
          <label className="text-[11px] text-ink-muted-48">
            Density
            <Select
              value={settings.density}
              onChange={(event) =>
                updateSetting(
                  "density",
                  event.target.value as DecorationSettings["density"],
                )
              }
              className="mt-1 w-full"
            >
              <option value="sparse">Sparse</option>
              <option value="normal">Normal</option>
              <option value="rich">Rich</option>
            </Select>
          </label>
          <label className="text-[11px] text-ink-muted-48">
            Direction
            <Select
              value={settings.direction}
              onChange={(event) =>
                updateSetting(
                  "direction",
                  event.target.value as DecorationSettings["direction"],
                )
              }
              className="mt-1 w-full"
            >
              <option value="auto">Auto</option>
              <option value="rising">Rising</option>
              <option value="falling">Falling</option>
              <option value="mixed">Mixed</option>
            </Select>
          </label>
          <label className="text-[11px] text-ink-muted-48">
            Random Seed
            <TextInput
              type="number"
              value={settings.seed ?? 71}
              onChange={(event) =>
                updateSetting("seed", Number(event.target.value) || 1)
              }
              className="mt-1 w-full"
            />
          </label>
        </div>
      </section>

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
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            {batch.map((candidate, index) => {
              const plan = candidate.decorationPlan
              return (
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
                      <h3 className="truncate text-[12px] font-semibold text-body-on-dark">
                        {candidate.name}
                      </h3>
                      <span className="shrink-0 text-[11px] text-ink-muted-48">
                        {Math.round(candidate.quality.overallQuality)}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <PerformanceReviewBadge
                        review={project.candidatePerformanceReviews?.[candidate.id]}
                        compact
                      />
                      <DirectorRecommendationBadge
                        recommendation={project.performanceBatchRecommendations?.[candidate.batchId]}
                        candidateId={candidate.id}
                      />
                    </div>
                    {candidate.techniqueExperiment && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded-full border border-primary-focus/50 px-1.5 py-0.5 text-primary-on-dark">
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
                                candidate.techniqueFitScore *
                                  100,
                              )}%`}
                        </span>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                        {TYPE_LABELS[plan?.type ?? ""] ?? "Decoration"}
                      </span>
                      <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                        {SHAPE_LABELS[plan?.shape ?? ""] ?? plan?.shape}
                      </span>
                      <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                        {plan?.rhythmStyle}
                      </span>
                      <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                        {GESTURE_LABELS[plan?.gestureRole ?? ""] ??
                          "Gesture"}
                      </span>
                      <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                        {plan?.lengthBeats ?? 0} beats
                      </span>
                      <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                        {NEED_LABELS[plan?.needLevel ?? ""] ?? "Optional"}
                      </span>
                      {candidate.activeContextFit && (
                        <span className={`rounded-pill px-2 py-0.5 text-[11px] ${candidate.activeContextFit.fitScore >= 85 ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`}>
                          Active共存 {candidate.activeContextFit.fitScore}
                        </span>
                      )}
                      {candidate.negativeSpaceFit && (
                        <span className={`rounded-pill px-2 py-0.5 text-[11px] ${candidate.negativeSpaceFit.fitScore >= 70 ? "bg-cyan-400/10 text-cyan-200" : "bg-amber-400/10 text-amber-200"}`}>
                          余白 {candidate.negativeSpaceFit.fitScore}
                        </span>
                      )}
                      {candidate.roleComplementarityFit && (
                        <span className={`rounded-pill px-2 py-0.5 text-[11px] ${candidate.roleComplementarityFit.fitScore >= 75 ? "bg-violet-400/10 text-violet-200" : "bg-amber-400/10 text-amber-200"}`}>
                          役割差 {candidate.roleComplementarityFit.fitScore}
                        </span>
                      )}
                      <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                        MIDI{" "}
                        {candidate.notes.length > 0
                          ? `${Math.min(...candidate.notes.map((note) => note.pitch))}–${Math.max(...candidate.notes.map((note) => note.pitch))}`
                          : "—"}
                      </span>
                      <span
                        className={`rounded-pill px-2 py-0.5 text-[11px] ${
                          candidate.collisions.hasBlockingCollision
                            ? "bg-red-400/15 text-red-300"
                            : "bg-emerald-400/10 text-emerald-200"
                        }`}
                      >
                        {candidate.collisions.hasBlockingCollision
                          ? "Collision warning"
                          : `${candidate.notes.length} notes`}
                      </span>
                      {assignedId === candidate.id && (
                        <span className="rounded-pill bg-primary/20 px-2 py-0.5 text-[11px] text-primary-on-dark">
                          Active
                        </span>
                      )}
                    </div>
                    <ArrangementNecessityBadge
                      necessity={candidate.arrangementNecessity}
                    />
                    <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-ink-muted-48">
                      {plan?.intention}
                    </p>
                  </button>
                  <div className="mt-3 grid grid-cols-2 gap-1">
                    <Button
                      variant="dark"
                      className="!px-2 !text-[11px]"
                      onClick={() => play(candidate)}
                    >
                      {playingId === candidate.id ? (
                        <Square size={11} />
                      ) : (
                        <Play size={11} />
                      )}
                      試聴
                    </Button>
                    <Button
                      variant="dark"
                      className="!px-2 !text-[11px]"
                      onClick={() => regenerate(candidate.id)}
                    >
                      <RefreshCw size={11} /> 再生成
                    </Button>
                    <Button
                      variant="dark"
                      className="!px-2 !text-[11px]"
                      onClick={() => exportCandidate(candidate)}
                    >
                      <Download size={11} /> MIDI
                    </Button>
                    <Button
                      variant="dark"
                      className="!px-2 !text-[11px]"
                      onClick={() =>
                        setReview(
                          candidate.id,
                          candidate.reviewState === "favorite"
                            ? null
                            : "favorite",
                        )
                      }
                    >
                      <Heart size={11} /> Favorite
                    </Button>
                    <Button
                      variant="dark"
                      className="!px-2 !text-[11px]"
                      onClick={() =>
                        setReview(
                          candidate.id,
                          candidate.reviewState === "rejected"
                            ? null
                            : "rejected",
                        )
                      }
                    >
                      <X size={11} /> Reject
                    </Button>
                    <Button
                      variant="secondary"
                      className="!px-2 !text-[11px]"
                      onClick={() => assign(candidate.id)}
                    >
                      <Check size={11} /> Set Active
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-ink-muted-48">試聴:</span>
            <span className="text-[11px] text-ink-muted-48">
              {previewMode === "active-context-reactive"
                ? "現在のPattern・Active Counterを含む"
                : "候補の前後だけを自動再生"}
            </span>
            <Select
              value={previewMode}
              onChange={(event) => {
                stop()
                setPreviewMode(event.target.value as PreviewMode)
              }}
              className="!py-1"
            >
              <option value="active-context-reactive">
                Full Active Context
              </option>
              <option value="reactive-only">Decoration Only</option>
              <option value="chords-reactive">Chords + Decoration</option>
              {activeMelody && (
                <option value="chords-melody-reactive">
                  Chords + Melody + Decoration
                </option>
              )}
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
          subtitle="Structure Driven · MIDI出力と同一"
          accentColor="#4fd1b5"
          accentStroke="#a5f3df"
          ariaLabel="Decoration Candidate Piano Roll"
          noteLabel="Decoration Candidate"
        />
      ) : (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-tile-1 text-center">
          <div>
            <p className="text-[13px] text-body-muted">
              まだDecoration候補がありません
            </p>
            <p className="mt-1 text-[11px] text-ink-muted-48">
              Active Melodyなしでも、セクション構造とコードから生成できます
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
