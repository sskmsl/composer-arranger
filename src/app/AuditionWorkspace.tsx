import { useEffect, useMemo, useState } from "react"
import { EyeOff, Play, Square, Star, ThumbsDown, Check } from "lucide-react"
import { useProjectStore } from "@/store/useProjectStore"
import { previewPlayer, type PreviewMode } from "@/audio/previewPlayer"
import { parseTimeSignature } from "@/core/section"
import { accompanimentEnabled } from "@/core/sectionContent"
import { accompanimentPatternNotesForSection } from "@/core/accompanimentPattern"
import { notesByPartRole } from "@/core/sectionLayers"
import { Button, Pill, Select, TextInput } from "@/ui/primitives"

const SLOT_LABELS = ["A", "B", "C"] as const

export function AuditionWorkspace() {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore((state) => state.selectedSectionId)
  const selectSection = useProjectStore((state) => state.selectSection)
  const setActiveMelody = useProjectStore((state) => state.setActiveMelody)
  const setReviewState = useProjectStore((state) => state.setVariantReviewState)
  const section = project.sections.find((candidate) => candidate.id === selectedSectionId)
  const variants = useMemo(
    () =>
      project.melodyVariants
        .filter((variant) => variant.sectionId === selectedSectionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [project.melodyVariants, selectedSectionId],
  )
  const variantKey = variants.map((variant) => variant.id).join("|")
  const [slotIds, setSlotIds] = useState<(string | null)[]>([null, null, null])
  const [activeSlot, setActiveSlot] = useState(0)
  const [blind, setBlind] = useState(false)
  const [mode, setMode] = useState<PreviewMode>("melody-only")
  const [loop, setLoop] = useState(true)
  const [playing, setPlaying] = useState(false)
  const totalBeats = section
    ? section.lengthBars * parseTimeSignature(project.song.timeSignature).beatsPerBar
    : 0
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(totalBeats)

  useEffect(() => {
    const ids = variantKey ? variantKey.split("|") : []
    setSlotIds([
      ids[0] ?? null,
      ids[1] ?? null,
      ids[2] ?? null,
    ])
    setActiveSlot(0)
  }, [selectedSectionId, variantKey])

  useEffect(() => {
    setRangeStart(0)
    setRangeEnd(totalBeats)
  }, [selectedSectionId, totalBeats])

  const selectedVariants = slotIds.map((id) => variants.find((variant) => variant.id === id))
  const activeVariant = selectedVariants[activeSlot]
  // Issue #41: accompaniment="none"(Silence)のセクションは比較試聴でも伴奏を鳴らさない
  const chords = accompanimentEnabled(section)
    ? project.chords
        .filter((chord) => chord.sectionId === selectedSectionId)
        .sort((a, b) => a.startBeat - b.startBeat)
    : []
  const playbackOptions = (slot: number) => {
    const variant = selectedVariants[slot]
    if (!variant) return null
    const accompanimentPatternNotes = selectedSectionId
      ? accompanimentPatternNotesForSection(
          project,
          selectedSectionId,
          notesByPartRole(variant, "lead"),
        )
      : []
    return {
      bpm: project.song.tempo,
      chords,
      melody: variant.notes,
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
    if (options && previewPlayer.isPlaying()) previewPlayer.switch(options)
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
    previewPlayer.play(options)
  }

  const stop = () => {
    previewPlayer.stop()
    setPlaying(false)
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[16px] font-semibold">A/B/C 比較試聴</h2>
        <label className="flex items-center gap-2 text-[12px] text-ink-muted-48">
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
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-tile-1 p-3">
        <Select value={mode} onChange={(event) => setMode(event.target.value as PreviewMode)}>
          <option value="melody-only">Melody Only</option>
          <option value="chords-melody">Chords + Melody</option>
          <option value="chords-only">Chords Only</option>
        </Select>
        <label className="flex items-center gap-1 text-[12px] text-ink-muted-48">
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
        <label className="flex items-center gap-1 text-[12px] text-ink-muted-48">
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
        <label className="flex items-center gap-1.5 text-[12px] text-ink-muted-48">
          <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />
          Loop
        </label>
        <Button variant={blind ? "secondary" : "dark"} onClick={() => setBlind((value) => !value)}>
          <EyeOff size={13} /> Blind
        </Button>
        <Button onClick={playing ? stop : play} disabled={!activeVariant}>
          {playing ? <Square size={14} /> : <Play size={14} />}
          {playing ? "停止" : "再生"}
        </Button>
      </div>

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
                <span className="text-[11px] text-ink-muted-48">キー {slot + 1}</span>
                {variant?.reviewState === "favorite" && <Star size={13} className="ml-auto text-primary" />}
                {variant?.reviewState === "rejected" && <ThumbsDown size={13} className="ml-auto text-ink-muted-48" />}
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
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </Select>
                  {variant && (
                    <div className="text-[11px] text-ink-muted-48">
                      <div>{variant.generatorProfile ?? "profileなし"}</div>
                      <div>{variant.patternIndex ? `Pattern ${variant.patternIndex}` : variant.sourceMode}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex min-h-16 items-center justify-center rounded-sm bg-black/20 text-[13px] text-ink-muted-48">
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

      {activeVariant && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-tile-1 p-3">
          <span className="mr-auto text-[12px] text-ink-muted-48">
            {blind ? `Candidate ${SLOT_LABELS[activeSlot]}を判定` : activeVariant.name}
          </span>
          <Button
            variant="dark"
            onClick={() =>
              setReviewState(activeVariant.id, activeVariant.reviewState === "favorite" ? null : "favorite")
            }
          >
            <Star size={13} /> Favorite
          </Button>
          <Button
            variant="dark"
            onClick={() =>
              setReviewState(activeVariant.id, activeVariant.reviewState === "rejected" ? null : "rejected")
            }
          >
            <ThumbsDown size={13} /> Reject
          </Button>
          <Button variant="secondary" onClick={() => setActiveMelody(activeVariant.id)}>
            <Check size={13} /> Set Active
          </Button>
        </div>
      )}
    </main>
  )
}
