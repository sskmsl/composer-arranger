import { useEffect, useMemo, useState } from "react"
import { sectionTempoChanges } from "@/core/tempoMap"
import { EyeOff, Play, Square, Star, ThumbsDown, Check } from "lucide-react"
import { useProjectStore } from "@/store/useProjectStore"
import { previewPlayer, type PreviewMode } from "@/audio/previewPlayer"
import { parseTimeSignature } from "@/core/section"
import { accompanimentEnabled } from "@/core/sectionContent"
import { accompanimentPatternNotesForSection } from "@/core/accompanimentPattern"
import { distinctMelodyVariantsForAudition, immediateAuditionRange, leadNotesForAudition } from "@/core/auditionMaterial"
import { Button, Pill, Select, TextInput } from "@/ui/primitives"
import type { MainTab } from "./App"
import { applyArrangementTimelineToSectionEvents } from "@/core/arrangementTimelineConstraints"

const SLOT_LABELS = ["A", "B", "C"] as const

export function AuditionWorkspace({ onNavigate }: { onNavigate?: (tab: MainTab) => void } = {}) {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const selectSection = useProjectStore((state) => state.selectSection)
  const setActiveMelody = useProjectStore((state) => state.setActiveMelody)
  const setReviewState = useProjectStore((state) => state.setVariantReviewState)
  const section = project.sections.find((candidate) => candidate.id === selectedSectionId)
  const variants = useMemo(() => {
    const candidates = project.melodyVariants
        .filter((variant) => variant.sectionId === selectedSectionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return selectedSectionId
      ? distinctMelodyVariantsForAudition(project, selectedSectionId, candidates)
      : candidates
  }, [project, selectedSectionId])
  const variantKey = variants.map((variant) => variant.id).join("|")
  const [slotIds, setSlotIds] = useState<(string | null)[]>([null, null, null])
  const [activeSlot, setActiveSlot] = useState(0)
  const [blind, setBlind] = useState(false)
  const [mode, setMode] = useState<PreviewMode>("melody-only")
  const [loop, setLoop] = useState(true)
  const [playing, setPlaying] = useState(false)
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const timelineConstraints = project.fullSongArrangement?.plan.directive?.timelineConstraints
  const totalBeats = section
    ? section.lengthBars * beatsPerBar
    : 0
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(totalBeats)
  const isUnsegmentedLongMidi = project.sourceImport?.type === "midi"
    && project.sections.length === 1
    && (section?.lengthBars ?? 0) > 8

  useEffect(() => {
    const ids = variantKey ? variantKey.split("|") : []
    setSlotIds([
      ids[0] ?? null,
      ids[1] ?? null,
      ids[2] ?? null,
    ])
    setActiveSlot(0)
  }, [selectedSectionId, variantKey])

  const selectedVariants = slotIds.map((id) => variants.find((variant) => variant.id === id))
  const activeVariant = selectedVariants[activeSlot]
  const activeLeadNotes = useMemo(
    () => selectedSectionId && section
      ? applyArrangementTimelineToSectionEvents(
          leadNotesForAudition(project, selectedSectionId, activeVariant),
          timelineConstraints,
          beatsPerBar,
          section.startBar,
          true,
        )
      : [],
    [project, selectedSectionId, section, activeVariant, timelineConstraints, beatsPerBar],
  )

  useEffect(() => {
    const range = project.sourceImport?.type === "midi" && !isUnsegmentedLongMidi
      ? immediateAuditionRange(activeLeadNotes, totalBeats, beatsPerBar)
      : { startBeat: 0, endBeat: totalBeats }
    setRangeStart(range.startBeat)
    setRangeEnd(range.endBeat)
  }, [selectedSectionId, activeVariant?.id, activeLeadNotes, totalBeats, beatsPerBar, project.sourceImport?.type, isUnsegmentedLongMidi])
  // Issue #41: accompaniment="none"(Silence)のセクションは比較試聴でも伴奏を鳴らさない
  const rawChords = accompanimentEnabled(section)
    ? project.chords
        .filter((chord) => chord.sectionId === selectedSectionId)
        .sort((a, b) => a.startBeat - b.startBeat)
    : []
  const chords = section
    ? applyArrangementTimelineToSectionEvents(
        rawChords,
        timelineConstraints,
        beatsPerBar,
        section.startBar,
        false,
      )
    : []
  const playbackOptions = (slot: number) => {
    const variant = selectedVariants[slot]
    if (!variant) return null
    const leadNotes = selectedSectionId && section
      ? applyArrangementTimelineToSectionEvents(
          leadNotesForAudition(project, selectedSectionId, variant),
          timelineConstraints,
          beatsPerBar,
          section.startBar,
          true,
        )
      : []
    const rawAccompanimentPatternNotes = selectedSectionId
      ? accompanimentPatternNotesForSection(
          project,
          selectedSectionId,
          leadNotes,
        )
      : []
    const accompanimentPatternNotes = section
      ? applyArrangementTimelineToSectionEvents(
          rawAccompanimentPatternNotes,
          timelineConstraints,
          beatsPerBar,
          section.startBar,
          false,
        )
      : []
    return {
      bpm: project.song.tempo,
      tempoChanges: section ? sectionTempoChanges(project, section.id) : undefined,
      chords,
      melody: leadNotes,
      accompaniment: accompanimentPatternNotes,
      mode,
      loop,
      range: {
        startBeat: Math.max(0, Math.min(rangeStart, totalBeats)),
        endBeat: Math.max(rangeStart + 0.25, Math.min(rangeEnd, totalBeats)),
      },
      onEnded: () => setPlaying(false),
    }
  }

  const switchTo = (slot: number) => {
    if (!selectedVariants[slot]) return
    setActiveSlot(slot)
    const options = playbackOptions(slot)
    if (options && previewPlayer.isPlaying()) {
      if (options.range.endBeat - options.range.startBeat > 32) {
        const startBeat = Math.max(options.range.startBeat, Math.min(options.range.endBeat, previewPlayer.getCurrentBeat()))
        previewPlayer.playContinuous({ ...options, startBeat })
      } else {
        previewPlayer.switch(options)
      }
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      const slot = Number(event.key) - 1
      if (slot >= 0 && slot < 3) switchTo(slot)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const play = () => {
    const options = playbackOptions(activeSlot)
    if (!options) return
    setPlaying(true)
    if (options.range.endBeat - options.range.startBeat > 32) previewPlayer.playContinuous(options)
    else previewPlayer.play(options)
  }

  const stop = () => {
    previewPlayer.stop()
    setPlaying(false)
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-[16px] font-semibold">聴き比べ</h2>
          <p className="mt-0.5 text-[13px] text-ink-soft">主旋律の候補を、再生位置を保ったまま A/B/C で切り替えます(1〜3キー)</p>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-soft">
          セクション
          <Select value={selectedSectionId ?? ""} onChange={(event) => selectSection(event.target.value || null)}>
            <option value="">選択してください</option>
            {project.sections.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </label>
        {onNavigate && (
          <Button variant="secondary" onClick={() => onNavigate("melody")}>
            聴き比べを閉じる
          </Button>
        )}
      </div>

      {!section && (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-[13px] text-amber-200">
          比較するセクションがありません。先にホームから曲を準備してください。
        </p>
      )}
      {section && variants.length === 0 && (
        // 比べる候補がないときは、使えない試聴設定やA/B/C枠を並べず、次にすることだけを示す
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-400/30 bg-amber-400/8 px-3 py-3 text-[13px] text-amber-200">
          <p>比較できる主旋律候補がありません。主旋律の候補を作ると、ここでA/B/Cを聴き比べられます。</p>
          {onNavigate && <Button onClick={() => onNavigate("melody")}>主旋律の候補を作る</Button>}
        </div>
      )}
      {section && variants.length === 1 && (
        <p className="rounded-md border border-sky-300/25 bg-sky-400/[0.06] px-3 py-2 text-[13px] text-sky-100">
          音が異なる主旋律候補は1件です。同じ演奏の複製は比較枠へ表示しません。3案を比べる場合は、主旋律で候補を作り直してください。
        </p>
      )}

      {variants.length > 0 && (<>
      <section className="rounded-lg border border-hairline bg-surface-tile-1 p-3" aria-labelledby="audition-settings-heading">
        <h3 id="audition-settings-heading" className="mb-2 text-[13px] font-semibold text-body-on-dark">試聴方法</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={mode} onChange={(event) => setMode(event.target.value as PreviewMode)}>
            <option value="melody-only">主旋律のみ</option>
            <option value="chords-melody">コード＋主旋律</option>
            <option value="chords-only">コードのみ</option>
          </Select>
          <label className="flex items-center gap-1 text-[13px] text-ink-soft">
            開始
            <TextInput
              type="number"
              min={0}
              max={totalBeats}
              step={0.25}
              value={rangeStart}
              onChange={(event) => setRangeStart(Number(event.target.value))}
              className="w-20"
            />
          </label>
          <label className="flex items-center gap-1 text-[13px] text-ink-soft">
            終了
            <TextInput
              type="number"
              min={0.25}
              max={totalBeats}
              step={0.25}
              value={rangeEnd}
              onChange={(event) => setRangeEnd(Number(event.target.value))}
              className="w-20"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
            <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />
            繰り返す
          </label>
          <Button variant={blind ? "secondary" : "dark"} onClick={() => setBlind((value) => !value)}>
            <EyeOff size={13} /> 名前を隠す
          </Button>
          <Button onClick={playing ? stop : play} disabled={!activeVariant}>
            {playing ? <Square size={14} /> : <Play size={14} />}
            {playing ? "停止" : "再生"}
          </Button>
          {isUnsegmentedLongMidi && (
            <span className="text-[12px] text-primary-on-dark">
              セクション未分割のため、全{section?.lengthBars ?? 0}小節を再生します
            </span>
          )}
          {project.sourceImport?.type === "midi" && !isUnsegmentedLongMidi && totalBeats > rangeEnd - rangeStart && (
            <span className="text-[12px] text-ink-soft">
              読み込んだMIDIは、主旋律が始まるあたりの8小節から試聴します
            </span>
          )}
        </div>
      </section>

      <section aria-labelledby="audition-candidates-heading">
        <h3 id="audition-candidates-heading" className="mb-2 text-[13px] font-semibold text-body-on-dark">聴き比べる候補</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {SLOT_LABELS.map((label, slot) => {
          const variant = selectedVariants[slot]
          return (
            <article
              key={label}
              className={`flex min-w-0 flex-col gap-3 rounded-lg border p-4 ${
                activeSlot === slot ? "border-primary bg-primary/10" : "border-hairline bg-surface-tile-1"
              }`}
            >
              <div className="flex items-center gap-2">
                <Pill active={activeSlot === slot} onClick={() => switchTo(slot)}>
                  {label}
                </Pill>
                <span className="text-[12px] text-ink-soft">キー {slot + 1}</span>
                {variant?.reviewState === "favorite" && <Star size={13} className="ml-auto text-primary-on-dark" />}
                {variant?.reviewState === "rejected" && <ThumbsDown size={13} className="ml-auto text-ink-soft" />}
              </div>

              {!blind ? (
                <>
                  <Select
                    value={slotIds[slot] ?? ""}
                    onChange={(event) => {
                      const next = [...slotIds]
                      next[slot] = event.target.value || null
                      setSlotIds(next)
                    }}
                  >
                    <option value="">未選択</option>
                    {variants.map((candidate) => (
                      slotIds.some((selectedId, selectedSlot) => selectedSlot !== slot && selectedId === candidate.id) ? null : (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                      )
                    ))}
                  </Select>
                  {variant && (
                    <div className="text-[12px] text-ink-soft">
                      <div>{variant.generatorProfile ?? "profileなし"}</div>
                      <div>{variant.patternIndex ? `Pattern ${variant.patternIndex}` : variant.sourceMode}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex min-h-16 items-center justify-center rounded-sm bg-black/20 text-[13px] text-ink-soft">
                  Candidate {label}
                </div>
              )}

              <Button variant="dark" disabled={!variant} onClick={() => switchTo(slot)}>
                この候補へ切替
              </Button>
            </article>
          )
          })}
        </div>
      </section>

      {activeVariant && (
        <section className="rounded-lg border border-hairline bg-surface-tile-1 p-3" aria-labelledby="audition-decision-heading">
          <h3 id="audition-decision-heading" className="text-[13px] font-semibold text-body-on-dark">候補を決める</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="mr-auto text-[13px] text-ink-soft">
              {blind ? `候補${SLOT_LABELS[activeSlot]}を判定` : activeVariant.name}
            </span>
            <Button
              variant="dark"
              onClick={() =>
                setReviewState(activeVariant.id, activeVariant.reviewState === "favorite" ? null : "favorite")
              }
            >
              <Star size={13} /> お気に入り
            </Button>
            <Button
              variant="dark"
              onClick={() =>
                setReviewState(activeVariant.id, activeVariant.reviewState === "rejected" ? null : "rejected")
              }
            >
              <ThumbsDown size={13} /> 却下
            </Button>
            <Button variant="secondary" onClick={() => setActiveMelody(activeVariant.id)}>
              <Check size={13} /> この主旋律を採用
            </Button>
          </div>
        </section>
      )}
      </>)}
    </main>
  )
}
