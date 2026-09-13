import type { PhraseLengthBars } from "@/core/phrase"
import type { SignaturePhraseLengthBars } from "@/core/signaturePhrase"
import type { SignatureGenerationDirection } from "@/core/signaturePhrase"
import type { MainTab } from "@/app/App"
import type { DecorationSettings } from "@/melody-engine/decorationGenerator"
import type {
  AiArrangementIntent,
  OrchestrationPartPlan,
  SectionOrchestrationPlan,
} from "./types"
import {
  arrangementSoundInstructionFromText,
  requestsPercussiveChordRiff,
} from "@/core/arrangementIntent"

const ROLE_BY_GENERATOR: Partial<
  Record<AiArrangementIntent["generator"], OrchestrationPartPlan["role"]>
> = {
  melody: "lead-focus",
  phrase: "lead-focus",
  signature: "lead-focus",
  counter: "counter-voice",
  decoration: "transition-color",
  accompaniment: "pulse-foundation",
  rhythm: "pulse-foundation",
}

/** AIのDirectionを、そのSection用Orchestrationの具体的な演奏役へ接続する。 */
export function performancePartForIntent(
  intent: AiArrangementIntent,
  orchestration: SectionOrchestrationPlan | undefined,
): OrchestrationPartPlan | null {
  const role = ROLE_BY_GENERATOR[intent.generator]
  if (!role || !orchestration) return null
  const exact = orchestration.parts.find((part) => part.role === role)
  if (exact) return exact
  if (role === "pulse-foundation") {
    return orchestration.parts.find((part) => part.role === "harmonic-space") ?? null
  }
  return null
}

export function targetTabForIntent(intent: AiArrangementIntent): MainTab | null {
  if (intent.generator === "signature") return "signature"
  if (intent.generator === "counter") return "counter"
  if (intent.generator === "decoration") return "decoration"
  if (intent.generator === "phrase") return "phrase"
  if (intent.generator === "melody") return "melody"
  // AccompanimentはMelody候補ではなく、Sectionへ直接適用される編曲レイヤー。
  // 確認先もMelody Generatorではなく曲全体タイムラインへ戻す。
  if (intent.generator === "accompaniment") return "arrangement"
  return null
}

export function signatureLengthForIntent(
  intent: AiArrangementIntent,
  sectionLengthBars: number,
): SignaturePhraseLengthBars {
  const maximum = Math.max(1, Math.min(8, sectionLengthBars))
  const options: SignaturePhraseLengthBars[] = [1, 2, 4, 8]
  const usable = options.filter(
    (length) => length <= maximum && length <= intent.lengthBars,
  )
  return usable.at(-1) ?? 1
}

export function phraseLengthForIntent(
  intent: AiArrangementIntent,
  sectionLengthBars: number,
): PhraseLengthBars | null {
  if (sectionLengthBars < 2) return null
  return Math.max(
    2,
    Math.min(8, sectionLengthBars, intent.lengthBars),
  ) as PhraseLengthBars
}

export function decorationSettingsForIntent(
  intent: AiArrangementIntent,
): DecorationSettings {
  return {
    type: "auto",
    character: "auto",
    direction:
      intent.motion === "ascending"
        ? "rising"
        : intent.motion === "descending"
          ? "falling"
          : "mixed",
    length: intent.lengthBars <= 2 ? 2 : 4,
    density:
      intent.density === "sparse"
        ? "sparse"
        : intent.density === "active"
          ? "rich"
          : "normal",
  }
}

export function signatureDirectionForIntent(
  intent: AiArrangementIntent,
): SignatureGenerationDirection {
  const description = [
    intent.title,
    intent.emotionalFunction,
    intent.generationBrief,
    intent.soundPalette,
    intent.performanceDirection,
    ...intent.techniques,
  ].join(" ")
  const soundInstruction = intent.soundInstruction
    ? intent.soundInstruction.enabled ? intent.soundInstruction : undefined
    : arrangementSoundInstructionFromText(description)
  const percussiveChordRiff = Boolean(
    soundInstruction?.material === "chord"
    && soundInstruction.articulation === "short"
    && (soundInstruction.behavior === "riff" || soundInstruction.behavior === "pulse"),
  ) || requestsPercussiveChordRiff(description)
  const archetype =
    intent.rhythmCharacter === "spacious"
      ? "atmospheric-gateway"
      : intent.rhythmCharacter === "pulsed"
        ? "obsessive-motor"
        : "kinetic-hook"
  const rhythmIdentity =
    intent.rhythmCharacter === "spacious"
      ? "call-gap-answer"
      : intent.rhythmCharacter === "flowing"
        ? "long-short-signal"
        : intent.rhythmCharacter === "syncopated"
          ? "syncopated-cell"
          : intent.rhythmCharacter === "pulsed"
            ? "opening-stamp"
            : "broken-pulse"
  const contour =
    intent.motion === "ascending"
      ? "ascending"
      : intent.motion === "descending"
        ? "descending"
        : intent.motion === "wave"
          ? "wave"
          : "inverted-arch"
  const directedArchetype = soundInstruction?.behavior === "riff" || soundInstruction?.behavior === "pulse"
    ? "obsessive-motor"
    : soundInstruction?.behavior === "sustain" || soundInstruction?.behavior === "swell"
      ? "atmospheric-gateway"
      : archetype
  const directedRhythm = soundInstruction?.behavior === "riff" || soundInstruction?.behavior === "hit"
    ? "opening-stamp"
    : rhythmIdentity
  const directedVoicing = soundInstruction?.material === "chord"
    ? "block-chord"
    : soundInstruction?.material === "dyad"
      ? "block-chord"
      : soundInstruction?.material === "arpeggio"
        ? "broken-chord"
        : "single-line"
  return {
    archetype: percussiveChordRiff ? "obsessive-motor" : directedArchetype,
    rhythmIdentity: percussiveChordRiff ? "opening-stamp" : directedRhythm,
    contour: soundInstruction?.motion === "static" ? contour : soundInstruction?.motion ?? contour,
    creativeRisk: soundInstruction ? "focused" : intent.creativeRisk,
    targetSilenceRatio:
      percussiveChordRiff
        ? 0.28
        : intent.silenceStrategy === "structural"
        ? 0.52
        : intent.silenceStrategy === "breathing"
          ? 0.34
          : 0.18,
    ...(soundInstruction && ["stabs", "pulse", "bell"].includes(soundInstruction.role)
      ? {
          strict: true,
          voicingMode: directedVoicing,
          repetitionStrength: soundInstruction.repetition === "none" ? 0.35 : 0.94,
          ...(percussiveChordRiff ? { riffMode: "percussive-block-chord" as const } : {}),
        }
      : {}),
  }
}
