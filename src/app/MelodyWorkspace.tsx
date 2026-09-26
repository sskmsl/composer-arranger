import { useEffect, useMemo, useState } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { useActiveVariant, useCandidateBatch } from "./useActiveVariant"
import { PianoRoll, type BeatRange } from "./PianoRoll"
import { AccompanimentPianoRoll } from "./AccompanimentPianoRoll"
import { ChordPianoRoll } from "./ChordPianoRoll"
import { Button, Pill, TextInput } from "@/ui/primitives"
import { parseTimeSignature } from "@/core/section"
import { EmptySectionState } from "./EmptySectionState"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { CONTENT_FIGURE_LABELS, DEFAULT_SECTION_CONTENT, LEAD_CONTENT_LABELS } from "@/core/sectionContent"
import { GENERATOR_PROFILE_LABELS } from "@/melody-engine/generatorProfile"
import { notesByPartRole, resolvedLeadContent } from "@/core/sectionLayers"
import { accompanimentPatternNotesForSection } from "@/core/accompanimentPattern"
import type { SeedOperation } from "@/melody-engine/developSeed"
import { ArrowRight, Check, Ear, Layers, Sparkles, Star } from "lucide-react"
import type { MainTab } from "./App"
import { adoptedMelodyLayers, type MelodyLayerKind } from "@/core/melodyLayers"
import type { PianoRollOverlay } from "./PianoRoll"
import type { MelodyVariant, RangeRegenerationLocks } from "@/core/melody"
import { isTransitionContextStale } from "@/melody-engine/sectionTransition"
import {
  DirectorRecommendationBadge,
  PerformanceReviewBadge,
} from "./PerformanceReviewBadge"

const REGENERATION_LOCK_LABELS: Record<keyof RangeRegenerationLocks, string> = {
  pitch: "音の高さ",
  rhythm: "リズム",
  motif: "音型",
  opening: "入り方",
  ending: "終わり方",
}

const SEED_OPS: { id: SeedOperation; label: string }[] = [
  { id: "continue", label: "続きを作る" },
  { id: "variation-rhythm", label: "リズムを変える" },
  { id: "variation-pitch", label: "音の高さを変える" },
  { id: "answer-phrase", label: "答えのフレーズ" },
  { id: "expand", label: "長く広げる" },
  { id: "lift", label: "持ち上げる" },
  { id: "restrain", label: "抑える" },
]

