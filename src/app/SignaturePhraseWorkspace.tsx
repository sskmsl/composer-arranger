import { useEffect, useMemo, useState } from "react"
import {
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
  SignaturePhraseArchitecture,
  SignatureCreativeRisk,
  SignaturePitchDisruption,
  SignatureRhythmicDisruption,
  SignatureStructuralSurprise,
  SignaturePhraseLengthBars,
  SignatureOpportunityKind,
  SignatureRhythmIdentity,
  SignatureVariationStrategy,
  SignatureVoiceMotion,
  SignatureVoicingMode,
  SignatureVoicingStyle,
} from "@/core/signaturePhrase"
import { diagnoseChordInput } from "@/core/chordDiagnostics"
import { parseTimeSignature } from "@/core/section"
import { downloadMidi, exportMelodyMidi } from "@/midi/exportMelody"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Select } from "@/ui/primitives"
import { ReadOnlyPianoRoll } from "./AccompanimentPianoRoll"
import {
  DirectorRecommendationBadge,
  PerformanceReviewBadge,
} from "./PerformanceReviewBadge"

const RHYTHM_LABELS: Record<SignatureRhythmIdentity, string> = {
  "opening-stamp": "Opening Stamp",
  "pickup-hook": "Pickup Hook",
  "syncopated-cell": "Syncopated Cell",
  "call-gap-answer": "Call / Gap / Answer",
  "long-short-signal": "Long–Short Signal",
  "broken-pulse": "Broken Pulse",
}

const VARIATION_LABELS: Record<SignatureVariationStrategy, string> = {
  displacement: "位置変形",
  fragmentation: "断片化",
  augmentation: "拡張",
  answer: "応答形",
  "delayed-return": "遅延回帰",
}

const ARCHETYPE_LABELS: Record<SignaturePhraseArchetype, string> = {
  "atmospheric-gateway": "Atmospheric Gateway",
  "obsessive-motor": "Obsessive Motor",
  "kinetic-hook": "Kinetic Hook",
}

const ARCHITECTURE_LABELS: Record<SignaturePhraseArchitecture, string> = {
  "identity-return": "Identity → Return",
  "question-answer-return": "Question → Answer → Return",
  "slow-burn-return": "Slow Burn → Return",
}

const VOICING_MODE_LABELS: Record<SignatureVoicingMode, string> = {
  "single-line": "単音",
  "block-chord": "和音スタブ",
  "broken-chord": "分散和音",
}

const VOICING_STYLE_LABELS: Record<SignatureVoicingStyle, string> = {
  "close-position": "Close",
  "open-spread": "Open Spread",
  "drop-2": "Drop 2",
  "pedal-tone": "Pedal",
  "inner-motion": "Inner Motion",
}

const VOICE_MOTION_LABELS: Record<SignatureVoiceMotion, string> = {
  smooth: "Smooth",
  contrary: "Contrary",
  oblique: "Oblique",
}

const RISK_LABELS: Record<SignatureCreativeRisk, string> = {
  focused: "Focused",
  bold: "Bold",
  radical: "Radical",
}

const RHYTHMIC_DISRUPTION_LABELS: Record<SignatureRhythmicDisruption, string> = {
  none: "Stable Rhythm",
  "metric-displacement": "Metric Shift",
  "asymmetric-cycle": "Asymmetric Cycle",
  "silence-fracture": "Silence Fracture",
  "cross-bar-attack": "Cross-bar Attack",
}

const PITCH_DISRUPTION_LABELS: Record<SignaturePitchDisruption, string> = {
  none: "Stable Pitch",
  "interval-signature": "Interval Signature",
  "chromatic-side-step": "Chromatic Side-step",
  "register-rupture": "Register Rupture",
  "pedal-tension": "Pedal Tension",
}

const STRUCTURAL_SURPRISE_LABELS: Record<SignatureStructuralSurprise, string> = {
  none: "Linear Form",
  "false-start": "False Start",
  interruption: "Interruption",
  "false-return": "False Return",
  "abrupt-open-tail": "Abrupt Open Tail",
}

