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
import { EmptySectionState } from "./EmptySectionState"
import { CandidatePlacementHint } from "./CandidatePlacementHint"
import { CandidatePicker } from "./CandidatePicker"

const TYPE_LABELS: Record<string, string> = {
  "decorative-fill": "短い装飾",
  "transition-fill": "場面をつなぐ",
  "ending-fill": "終わりを彩る",
}

const SHAPE_LABELS: Record<string, string> = {
  rising: "上昇",
  falling: "下降",
  sequence: "音型を繰り返す",
  "repeated-sequence": "反復",
  turn: "折り返す",
  "neighbor-motion": "隣の音へ動く",
  "arpeggiated-fill": "分散和音",
  suspense: "余韻を残す",
  "sparse-accent": "一音を置く",
}

const CHARACTER_LABELS: Record<string, string> = {
  strings: "ストリングス",
  bell: "ベル",
  piano: "ピアノ",
  generic: "その他",
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
    return <EmptySectionState title="装飾を作るセクションが必要です" />
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

  const generateButton = (
    <Button
      onClick={() => generate(section.id, settings)}
      disabled={chords.length === 0 || chordHasError}
    >
      <Sparkles size={14} /> {batch.length > 0 ? "作り直す" : "装飾候補を生成"}
    </Button>
  )
  const activePosition = activeCandidate
    ? batch.findIndex((candidate) => candidate.id === activeCandidate.id)
    : -1
  const activePlan = activeCandidate?.decorationPlan

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* 主旋律と同じ並び: 候補番号 → 選んだ候補の操作 → ピアノロール */}
      <section className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-tile-1 p-3">
        {batch.length > 0 ? (
          <CandidatePicker
            items={batch.map((candidate) => ({
              id: candidate.id,
              adopted: assignedId === candidate.id,
              favorite: candidate.reviewState === "favorite",
              rejected: candidate.reviewState === "rejected",
            }))}
            activeId={activeCandidate?.id}
            onSelect={setActiveIndex}
            trailing={generateButton}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[12px] text-body-muted">
              主旋律の隙間やセクションの切り替わりに置く、短い演出を提案します
            </p>
            {generateButton}
          </div>
        )}
        {/* 設定は「自動」のままで足りることが多いので、閉じておく */}
        <details className="group">
          <summary className="cursor-pointer select-none text-[12px] text-body-muted hover:text-body-on-dark">
            生成の設定
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <label className="text-[11px] text-ink-muted-48">
              種類
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
                <option value="auto">自動</option>
                <option value="decorative-fill">短い装飾</option>
                <option value="transition-fill">場面をつなぐ</option>
                <option value="ending-fill">終わりを彩る</option>
              </Select>
            </label>
            <label className="text-[11px] text-ink-muted-48">
              音色
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
                <option value="auto">自動</option>
                <option value="strings">ストリングス</option>
                <option value="bell">ベル</option>
                <option value="piano">ピアノ</option>
                <option value="generic">その他</option>
              </Select>
            </label>
            <label className="text-[11px] text-ink-muted-48">
              長さ
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
                <option value="2">2拍</option>
                <option value="4">4拍</option>
                <option value="bar">1小節</option>
              </Select>
            </label>
            <label className="text-[11px] text-ink-muted-48">
              音の量
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
                <option value="sparse">少なめ</option>
                <option value="normal">標準</option>
                <option value="rich">多め</option>
              </Select>
            </label>
            <label className="text-[11px] text-ink-muted-48">
              音の動き
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
                <option value="auto">自動</option>
                <option value="rising">上昇</option>
                <option value="falling">下降</option>
                <option value="mixed">上下に動く</option>
              </Select>
            </label>
            <label className="text-[11px] text-ink-muted-48">
              別案番号
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
        </details>
        {activeCandidate && (
          <div className="flex flex-col gap-2 border-t border-hairline pt-3">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[13px] font-semibold text-body-on-dark">
                候補 {activePosition + 1}
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                {activeCandidate.notes.length}音
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                {TYPE_LABELS[activePlan?.type ?? ""] ?? "装飾"}
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                {SHAPE_LABELS[activePlan?.shape ?? ""] ?? activePlan?.shape}
              </span>
              <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                {CHARACTER_LABELS[activePlan?.character ?? ""] ?? "その他"}
              </span>
              {activeCandidate.collisions.hasBlockingCollision && (
                <span className="rounded-pill bg-red-400/15 px-2 py-0.5 text-[11px] text-red-300">
                  主旋律とぶつかる可能性
                </span>
              )}
            </div>
            <CandidatePlacementHint
              section={section}
              notes={activeCandidate.notes}
              beatsPerBar={beatsPerBar}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant={assignedId === activeCandidate.id ? "secondary" : "primary"}
                onClick={() => assign(activeCandidate.id)}
              >
                <Check size={13} />
                {assignedId === activeCandidate.id ? "採用中(外す)" : "全曲に採用"}
              </Button>
              <Button variant="dark" onClick={() => play(activeCandidate)}>
                {playingId === activeCandidate.id ? <Square size={12} /> : <Play size={12} />}
                試聴
              </Button>
              <Button variant="dark" onClick={() => regenerate(activeCandidate.id)}>
                <RefreshCw size={12} /> この案を再生成
              </Button>
              <Button variant="dark" onClick={() => exportCandidate(activeCandidate)}>
                <Download size={12} /> MIDI
              </Button>
              <Button
                variant="dark"
                aria-pressed={activeCandidate.reviewState === "favorite"}
                onClick={() =>
                  setReview(
                    activeCandidate.id,
                    activeCandidate.reviewState === "favorite" ? null : "favorite",
                  )
                }
              >
                <Heart size={12} className={activeCandidate.reviewState === "favorite" ? "fill-current" : ""} /> お気に入り
              </Button>
              <Button
                variant="dark"
                aria-pressed={activeCandidate.reviewState === "rejected"}
                onClick={() =>
                  setReview(
                    activeCandidate.id,
                    activeCandidate.reviewState === "rejected" ? null : "rejected",
                  )
                }
              >
                <X size={12} /> {activeCandidate.reviewState === "rejected" ? "却下を取り消す" : "却下"}
              </Button>
            </div>
          </div>
        )}
      </section>

      {chords.length === 0 && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          左パネルの「コード進行」を入力すると、装飾候補を生成できます。
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

      {activeCandidate ? (
        <>
          <ReadOnlyPianoRoll
            notes={activeCandidate.notes}
            chords={chords}
            totalBeats={totalBeats}
            timeSignature={project.song.timeSignature}
            songKey={section?.key?.trim() || project.song.key}
            title={`候補 ${activePosition + 1}`}
            subtitle="表示専用 · MIDI出力と同じ内容"
            accentColor="#4fd1b5"
            accentStroke="#a5f3df"
            ariaLabel="装飾候補のピアノロール"
            noteLabel="装飾"
          />
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
              <option value="reactive-only">装飾のみ</option>
              <option value="chords-reactive">コード＋装飾</option>
              {activeMelody && (
                <option value="chords-melody-reactive">
                  コード＋主旋律＋装飾
                </option>
              )}
            </Select>
          </div>
        </>
      ) : (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-tile-1 text-center">
          <div>
            <p className="text-[13px] text-body-muted">
              まだ装飾フレーズ候補がありません
            </p>
            <p className="mt-1 text-[11px] text-ink-muted-48">
              コードとセクションの切り替わりから候補を生成します
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