export function MelodyWorkspace({
  onNavigate,
  onOpenProjectPanel,
}: {
  onNavigate?: (tab: MainTab) => void
  onOpenProjectPanel?: () => void
} = {}) {
  const project = useProjectStore((s) => s.project)
  const selectedSectionId = useProjectStore((s) => s.selectedSectionId)
  const generateForSection = useProjectStore((s) => s.generateForSection)
  const setActiveCandidateIndex = useProjectStore((s) => s.setActiveCandidateIndex)
  const currentIndex = useProjectStore((s) => s.activeCandidateIndex)
  const setActiveMelody = useProjectStore((s) => s.setActiveMelody)
  const toggleNoteLock = useProjectStore((s) => s.toggleNoteLock)
  const toggleBarLock = useProjectStore((s) => s.toggleBarLock)
  const regenerateRange = useProjectStore((s) => s.regenerateRange)
  const applySeedOperation = useProjectStore((s) => s.applySeedOperation)
  const workflowNotice = useProjectStore((s) => s.workflowNotice)
  const previewStartBeat = useProjectStore((s) => s.previewStartBeat)
  const setPreviewStartBeat = useProjectStore((s) => s.setPreviewStartBeat)

  const batch = useCandidateBatch()
  const variant = useActiveVariant()
  const section = project.sections.find((s) => s.id === selectedSectionId)
  const ts = parseTimeSignature(project.song.timeSignature)
  const totalBeats = section ? section.lengthBars * ts.beatsPerBar : 0
  const chords = project.chords.filter((c) => c.sectionId === selectedSectionId).sort((a, b) => a.startBeat - b.startBeat)
  const accompanimentPatternNotes = useMemo(
    () =>
      selectedSectionId
        ? accompanimentPatternNotesForSection(
            project,
            selectedSectionId,
            variant ? notesByPartRole(variant, "lead") : undefined,
          )
        : [],
    [project, selectedSectionId, variant],
  )
  // Issue #12: 無効なコードを暗黙にC majorとして生成へ渡さないため、件数だけでなくエラーの有無も
  // Generateボタンの可否へ反映する(buildHarmonicMapのC majorフォールバックへ黙って進ませない)。
  const chordHasError = chords.length > 0 && diagnoseChordInput(chords, totalBeats).hasError

  // Issue #41: このセクションが何を鳴らす設定か / 表示中の候補がどのcontentか
  const sectionContent = section?.content ?? DEFAULT_SECTION_CONTENT
  const variantContent = variant ? resolvedLeadContent(variant) : "melody"
  const isMelodyVariant = variantContent === "melody"
  const staleTransitionContext = variant ? isTransitionContextStale(project, variant) : false

  // 採用中の対旋律・装飾・イントロ。主旋律に重ねて表示し、下の状況カードにも使う
  const layers = useMemo(
    () => (selectedSectionId ? adoptedMelodyLayers(project, selectedSectionId) : []),
    [project, selectedSectionId],
  )
  const [overlayKinds, setOverlayKinds] = useState<Set<MelodyLayerKind>>(() => new Set(["counter", "decoration"]))
  const overlays: PianoRollOverlay[] = layers
    .filter((layer) => overlayKinds.has(layer.kind) && layer.notes.length > 0)
    .map((layer) => ({ id: layer.kind, label: LAYER_META[layer.kind].label, color: LAYER_META[layer.kind].color, notes: layer.notes }))
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [selection, setSelection] = useState<BeatRange | null>(null)
  const [continuationBars, setContinuationBars] = useState(2)
  const [expandBars, setExpandBars] = useState(4)
  const [regenerationLocks, setRegenerationLocks] = useState<RangeRegenerationLocks>({
    pitch: false,
    rhythm: false,
    motif: false,
    opening: false,
    ending: false,
  })

  /**
   * 候補をProfile(content候補ならリード内容)ごとにまとめる。
   * batch内の並び順は保ち、行内のピルには元のindexを持たせて選択状態を崩さない。
   */
  const candidateGroups = useMemo(() => {
    const groups: { key: string; label: string; items: { variant: MelodyVariant; index: number; patternLabel: string }[] }[] = []
    batch.forEach((v, index) => {
      const experimentSuffix = v.techniqueExperiment
        ? `:${v.techniqueExperiment.mode}`
        : ""
      const key = v.generatorProfile
        ? `${v.generatorProfile}${experimentSuffix}`
        : `content:${resolvedLeadContent(v)}${experimentSuffix}`
      const baseLabel = v.generatorProfile
        ? GENERATOR_PROFILE_LABELS[v.generatorProfile]
        : LEAD_CONTENT_LABELS[resolvedLeadContent(v)]
      const label = v.techniqueExperiment
        ? `${baseLabel} · ${
            v.techniqueExperiment.mode === "baseline"
              ? "通常"
              : "技法あり"
          }`
        : baseLabel
      let group = groups.find((g) => g.key === key)
      if (!group) {
        group = { key, label, items: [] }
        groups.push(group)
      }
      group.items.push({ variant: v, index, patternLabel: String(v.patternIndex ?? group.items.length + 1) })
    })
    return groups
  }, [batch])

  useEffect(() => {
    setSelectedNoteIds(new Set())
    setSelection(null)
  }, [variant?.id])

  if (!section) {
    return <EmptySectionState />
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* 手順の案内は、主旋律の候補ができるまでだけ出す(候補ができたらピアノロールを上へ詰める) */}
      {!variant && (
        <section className="rounded-lg border border-primary/30 bg-primary/[0.05] p-3">
          <div className="grid grid-cols-3 gap-1.5 text-[12px] sm:gap-2">
            {[
              { label: "1 コード", done: chords.length > 0 && !chordHasError },
              { label: "2 主旋律", done: Boolean(variant) },
              { label: "3 全曲アレンジ", done: false },
            ].map((step, index) => (
              <div
                key={step.label}
                className={`rounded-sm border px-2 py-2 text-center ${step.done ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" : index === (chords.length === 0 || chordHasError ? 0 : variant ? 2 : 1) ? "border-primary/45 bg-primary/10 text-primary-on-dark" : "border-hairline text-body-muted"}`}
              >
                {step.done ? "✓ " : ""}{step.label}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-body-muted">
              {chords.length === 0
                ? "まずコード進行を入力します。"
                : chordHasError
                  ? "コード表記を直すと主旋律を生成できます。"
                  : !variant
                    ? "コードの準備ができました。主旋律候補を生成します。"
                    : "主旋律を採用したら、全曲の方向を選んでアレンジします。"}
            </p>
            {chords.length === 0 && onOpenProjectPanel && (
              <Button variant="secondary" onClick={onOpenProjectPanel}>コード進行を入力</Button>
            )}
            {chords.length > 0 && !chordHasError && !variant && (
              <Button onClick={() => generateForSection(section.id)}><Sparkles size={14} /> 主旋律候補を生成</Button>
            )}
            {variant && onNavigate && (
              <Button onClick={() => onNavigate("arrangement")}>全曲のアレンジへ <ArrowRight size={13} /></Button>
            )}
          </div>
        </section>
      )}
      {/* 候補の切り替えと操作を1行にまとめる */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          {/*
            候補はProfileごとに行を分けて並べる。全候補を1つのflex-wrapへ流すと、
            Profileが増えるほど「Profile名 · Pattern n」が横一列に折り返して
            Profile名が3回ずつ繰り返され、さらに同じProfileの3案が行をまたいで
            分断されてしまうため(6 Profile選択で18個)。
            行頭にProfile名を1回だけ出し、ピルはPattern番号だけにする。
          */}
          {candidateGroups.length > 0 && (
            /*
              2列にするのは、Profile名が省略されずに収まる幅のときだけにする。
              1024〜1179pxは左右パネルが固定表示になって中央が最も狭くなる帯で、
              ここで2列にすると "Elegiac Cantabile" 等が切れるため1列へ戻す。

              範囲が重ならない指定にしているのは、Tailwind v4が任意値の
              ブレークポイントを名前付き(md/lg)より前に出力するため。
              重なる指定にすると、あとに出力された名前付き側が常に勝ってしまう。
            */
            <div
              className="grid grid-cols-1 gap-x-5 gap-y-1 min-[768px]:max-[1024px]:grid-cols-2 min-[1180px]:grid-cols-2"
              title="候補を選んだら Space で再生・停止できます"
            >
              {candidateGroups.map((group) => (
                <div key={group.key} className="flex min-w-0 items-center gap-2">
                  {/* セル幅が狭いときはラベル側を縮めて省略する(ピルは潰さない) */}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-body-on-dark" title={group.label}>
                    {group.label}
                  </span>
                  <div className="flex shrink-0 gap-1.5">
                    {group.items.map((item) => (
                      <Pill
                        key={item.variant.id}
                        active={item.index === currentIndex}
                        onClick={() => setActiveCandidateIndex(item.index)}
                        className="min-w-9 justify-center px-3 tabular-nums"
                        title={item.variant.name}
                        aria-label={item.variant.name}
                      >
                        {item.patternLabel}
                      </Pill>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Issue #41: melody以外の内容を生成する設定であることを、生成前に分かるようにする */}
          {sectionContent.lead !== "melody" && (
            <Pill active>
              内容: {LEAD_CONTENT_LABELS[sectionContent.lead]}
              {/* 反復音型・持続音は、いま選んでいる案の型(分散和音など)も出して3案の違いを分かるようにする */}
              {variant?.contentPlan?.figure ? ` · ${CONTENT_FIGURE_LABELS[variant.contentPlan.figure]}` : ""}
            </Pill>
          )}
          {variant && (
            <Button onClick={() => generateForSection(section.id)} disabled={chords.length === 0 || chordHasError}>
              <Sparkles size={14} /> 作り直す
            </Button>
          )}
          {variant && onNavigate && (
            // 候補どうしを、再生位置を保ったまま A/B/C で聴き比べる(旧・比較試聴タブ)
            <Button variant="secondary" onClick={() => onNavigate("audition")}>
              <Ear size={13} /> 聴き比べ
            </Button>
          )}
          {variant && (
            <Button
              variant={project.activeMelodyId === variant.id ? "secondary" : "primary"}
              onClick={() => setActiveMelody(variant.id)}
              disabled={project.activeMelodyId === variant.id}
            >
              {project.activeMelodyId === variant.id ? <><Check size={13} /> 採用中</> : <><Star size={13} /> この主旋律を採用</>}
            </Button>
          )}
          {variant && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("arrangement")}
              className="flex items-center gap-1 text-[13px] text-primary-on-dark hover:underline"
            >
              次: 全曲のアレンジ <ArrowRight size={12} />
            </button>
          )}
        </div>
      </div>
      {chords.length > 0 && chordHasError && (
        <span className="text-[13px] text-red-400">無効なコードがあります。左のパネルで修正してください</span>
      )}
      {/* 候補に添える印は「おすすめ」と、演奏上の注意がある時だけ(点数や内部の判定名は出さない) */}
      {variant && (
        <div className="flex flex-wrap items-center gap-2 empty:hidden">
          <DirectorRecommendationBadge
            recommendation={project.performanceBatchRecommendations?.[variant.batchId]}
            candidateId={variant.id}
          />
          <PerformanceReviewBadge review={project.candidatePerformanceReviews?.[variant.id]} />
        </div>
      )}

      {workflowNotice && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-200">
          {workflowNotice}
        </p>
      )}
      {staleTransitionContext && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-200">
          前のセクションの採用中の主旋律が変わりました。この候補のつながりは古い前提のままなので、つながりを更新するには作り直してください。
        </p>
      )}

      {layers.some((layer) => layer.notes.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-body-muted">
          <span className="flex items-center gap-1.5"><Layers size={13} /> 重ねて表示</span>
          {layers.filter((layer) => layer.notes.length > 0).map((layer) => (
            <label key={layer.kind} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={overlayKinds.has(layer.kind)}
                onChange={(event) =>
                  setOverlayKinds((prev) => {
                    const next = new Set(prev)
                    if (event.target.checked) next.add(layer.kind)
                    else next.delete(layer.kind)
                    return next
                  })
                }
              />
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: LAYER_META[layer.kind].color }} aria-hidden="true" />
              {LAYER_META[layer.kind].label}
            </label>
          ))}
          <span className="text-ink-soft">編集できるのは主旋律だけです。重ねた旋律は薄く表示します</span>
        </div>
      )}

      <PianoRoll
        overlays={overlays}
        variant={variant}
        chords={chords}
        totalBeats={totalBeats}
        timeSignature={project.song.timeSignature}
        songKey={section?.key?.trim() || project.song.key}
        selectedNoteIds={selectedNoteIds}
        onToggleNoteSelect={(id) =>
          setSelectedNoteIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }
        onToggleNoteLock={(id) => variant && toggleNoteLock(variant.id, id, "pitch")}
        lockedBars={variant?.lockedBars ?? []}
        onToggleBarLock={(bar) => variant && toggleBarLock(variant.id, bar)}
        selection={selection}
        onSelectionChange={setSelection}
        playbackStartBeat={previewStartBeat}
        onPlaybackStartChange={setPreviewStartBeat}
      />
      {isMelodyVariant ? (
        <p className="text-[12px] text-ink-soft">
          小節番号を押すとその小節から再生します。鍵アイコンで小節を固定できます。
        </p>
      ) : (
        /* Issue #41: Seed発展操作・部分再生成は歌唱メロディ専用のため、content候補では案内を変える */
        <p className="text-[12px] text-ink-soft">
          {LEAD_CONTENT_LABELS[variantContent]} 候補です。候補を発展させる操作と、範囲を選んだ作り直しは歌の旋律でだけ使えます。
          作り直す場合は「作り直す」を実行してください。
        </p>
      )}
      {onNavigate && layers.length > 0 && (
        <section aria-label="このセクションの旋律" className="grid gap-2 sm:grid-cols-3">
          {layers.map((layer) => {
            const meta = LAYER_META[layer.kind]
            const status = layer.name
              ? "採用中"
              : layer.candidateCount > 0
                ? `候補${layer.candidateCount}件・未採用`
                : "まだ作っていません"
            return (
              <button
                key={layer.kind}
                type="button"
                onClick={() => onNavigate(meta.tab)}
                className="flex flex-col gap-1 rounded-lg border border-hairline bg-surface-tile-1 p-3 text-left transition hover:border-primary/60 hover:bg-white/5"
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold text-body-on-dark">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: meta.color }} aria-hidden="true" />
                  {meta.label}
                  <ArrowRight size={12} className="ml-auto text-body-muted" />
                </span>
                <span className="text-[13px] text-body-muted">{status}</span>
                {layer.name && <span className="truncate text-[12px] text-ink-soft">{layer.name}</span>}
              </button>
            )
          })}
        </section>
      )}
      {accompanimentPatternNotes.length > 0 && (
        <AccompanimentPianoRoll
          notes={accompanimentPatternNotes}
          chords={chords}
          totalBeats={totalBeats}
          timeSignature={project.song.timeSignature}
          songKey={section?.key?.trim() || project.song.key}
        />
      )}
      {chords.length > 0 && (
        <ChordPianoRoll
          chords={chords}
          totalBeats={totalBeats}
          timeSignature={project.song.timeSignature}
          songKey={section?.key?.trim() || project.song.key}
        />
      )}

      {variant && isMelodyVariant && selection && selection.end - selection.start >= 0.25 && (
        <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-tile-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-soft">
              選択範囲: {selection.start.toFixed(1)}拍 – {selection.end.toFixed(1)}拍
            </span>
            <div className="ml-auto flex flex-wrap gap-1">
              <Button
                variant="dark"
                onClick={() =>
                  setSelection({
                    start: 0,
                    end: Math.min(totalBeats, variant.phrasePlans[0]?.phraseLengthBeats ?? Math.min(8, totalBeats)),
                  })
                }
              >
                冒頭
              </Button>
              <Button
                variant="dark"
                onClick={() => setSelection({ start: totalBeats * 0.25, end: totalBeats * 0.75 })}
              >
                中ほど
              </Button>
              <Button
                variant="dark"
                onClick={() =>
                  setSelection({
                    start: variant.phrasePlans.at(-1)?.phraseStartBeat ?? Math.max(0, totalBeats - 4),
                    end: totalBeats,
                  })
                }
              >
                終わり
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-[13px] text-ink-soft">
            {(Object.keys(regenerationLocks) as (keyof RangeRegenerationLocks)[]).map((key) => (
              <label key={key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={regenerationLocks[key]}
                  onChange={(event) =>
                    setRegenerationLocks((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
                {REGENERATION_LOCK_LABELS[key]}を残す
              </label>
            ))}
          </div>
          {(regenerationLocks.pitch || regenerationLocks.motif) && regenerationLocks.rhythm && (
            <p className="text-[12px] text-amber-300">
              音の高さ(または音型)とリズムを両方残すと、選んだ範囲はほとんど変わりません。
            </p>
          )}
          <div>
            <Button
              variant="secondary"
              onClick={() => regenerateRange(variant.id, selection.start, selection.end, regenerationLocks)}
            >
              選んだ範囲だけ作り直す(3案まで)
            </Button>
          </div>
        </div>
      )}

      {variant && isMelodyVariant && selectedNoteIds.size > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-tile-1 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
            <span>選んだ{selectedNoteIds.size}音から育てる</span>
            <label className="flex items-center gap-1">
              続きの長さ
              <TextInput
                type="number"
                className="w-14 px-1.5 py-0.5"
                value={continuationBars}
                onChange={(e) => setContinuationBars(Number(e.target.value) || 1)}
              />
              小節
            </label>
            <label className="flex items-center gap-1">
              広げる長さ
              <TextInput
                type="number"
                className="w-14 px-1.5 py-0.5"
                value={expandBars}
                onChange={(e) => setExpandBars(Number(e.target.value) || 4)}
              />
              小節
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SEED_OPS.map((op) => (
              <Button
                key={op.id}
                variant="dark"
                onClick={() =>
                  applySeedOperation(variant.id, op.id, [...selectedNoteIds], {
                    continuationBars,
                    expandToBars: expandBars,
                  })
                }
              >
                {op.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

/** 旋律タブの色分け(旋律タブ上部の切り替えの色と揃える) */
const LAYER_META: Record<MelodyLayerKind, { label: string; color: string; tab: "counter" | "decoration" | "signature" }> = {
  counter: { label: "対旋律", color: "#fbbf24", tab: "counter" },
  decoration: { label: "装飾", color: "#e879f9", tab: "decoration" },
  intro: { label: "イントロ", color: "#7dd3fc", tab: "signature" },
}
