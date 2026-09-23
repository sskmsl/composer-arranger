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
  CounterCreativeRisk,
  ReactiveLayerCandidate,
} from "@/core/reactiveLayer"
import { parseTimeSignature } from "@/core/section"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { buildReactiveContextAuditionMaterial } from "@/core/reactiveContextAudition"
import { exportMelodyMidi, downloadMidi } from "@/midi/exportMelody"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Select } from "@/ui/primitives"
import { ReadOnlyPianoRoll } from "./AccompanimentPianoRoll"
import { EmptySectionState } from "./EmptySectionState"
import { CandidatePlacementHint } from "./CandidatePlacementHint"

const STYLE_LABELS: Record<string, string> = {
  "bell-response": "ベル",
  "piano-echo": "ピアノ",
  "string-answer": "ストリングス",
  "guitar-fill": "ギター",
  "synth-whisper": "シンセ",
}

const ROLE_LABELS: Record<string, string> = {
  "answer-phrase": "主旋律に応える",
  "gap-fill": "隙間を補う",
  counterline: "別の旋律",
  "motif-echo": "主旋律を少し引用",
  "suspension-layer": "長い音で支える",
}

const RISK_LABELS: Record<CounterCreativeRisk, string> = {
  focused: "安定",
  bold: "大胆",
  radical: "冒険的",
}

const CONTOUR_LABELS: Record<string, string> = {
  "ascending-staircase": "少しずつ上がる",
  "descending-staircase": "少しずつ下がる",
  arch: "上がって戻る",
  "inverted-arch": "下がって戻る",
  wave: "上下に動く",
  "leap-recovery": "跳躍して戻る",
  "pedal-break": "同じ音から動く",
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
    return <EmptySectionState title="対旋律を作るセクションが必要です" />
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
    const bytes = exportMelodyMidi({
      title: project.title,
      sectionName: `${section.name} Counter`,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      chords,
      melody: activeMelody,
      reactiveNotes: candidate.notes,
      includeChords:
        previewMode === "chords-melody-reactive" ||
        previewMode === "active-context-reactive",
      range: { startBeat: 0, endBeat: totalBeats },
    })
    downloadMidi(bytes, `${project.title}-${section.name}-${candidate.name}`)
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-tile-1 p-3">
        <div className="mr-auto">
          <h2 className="text-[15px] font-semibold text-body-on-dark">
            対旋律
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-muted-48">
            主旋律の隙間に入り、受け答えする別の旋律を10案生成します
          </p>
        </div>
        <Button
          onClick={() => generate(section.id)}
          disabled={!activeMelody || chords.length === 0 || chordHasError}
        >
          <Sparkles size={14} /> 対旋律を10候補生成
        </Button>
      </section>

      {!activeMelody && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          「詳細調整 → 主旋律」で、このセクションに採用する主旋律を設定してください。
        </p>
      )}
      {chords.length === 0 && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          左パネルの「コード進行」を入力すると、対旋律候補を生成できます。
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
                      候補 {index + 1}
                    </h3>
                    <span className="shrink-0 text-[11px] text-ink-muted-48">
                      {candidate.notes.length}音
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                      {STYLE_LABELS[candidate.generatorStyle ?? ""] ?? "対旋律"}
                    </span>
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                      {ROLE_LABELS[candidate.role] ?? candidate.role}
                    </span>
                    {candidate.counterPlan && (
                      <>
                        <span
                          className={`rounded-pill px-2 py-0.5 text-[11px] ${
                            candidate.counterPlan.creativeRisk === "radical"
                              ? "bg-fuchsia-400/20 text-fuchsia-200"
                              : candidate.counterPlan.creativeRisk === "bold"
                                ? "bg-orange-400/20 text-orange-200"
                                : "bg-white/6 text-body-muted"
                          }`}
                        >
                          {RISK_LABELS[candidate.counterPlan.creativeRisk]}
                        </span>
                        <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                          {CONTOUR_LABELS[candidate.counterPlan.contour]}
                        </span>
                      </>
                    )}
                    {candidate.collisions.hasBlockingCollision && (
                      <span className="rounded-pill bg-red-400/15 px-2 py-0.5 text-[11px] text-red-300">
                        主旋律とぶつかる可能性
                      </span>
                    )}
                    {assignedId === candidate.id && (
                      <span className="rounded-pill bg-primary/20 px-2 py-0.5 text-[11px] text-primary-on-dark">
                        採用済み
                      </span>
                    )}
                  </div>
                  <CandidatePlacementHint
                    section={section}
                    notes={candidate.notes}
                    beatsPerBar={beatsPerBar}
                  />
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
                    <Check size={12} />
                    {assignedId === candidate.id ? "採用を外す" : "全曲に採用"}
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-emerald-200">
              採用した候補は曲全体再生と曲全体MIDIに入ります
            </span>
            <span className="text-[11px] text-ink-muted-48">試聴方法</span>
            <Select
              value={previewMode}
              onChange={(event) => {
                stop()
                setPreviewMode(event.target.value as PreviewMode)
              }}
              className="!py-1"
            >
              <option value="active-context-reactive">
                現在の伴奏と一緒
              </option>
              <option value="reactive-only">対旋律のみ</option>
              <option value="melody-reactive">主旋律＋対旋律</option>
              <option value="chords-melody-reactive">
                コード＋主旋律＋対旋律
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
          songKey={section?.key?.trim() || project.song.key}
          title={`候補 ${batch.findIndex((candidate) => candidate.id === activeCandidate.id) + 1}`}
          subtitle="表示専用 · MIDI出力と同じ内容"
          accentColor="#b38cff"
          accentStroke="#ddc8ff"
          ariaLabel="Counter Candidate Piano Roll"
          noteLabel="Counter Candidate"
        />
      ) : (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-tile-1 text-center">
          <div>
            <p className="text-[13px] text-body-muted">
              まだ対旋律候補がありません
            </p>
            <p className="mt-1 text-[11px] text-ink-muted-48">
              主旋律の隙間に入る10案を生成します
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