const OPPORTUNITY_LABELS: Record<SignatureOpportunityKind, string> = {
  "motif-foreshadowing": "Motif Foreshadow",
  "rhythmic-counter-identity": "Rhythmic Counter",
  "harmonic-identity": "Harmonic Identity",
  "tension-premonition": "Tension Premonition",
  "register-contrast": "Register Contrast",
  "section-threshold": "Section Threshold",
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
  const effectiveBatchId =
    activeBatchId &&
    sectionCandidates.some(
      (candidate) => candidate.batchId === activeBatchId,
    )
      ? activeBatchId
      : sectionCandidates[0]?.batchId ?? null
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
            Signature Phrase Generator
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-muted-48">
            1〜2小節の固有Motifを、反復・変形・統合Decorationで最大8小節へ発展させます
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
          <Sparkles size={14} /> Generate 12 Ideas
        </Button>
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
                      {candidate.name}
                    </h3>
                    <span className="shrink-0 text-[11px] text-ink-muted-48">
                      {candidate.plan.lengthBars}小節 · {Math.round(candidate.score.overall)}
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
                  <div className="mt-2 flex flex-wrap gap-1">
                    {candidate.plan.compositionContext && (
                      <span
                        className="rounded-pill bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-200"
                        title={candidate.plan.compositionContext.rationale}
                      >
                        {OPPORTUNITY_LABELS[
                          candidate.plan.compositionContext.opportunity
                        ]}
                        {candidate.plan.compositionContext.source ===
                        "chords-and-melody"
                          ? " · Melody Linked"
                          : " · Chord Driven"}
                      </span>
                    )}
                    <span className="rounded-pill bg-primary/15 px-2 py-0.5 text-[11px] text-primary-light">
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
                        {candidate.plan.creativeRisk.risk !== "focused" && (
                          <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                            {RHYTHMIC_DISRUPTION_LABELS[candidate.plan.creativeRisk.rhythmicDevice]}
                            {" · "}
                            {PITCH_DISRUPTION_LABELS[candidate.plan.creativeRisk.pitchDevice]}
                            {" · "}
                            {STRUCTURAL_SURPRISE_LABELS[candidate.plan.creativeRisk.structuralDevice]}
                          </span>
                        )}
                      </>
                    )}
                    {candidate.plan.architecture && (
                      <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                        {ARCHITECTURE_LABELS[candidate.plan.architecture]}
                      </span>
                    )}
                    {candidate.plan.voicingMode !== "single-line" && (
                      <>
                        <span className="rounded-pill bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200">
                          {VOICING_MODE_LABELS[candidate.plan.voicingMode]}
                        </span>
                        {candidate.plan.voiceLeading && (
                          <span className="rounded-pill bg-sky-400/15 px-2 py-0.5 text-[11px] text-sky-200">
                            {VOICING_STYLE_LABELS[candidate.plan.voiceLeading.style]}
                            {" · "}
                            {VOICE_MOTION_LABELS[candidate.plan.voiceLeading.motion]}
                          </span>
                        )}
                      </>
                    )}
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                      {RHYTHM_LABELS[candidate.plan.rhythmIdentity]}
                    </span>
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                      {candidate.plan.contour}
                    </span>
                    <span className="rounded-pill bg-white/6 px-2 py-0.5 text-[11px] text-body-muted">
                      {VARIATION_LABELS[candidate.plan.variationStrategy]}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-ink-muted-48">
                    <span>
                      World {Math.round((candidate.score.worldBuilding ?? 0) * 100)}
                    </span>
                    <span>Opening {Math.round(candidate.score.openingImpact * 100)}</span>
                    <span>Rhythm {Math.round(candidate.score.rhythmicIdentity * 100)}</span>
                    {candidate.score.compositionPurpose !== undefined && (
                      <span>
                        Purpose {Math.round(candidate.score.compositionPurpose * 100)}
                      </span>
                    )}
                    {candidate.score.harmonicNarrative !== undefined && (
                      <span>
                        Harmony {Math.round(candidate.score.harmonicNarrative * 100)}
                      </span>
                    )}
                    {candidate.score.thematicForeshadowing !== undefined && (
                      <span>
                        Theme {Math.round(candidate.score.thematicForeshadowing * 100)}
                      </span>
                    )}
                    {candidate.score.rhythmicComplement !== undefined && (
                      <span>
                        Complement {Math.round(candidate.score.rhythmicComplement * 100)}
                      </span>
                    )}
                    <span>
                      Memory {Math.round((candidate.score.motifMemorability ?? 0) * 100)}
                    </span>
                    {candidate.plan.creativeRisk?.risk !== "focused" && (
                      <>
                        <span>Audacity {Math.round((candidate.score.audacity ?? 0) * 100)}</span>
                        <span>Control {Math.round((candidate.score.controlledRisk ?? 0) * 100)}</span>
                      </>
                    )}
                    {candidate.plan.voicingMode !== "single-line" && (
                      <span>
                        Voice Lead {Math.round((candidate.score.voiceLeadingQuality ?? 0) * 100)}
                      </span>
                    )}
                    {candidate.plan.lengthBars >= 4 && (
                      <>
                        <span>
                          Coherence {Math.round((candidate.score.longRangeCoherence ?? 0) * 100)}
                        </span>
                        <span>
                          Variation {Math.round((candidate.score.variationBalance ?? 0) * 100)}
                        </span>
                      </>
                    )}
                  </div>
                </button>
                <div className="mt-3 flex gap-1.5">
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
                </div>
              </article>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-ink-muted-48">試聴:</span>
            <Select
              value={previewMode}
              onChange={(event) => {
                stop()
                setPreviewMode(event.target.value as PreviewMode)
              }}
              className="!py-1"
            >
              <option value="melody-only">Signature Only</option>
              <option value="chords-melody">Chords + Signature</option>
            </Select>
          </div>
        </>
      )}

      {activeCandidate ? (
        <>
          {activeCandidate.plan.developmentStages && (
            <div className="rounded-lg border border-hairline bg-surface-tile-1 px-3 py-2 text-[11px] text-body-muted">
              <span className="text-ink-muted-48">Phrase展開: </span>
              {activeCandidate.plan.developmentStages.join(" → ")}
              {(activeCandidate.plan.decorationIntents?.length ?? 0) > 0 && (
                <span className="ml-3 text-primary-light">
                  Decoration統合 {activeCandidate.plan.decorationIntents.length} Gesture
                </span>
              )}
            </div>
          )}
          <ReadOnlyPianoRoll
            notes={activeCandidate.notes}
            chords={allChords.filter(
              (chord) => chord.startBeat < activeCandidate.phraseLengthBeats,
            )}
            totalBeats={activeCandidate.phraseLengthBeats}
            timeSignature={project.song.timeSignature}
            songKey={project.song.key}
            title={activeCandidate.name}
            subtitle="表示専用 · 統合Decorationを含むMIDI出力と同一"
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
              まだSignature Phrase候補がありません
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
