import { useEffect, useState } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { useActiveVariant, useCandidateBatch } from "./useActiveVariant"
import { PianoRoll, type BeatRange } from "./PianoRoll"
import { Button, Pill, TextInput } from "@/ui/primitives"
import { parseTimeSignature } from "@/core/section"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import type { SeedOperation } from "@/melody-engine/developSeed"
import { Sparkles, Star } from "lucide-react"
import type { RangeRegenerationLocks } from "@/core/melody"

const SEED_OPS: { id: SeedOperation; label: string }[] = [
  { id: "continue", label: "Continue" },
  { id: "variation-rhythm", label: "Variation (rhythm)" },
  { id: "variation-pitch", label: "Variation (pitch)" },
  { id: "answer-phrase", label: "Answer Phrase" },
  { id: "expand", label: "Expand" },
  { id: "lift", label: "Lift" },
  { id: "restrain", label: "Restrain" },
]

export function MelodyWorkspace() {
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

  const batch = useCandidateBatch()
  const variant = useActiveVariant()
  const section = project.sections.find((s) => s.id === selectedSectionId)
  const ts = parseTimeSignature(project.song.timeSignature)
  const totalBeats = section ? section.lengthBars * ts.beatsPerBar : 0
  const chords = project.chords.filter((c) => c.sectionId === selectedSectionId).sort((a, b) => a.startBeat - b.startBeat)
  // Issue #12: 無効なコードを暗黙にC majorとして生成へ渡さないため、件数だけでなくエラーの有無も
  // Generateボタンの可否へ反映する(buildHarmonicMapのC majorフォールバックへ黙って進ませない)。
  const chordHasError = chords.length > 0 && diagnoseChordInput(chords, totalBeats).hasError

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

  useEffect(() => {
    setSelectedNoteIds(new Set())
    setSelection(null)
  }, [variant?.id])

  if (!section) {
    return <div className="flex flex-1 items-center justify-center text-ink-muted-48">左のパネルからセクションを選択してください</div>
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => generateForSection(section.id)} disabled={chords.length === 0 || chordHasError}>
          <Sparkles size={14} /> Generate from Chords
        </Button>
        {chords.length === 0 && <span className="text-[12px] text-ink-muted-48">コード進行を入力してください</span>}
        {chords.length > 0 && chordHasError && (
          <span className="text-[12px] text-red-400">無効なコードがあります。左のパネルで修正してください</span>
        )}

        {variant && (
          <Button
            variant="secondary"
            onClick={() => setActiveMelody(variant.id)}
            className={project.activeMelodyId === variant.id ? "opacity-50" : ""}
          >
            <Star size={13} /> {project.activeMelodyId === variant.id ? "Active Melody" : "Set as Active Melody"}
          </Button>
        )}
      </div>

      {batch.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {batch.map((v, i) => (
            <Pill key={v.id} active={i === currentIndex} onClick={() => setActiveCandidateIndex(i)}>
              {v.name}
            </Pill>
          ))}
        </div>
      )}

      {workflowNotice && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          {workflowNotice}
        </p>
      )}

      <PianoRoll
        variant={variant}
        chords={chords}
        totalBeats={totalBeats}
        timeSignature={project.song.timeSignature}
        songKey={project.song.key}
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
      />
      <p className="text-[11px] text-ink-muted-48">
        ノートをクリックでSeed選択(発展操作の対象) / ダブルクリックでPitch Lock切替 / 上部の小節番号でBar
        Lock切替 / 五線内をドラッグで再生成範囲を選択
      </p>

      {variant && selection && selection.end - selection.start >= 0.25 && (
        <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-tile-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-ink-muted-48">
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
                Opening
              </Button>
              <Button
                variant="dark"
                onClick={() => setSelection({ start: totalBeats * 0.25, end: totalBeats * 0.75 })}
              >
                Middle
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
                Ending
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-[12px] text-ink-muted-48">
            {(Object.keys(regenerationLocks) as (keyof RangeRegenerationLocks)[]).map((key) => (
              <label key={key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={regenerationLocks[key]}
                  onChange={(event) =>
                    setRegenerationLocks((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
                {key[0].toUpperCase() + key.slice(1)}を保持
              </label>
            ))}
          </div>
          {(regenerationLocks.pitch || regenerationLocks.motif) && regenerationLocks.rhythm && (
            <p className="text-[11px] text-amber-300">
              Pitch/MotifとRhythmを同時に保持すると選択範囲の実音が固定されます。Lockは自動解除されません。
            </p>
          )}
          <div>
            <Button
              variant="secondary"
              onClick={() => regenerateRange(variant.id, selection.start, selection.end, regenerationLocks)}
            >
              保持条件から最大3候補を生成
            </Button>
          </div>
        </div>
      )}

      {variant && selectedNoteIds.size > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-tile-1 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted-48">
            <span>Develop a Seed — 選択中 {selectedNoteIds.size} 音</span>
            <label className="flex items-center gap-1">
              Continue拍数
              <TextInput
                type="number"
                className="w-14 px-1.5 py-0.5"
                value={continuationBars}
                onChange={(e) => setContinuationBars(Number(e.target.value) || 1)}
              />
              小節
            </label>
            <label className="flex items-center gap-1">
              Expand目標
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
