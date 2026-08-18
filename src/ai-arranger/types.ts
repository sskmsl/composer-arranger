import type { Density, Drama } from "@/melody-engine/generationParams"
import type { MelodyFeatures } from "@/core/melody"

export type AiArrangementGenerator =
  | "melody"
  | "phrase"
  | "signature"
  | "counter"
  | "decoration"
  | "accompaniment"
  | "rhythm"
  | "none"

export type AiAccompanimentPatternId =
  | "pulse-root-fifth"
  | "arpeggio-up"
  | "chord-entry"
  | "arpeggio-five"
  | "arpeggio-six"
  | "broken-ninth"
  | "syncopated"
  | "none"

export type AiRegister = "low" | "middle" | "high"
export type AiMotion = "ascending" | "descending" | "wave" | "static"
export type AiRhythmCharacter =
  | "spacious"
  | "flowing"
  | "syncopated"
  | "pulsed"
  | "fragmented"
export type AiSilenceStrategy = "minimal" | "breathing" | "structural"
export type AiCreativeRisk = "focused" | "bold" | "radical"

export interface AiSoundSourceSuggestion {
  family: string
  character: string
  searchTerms: string[]
  reason: string
}

export interface AiRhythmPatternProposal {
  enabled: boolean
  subdivision: "eighth" | "sixteenth" | "triplet" | "mixed"
  feel: "straight" | "swing" | "laid-back" | "driving" | "broken"
  kickPattern: string
  snarePattern: string
  hatPattern: string
  percussionPattern: string
  variation: string
}

export interface AiArrangementIntent {
  id: string
  title: string
  generator: AiArrangementGenerator
  emotionalFunction: string
  density: Density
  register: AiRegister
  drama: Drama
  motion: AiMotion
  rhythmCharacter: AiRhythmCharacter
  silenceStrategy: AiSilenceStrategy
  creativeRisk: AiCreativeRisk
  lengthBars: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  techniques: string[]
  soundPalette: string
  performanceDirection: string
  why: string
  generationBrief: string
  soundSourceSuggestions: AiSoundSourceSuggestion[]
  accompanimentPatternId: AiAccompanimentPatternId
  rhythmPlan: AiRhythmPatternProposal
}

export interface AiArrangementDiagnosis {
  currentStrength: string
  primaryOpportunity: string
  protect: string[]
  avoid: string[]
  noAdditionRecommended: boolean
  audioEvidence: string[]
  audioConfidenceNote: string
}

export interface AiAudioLocalFeatures {
  durationSeconds: number
  sampleRate: number
  channelCount: number
  energyCurve: number[]
  silenceRatio: number
  dynamicRange: number
  transientDensity: number
  peakPosition: number
}

export interface AiAudioPayload {
  fileName: string
  mimeType: string
  format: "mp3" | "wav"
  sizeBytes: number
  dataBase64: string
  localFeatures: AiAudioLocalFeatures
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  estimatedCostUsd: number
}

export interface AiArrangementResponse {
  requestId: string
  createdAt: string
  model: string
  diagnosis: AiArrangementDiagnosis
  intents: [AiArrangementIntent, AiArrangementIntent, AiArrangementIntent]
  usage: AiUsage
  cached?: boolean
}

export interface AiArrangementContext {
  project: {
    title: string
    key: string
    tempo: number
    timeSignature: string
    songProfile: string
  }
  section: {
    id: string
    name: string
    role: string
    lengthBars: number
    previousRole: string | null
    nextRole: string | null
  }
  chords: Array<{
    startBeat: number
    durationBeats: number
    symbol: string
    bass: string | null
  }>
  activeMelody: {
    present: boolean
    noteCount: number
    notes: Array<{
      startBeat: number
      durationBeats: number
      pitch: number
      velocity: number
    }>
    features: MelodyFeatures | null
  }
  arrangement: {
    settings: Record<string, number | string>
    accompanimentPatternAssigned: boolean
    assignedAccompanimentPatternId: string | null
    availableAccompanimentPatterns: Array<{
      id: string
      name: string
      lengthBeats: number
      onsetBeats: number[]
      degreeSequence: number[]
    }>
    counterAssigned: boolean
    decorationAssigned: boolean
  }
  techniquePreferences: Record<string, string[]>
}

export interface AiArrangementRequest {
  prompt: string
  context: AiArrangementContext
  audio?: AiAudioPayload
}
