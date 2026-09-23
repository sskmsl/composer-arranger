import { useEffect, useMemo, useState } from "react"
import {
  Check,
  Download,
  Play,
  RefreshCw,
  Sparkles,
  Square,
} from "lucide-react"
import { previewPlayer, type PreviewMode } from "@/audio/previewPlayer"
import type {
  SignaturePhraseCandidate,
  SignaturePhraseArchetype,
  SignatureCreativeRisk,
  SignaturePhraseLengthBars,
  SignatureVoicingMode,
} from "@/core/signaturePhrase"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { parseTimeSignature } from "@/core/section"
import { downloadMidi, exportMelodyMidi } from "@/midi/exportMelody"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Select } from "@/ui/primitives"
import { ReadOnlyPianoRoll } from "./AccompanimentPianoRoll"
import { EmptySectionState } from "./EmptySectionState"
import { CandidatePlacementHint } from "./CandidatePlacementHint"

const ARCHETYPE_LABELS: Record<SignaturePhraseArchetype, string> = {
  "atmospheric-gateway": "余白から始まる",
  "obsessive-motor": "反復で進む",
  "kinetic-hook": "リズムで引き込む",
}

const VOICING_MODE_LABELS: Record<SignatureVoicingMode, string> = {
  "single-line": "単音",
  "block-chord": "和音",
  "broken-chord": "分散和音",
}

const RISK_LABELS: Record<SignatureCreativeRisk, string> = {
  focused: "安定",
  bold: "大胆",
  radical: "冒険的",
}

function candidateArchetype(
  candidate: SignaturePhraseCandidate,
): SignaturePhraseArchetype {
  return candidate.plan.archetype ?? "kinetic-hook"
}

export function SignaturePhraseWorkspace() {
  const project = useProjectStore((state) => state.project)
  const selectedSectionId = useProjectStore(
    (state) => state.selectedSectionId,
  )
  const activeBatchId = useProjectStore(
    (state) => state.activeSignaturePhraseBatchId,
  )
  const activeIndex = useProjectStore(
    (state) => state.activeSignaturePhraseCandidateIndex,
  )
  const generate = useProjectStore(
    (state) => state.generateSignaturePhrasesForSection,
  )
  const setActiveIndex = useProjectStore(
    (state) => state.setActiveSignaturePhraseCandidateIndex,
  )
  const regenerate = useProjectStore(
    (state) => state.regenerateSignaturePhrase,
  )
  const toggleAssignment = useProjectStore(
    (state) => state.toggleSignaturePhraseAssignment,
  )
  const workflowNotice = useProjectStore((state) => state.workflowNotice)
  const [lengthBars, setLengthBars] =
    useState<SignaturePhraseLengthBars>(2)
  const [previewMode, setPreviewMode] =
    useState<PreviewMode>("chords-melody")
  const [playingId, setPlayingId] = useState<string | null>(null)

  const section = project.sections.find(
    (candidate) => candidate.id === selectedSectionId,
  )
  const { beatsPerBar } = parseTimeSignature(project.song.timeSignature)
  const sectionBeats = section ? section.lengthBars * beatsPerBar : 0
  const allChords = project.chords
    .filter((chord) => chord.sectionId === selectedSectionId)
    .sort((left, right) => left.startBeat - right.startBeat)
  const chordHasError =
    allChords.length > 0 &&
    diagnoseChordInput(allChords, sectionBeats).hasError

  const sectionCandidates = useMemo(
    () =>
      project.signaturePhraseCandidates
        .filter((candidate) => candidate.sectionId === selectedSectionId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [project.signaturePhraseCandidates, selectedSectionId],
  )
  const assignedId = selectedSectionId
    ? project.sectionSignaturePhraseAssignments?.[selectedSectionId]
    : undefined
  const effectiveBatchId =
    activeBatchId &&
    sectionCandidates.some(
      (candidate) => candidate.batchId === activeBatchId,
    )
      ? activeBatchId
      : sectionCandidates.find((candidate) => candidate.id === assignedId)?.batchId ??
        sectionCandidates[0]?.batchId ??
        null
  const batch = useMemo(
    () =>
      sectionCandidates
        .filter((candidate) => candidate.batchId === effectiveBatchId)
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { numeric: true }),
        ),
    [effectiveBatchId, sectionCandidates],
  )
  const activeCandidate =
    batch[Math.min(activeIndex, Math.max(0, batch.length - 1))]

  useEffect(
    () => () => {
      previewPlayer.stop()
    },
    [],
  )

  useEffect(() => {
    if (!section || lengthBars <= section.lengthBars) return
    const supported = ([8, 4, 2, 1] as const).find(
      (bars) => bars <= section.lengthBars,
    )
    setLengthBars(supported ?? 1)
  }, [lengthBars, section])

  if (!section) {
    return <EmptySectionState title="イントロを作るセクションが必要です" />
  }

  const stop = () => {
    previewPlayer.stop()
    setPlayingId(null)
  }

  const play = (candidate: SignaturePhraseCandidate) => {
    if (playingId === candidate.id) {
      stop()
      return
    }
    setActiveIndex(
      batch.findIndex((item) => item.id === candidate.id),
    )
    setPlayingId(candidate.id)
    previewPlayer.play({
      bpm: project.song.tempo,
      chords: allChords.filter(
        (chord) => chord.startBeat < candidate.phraseLengthBeats,
      ),
      melody: candidate.notes,
      mode: previewMode,
      leadStyle:
        candidateArchetype(candidate) === "atmospheric-gateway"
          ? "atmospheric"
          : candidateArchetype(candidate) === "obsessive-motor"
            ? "obsessive"
            : "kinetic",
      range: { startBeat: 0, endBeat: candidate.phraseLengthBeats },
      onEnded: () => setPlayingId(null),
    })
  }

  const exportCandidate = (candidate: SignaturePhraseCandidate) => {
    const bytes = exportMelodyMidi({
      title: project.title,
      sectionName: `${section.name} Signature Phrase`,
      tempo: project.song.tempo,
      timeSignature: project.song.timeSignature,
      chords: allChords,
      melodyNotes: candidate.notes,
      leadTrackName: "Signature Phrase",
      includeChords: previewMode !== "melody-only",
      range: { startBeat: 0, endBeat: candidate.phraseLengthBeats },
    })
    downloadMidi(
      bytes,
      `${project.title}-${section.name}-${candidate.name}`,
    )
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-tile-1 p-3">
        <div className="mr-auto max-w-3xl">
          <h2 className="text-[15px] font-semibold text-body-on-dark">
            イントロフレーズ
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-muted-48">
            イントロや間奏で使える、耳に残る短いフレーズを生成します
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-muted-48">
          長さ
          <Select
            value={String(lengthBars)}
            onChange={(event) =>
              setLengthBars(
                Number(event.target.value) as SignaturePhraseLengthBars,
              )
            }
            className="!py-1"
          >
            <option value="1">1小節</option>
            <option value="2" disabled={section.lengthBars < 2}>
              2小節
            </option>
            <option value="4" disabled={section.lengthBars < 4}>
              4小節
            </option>
            <option value="8" disabled={section.lengthBars < 8}>
              8小節
            </option>
          </Select>
        </label>
        <Button
          onClick={() => generate(section.id, lengthBars)}
          disabled={
            section.lengthBars < lengthBars ||
            allChords.length === 0 ||
            chordHasError
          }
        >
          <Sparkles size={14} /> 12候補を生成
        </Button>
      </section>

      {allChords.length === 0 && (
        <p className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          左パネルの「コード進行」を入力すると、イントロフレーズを生成できます。
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
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
                    <h3 className="text-[13px] font-semibold text-body-on-dark">
                      候補 {index + 1}
                    </h3>
                    <span className="shrink-0 text-[11px] text-ink-muted-48">
                      {candidate.plan.lengthBars}小節
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {candidate.plan.compositionContext && (
                      <span className="rounded-pill bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-200">
                        {candidate.plan.compositionContext.source === "chords-and-melody"
                          ? "主旋律を参考"
                          : "コードを参考"}
                      </span>
                    )}
                    <span className="rounded-pill bg-primary/15 px-2 py-0.5 text-[11px] text-primary-on-dark">
                      {ARCHETYPE_LABELS[candidateArchetype(candidate)]}
                    </span>
                    {candidate.plan.creativeRisk && (
                      <>
                        <span className={`rounded-pill px-2 py-0.5 text-[11px] ${
                          candidate.plan.creativeRisk.risk === "radical"
                            ? "bg-fuchsia-400/20 text-fuchsia-200"
                            : candidate.plan.creativeRisk.risk === "bold"
                              ? "bg-orange-400/20 text-orange-200"
                              : "bg-white/6 text-body-muted"
                        }`}>
                          {RISK_LABELS[candidate.plan.creativeRisk.risk]}
                        </span>
                      </>
                    )}
                    <span className="rounded-pill bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200">
                      {VOICING_MODE_LABELS[candidate.plan.voicingMode]}
                    </span>
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
                    className="min-w-0 flex-1 !px-2 !text-[11px]"
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
                  <Button
                    variant={assignedId === candidate.id ? "dark" : "primary"}
                    className="min-w-0 !px-2 !text-[11px]"
                    onClick={() => toggleAssignment(candidate.id)}
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
              <option value="melody-only">フレーズのみ</option>
              <option value="chords-melody">コード＋フレーズ</option>
            </Select>
          </div>
        </>
      )}

      {activeCandidate ? (
        <>
          <ReadOnlyPianoRoll
            notes={activeCandidate.notes}
            chords={allChords.filter(
              (chord) => chord.startBeat < activeCandidate.phraseLengthBeats,
            )}
            totalBeats={activeCandidate.phraseLengthBeats}
            timeSignature={project.song.timeSignature}
            songKey={section?.key?.trim() || project.song.key}
            title={`候補 ${batch.findIndex((candidate) => candidate.id === activeCandidate.id) + 1}`}
            subtitle="表示専用 · MIDI出力と同じ内容"
            accentColor="#c084fc"
            accentStroke="#e9d5ff"
            ariaLabel="Signature Phrase Piano Roll"
            noteLabel="Signature Phrase"
          />
        </>
      ) : (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-tile-1 text-center">
          <div>
            <p className="text-[13px] text-body-muted">
              まだイントロフレーズ候補がありません
            </p>
            <p className="mt-1 text-[11px] text-ink-muted-48">
              コードの並びではなく、記憶に残るリズムと輪郭を持つ12案を生成します
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
