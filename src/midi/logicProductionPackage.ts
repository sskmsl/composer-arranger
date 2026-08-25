import { voiceChord } from "@/audio/chordVoicing"
import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote } from "@/core/melody"
import type { ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import {
  buildMultiPartArrangementPackage,
  type MultiPartArrangementPackage,
} from "@/ai-arranger/multiPartArrangementPackage"
import type { WholeSongDirectionId } from "@/ai-arranger/wholeSongDirectionPlan"
import { buildSmf, TICKS_PER_QUARTER, type SmfTrack } from "./smf"

export type LogicProductionTrackId =
  | "bass-guide"
  | "chord-guide"
  | "active-melody"
  | "melody-accompaniment"
  | "pulse"
  | "counter"
  | "decoration"

export interface LogicSoundRecommendation {
  library: "Native Instruments Komplete 15 Ultimate" | "u-he Repro"
  product: string
  searchTerms: string[]
  reason: string
}

export interface LogicProductionTrackPlan {
  id: LogicProductionTrackId
  trackName: string
  role: string
  noteCount: number
  status: "ready" | "guide" | "empty"
  pitchRange: string
  purpose: string
  performance: string
  panorama: string
  reverb: string
  recommendations: LogicSoundRecommendation[]
}

export interface LogicProductionPackage {
  version: "1.0.0"
  title: string
  directionId: WholeSongDirectionId
  directionTitle: string
  totalBars: number
  midi: Uint8Array
  guideMarkdown: string
  tracks: LogicProductionTrackPlan[]
  arrangement: MultiPartArrangementPackage
}

interface TrackSource {
  id: LogicProductionTrackId
  name: string
  notes: MelodyNote[]
  statusWithoutNotes: LogicProductionTrackPlan["status"]
  role: string
  purpose: string
  performance: string
  panorama: string
  reverb: string
  recommendations: LogicSoundRecommendation[]
}

const MIDI_CHANNEL_1 = 0

function beatsToTicks(beats: number): number {
  return Math.round(beats * TICKS_PER_QUARTER)
}

function midiName(pitch: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`
}

function pitchRange(notes: MelodyNote[]): string {
  if (notes.length === 0) return "未生成"
  const pitches = notes.map((note) => note.pitch)
  return `${midiName(Math.min(...pitches))}–${midiName(Math.max(...pitches))}`
}

function chordGuideNotes(project: ComposerProject): {
  bass: MelodyNote[]
  upper: MelodyNote[]
} {
  const material = buildSongPlaybackMaterial(project)
  const bass: MelodyNote[] = []
  const upper: MelodyNote[] = []
  for (const [index, chord] of material.chords.entries()) {
    const parsed = parseChordSymbol(chord.symbol, chord.bass ?? undefined)
    if (!parsed) continue
    const voicing = voiceChord(parsed)
    bass.push({
      id: `logic:bass:${index}`,
      pitch: voicing.bassMidi,
      startBeat: chord.startBeat,
      durationBeats: chord.durationBeats,
      velocity: 68,
      locks: [],
    })
    for (const [pitchIndex, pitch] of voicing.upperMidi.entries()) {
      upper.push({
        id: `logic:chord:${index}:${pitchIndex}`,
        pitch,
        startBeat: chord.startBeat,
        durationBeats: chord.durationBeats,
        velocity: 56,
        locks: [],
      })
    }
  }
  return { bass, upper }
}

function sources(project: ComposerProject): TrackSource[] {
  const material = buildSongPlaybackMaterial(project)
  const guides = chordGuideNotes(project)
  return [
    {
      id: "bass-guide", name: "01 Bass Guide", notes: guides.bass, statusWithoutNotes: "empty",
      role: "低域の重心ガイド", purpose: "コードのルート説明ではなく、Logic上で専用Bass Lineを作る開始点にする。",
      performance: "長さを毎コード均等にせず、Kickの前後へ休符を作る。完成Bassへ置換する前提。",
      panorama: "Center", reverb: "原則Dry。Sendは最小限。",
      recommendations: [{ library: "u-he Repro", product: "Repro-1", searchTerms: ["dark mono bass", "rounded sub bass", "muted bass"], reason: "単音の重心とフィルター変化を作りやすい。" }],
    },
    {
      id: "chord-guide", name: "02 Chord Guide", notes: guides.upper, statusWithoutNotes: "empty",
      role: "Harmony Guide", purpose: "和声確認用。完成アレンジでは全構成音を常時鳴らさず、PadまたはPianoへ分配する。",
      performance: "共通音を保持し、主旋律の音域を避ける。Climax前は最高音を温存する。",
      panorama: "Center〜±20", reverb: "楽器に応じてShort RoomまたはLong Hallへ置換。",
      recommendations: [
        { library: "u-he Repro", product: "Repro-5", searchTerms: ["soft poly pad", "dark sustained chord", "slow attack pad"], reason: "幅を持つ和声と緩やかなFilter変化に向く。" },
        { library: "Native Instruments Komplete 15 Ultimate", product: "Noire", searchTerms: ["felt", "pure", "soft cinematic piano"], reason: "和声を説明しすぎない減衰と余白を作れる。" },
      ],
    },
    {
      id: "active-melody", name: "03 Active Melody", notes: material.lead, statusWithoutNotes: "empty",
      role: "Lead", purpose: "曲の主権を持つ旋律。ほかの全パートはこのトラックの感情点を避ける。",
      performance: "最高音・長音・跳躍着地を単独で到達させ、補助アタックを重ねない。",
      panorama: "Center", reverb: "Dryな前景＋別Busの長いTail。原音を遠ざけすぎない。",
      recommendations: [
        { library: "Native Instruments Komplete 15 Ultimate", product: "Una Corda", searchTerms: ["felt intimate", "soft attack", "resonant"], reason: "仮メロディの輪郭と呼吸を確認しやすい。" },
        { library: "Native Instruments Komplete 15 Ultimate", product: "Noire", searchTerms: ["pure", "felt", "intimate piano"], reason: "Neutral Auditionと感情点の確認に使いやすい。" },
      ],
    },
    {
      id: "melody-accompaniment", name: "04 Melody Accompaniment", notes: material.accompaniment, statusWithoutNotes: "empty",
      role: "Motif / Ostinato", purpose: "Melody Variant内の補助レイヤーを独立編集する。",
      performance: "Leadと同時アタックを続けず、反復の一部を抜いて呼吸を作る。",
      panorama: "±15〜35", reverb: "Short PlateまたはTempo Delay。Leadより後景。",
      recommendations: [{ library: "u-he Repro", product: "Repro-1", searchTerms: ["muted sequence", "soft pluck", "dark pulse"], reason: "短いMotifと局所的なFilter motionに向く。" }],
    },
    {
      id: "pulse", name: "05 Accompaniment Pulse", notes: material.accompanimentPattern, statusWithoutNotes: "empty",
      role: "Rhythm / Pulse", purpose: "周期とアクセントでSectionの歩幅を作る。完成DrumsまたはSynth Pulseへ置換可能。",
      performance: "1拍目を毎回強調せず、Section境界前の最後の一打を抜く。",
      panorama: "LowはCenter、Click成分は±10〜25", reverb: "LowはDry、Accentだけ短いRoom。",
      recommendations: [
        { library: "Native Instruments Komplete 15 Ultimate", product: "Battery 4", searchTerms: ["dry electronic kick", "short dark click", "muted percussion"], reason: "Kick・Click・Percを役割別に分けやすい。" },
        { library: "u-he Repro", product: "Repro-1", searchTerms: ["analog pulse", "muted sequence", "short bass pluck"], reason: "ドラム以外の周期として使える。" },
      ],
    },
    {
      id: "counter", name: "06 Counter", notes: material.counterLayers, statusWithoutNotes: "empty",
      role: "Counter Voice", purpose: "Leadを二重化せず、長音と休符へ別視点から応答する。",
      performance: "Leadの次の重要アタックより前に退き、跳躍後は反対方向へ回収する。",
      panorama: "±20〜40", reverb: "LeadよりWet。Early Reflectionは控えめ。",
      recommendations: [
        { library: "Native Instruments Komplete 15 Ultimate", product: "Session Strings Pro 2", searchTerms: ["soft legato ensemble", "sul tasto", "dynamic long"], reason: "内声・上昇線・応答線を奏法で分けられる。" },
        { library: "u-he Repro", product: "Repro-5", searchTerms: ["soft poly lead", "dark string pad", "slow ensemble"], reason: "生Stringsと異なる遠景のCounterに向く。" },
      ],
    },
    {
      id: "decoration", name: "07 Decoration and Transition", notes: material.decorationLayers, statusWithoutNotes: "empty",
      role: "Color / Transition", purpose: "効果音ではなく、Section間の時間と残響を演奏する。",
      performance: "次Sectionの主要アタックと重ねず、直前またはTailだけで接続する。",
      panorama: "非対称±25〜60", reverb: "Long Hall／Reverse Tail。Low Cutして前景を空ける。",
      recommendations: [
        { library: "Native Instruments Komplete 15 Ultimate", product: "Playbox", searchTerms: ["glass bell", "organic texture", "reverse tonal"], reason: "短い色彩と異質なレイヤーを組み合わせやすい。" },
        { library: "Native Instruments Komplete 15 Ultimate", product: "Una Corda", searchTerms: ["reverse piano", "resonance", "prepared texture"], reason: "ピアノ由来の残響とTransition素材に向く。" },
      ],
    },
  ]
}

function toSmfTrack(source: TrackSource): SmfTrack {
  return {
    name: source.name,
    notes: source.notes.map((note) => ({
      pitch: note.pitch,
      start: beatsToTicks(note.startBeat),
      duration: beatsToTicks(note.durationBeats),
      velocity: note.velocity,
      channel: MIDI_CHANNEL_1,
    })),
  }
}

function markdown(
  project: ComposerProject,
  directionTitle: string,
  tracks: LogicProductionTrackPlan[],
  arrangement: MultiPartArrangementPackage,
): string {
  const lines = [
    `# ${project.title} — Logic Pro Production Guide`,
    "",
    `- Key: ${project.song.key}`,
    `- Tempo: ${project.song.tempo} BPM`,
    `- Time Signature: ${project.song.timeSignature}`,
    `- Arrangement Direction: ${directionTitle}`,
    `- Plan Quality: ${arrangement.qualityGate.status} / ${arrangement.qualityGate.score}`,
    `- Active Audio Quality: ${arrangement.executionGate.status} / ${arrangement.executionGate.score}`,
    "",
    "## Import",
    "",
    "MIDIは曲頭1小節目を基準にしたSMF Type 1です。Logic Proへ読み込むと、各Roleが独立トラックとして同じ小節位置へ配置されます。Bass GuideとChord Guideは完成演奏ではなく置換用の設計ガイドです。",
    "",
    "## Tracks",
    "",
  ]
  for (const track of tracks) {
    lines.push(
      `### ${track.trackName}`,
      "",
      `- Role: ${track.role}`,
      `- Notes: ${track.noteCount}`,
      `- Range: ${track.pitchRange}`,
      `- Purpose: ${track.purpose}`,
      `- Performance: ${track.performance}`,
      `- Panorama: ${track.panorama}`,
      `- Reverb: ${track.reverb}`,
      `- Sound sources: ${track.recommendations.map((item) => `${item.product} [${item.searchTerms.join(" / ")}]`).join("; ")}`,
      "",
    )
  }
  lines.push("## Section Role Matrix", "")
  for (const section of arrangement.sections) {
    lines.push(`### ${section.sectionName} — Energy ${section.targetEnergy}`, "")
    for (const part of section.parts) {
      lines.push(`- ${part.partRole}: ${part.state} — ${part.purpose}`)
    }
    lines.push("")
  }
  lines.push("## Quality Gate", "")
  for (const finding of [...arrangement.executionGate.findings, ...arrangement.qualityGate.findings]) {
    lines.push(`- ${finding.title}: ${finding.recommendation}`)
  }
  lines.push("")
  return lines.join("\n")
}

export function buildLogicProductionPackage(
  project: ComposerProject,
  directionId: WholeSongDirectionId,
): LogicProductionPackage {
  const ts = parseTimeSignature(project.song.timeSignature)
  const arrangement = buildMultiPartArrangementPackage(project, directionId)
  const sourceTracks = sources(project)
  const tracks: LogicProductionTrackPlan[] = sourceTracks.map((source) => ({
    id: source.id,
    trackName: source.name,
    role: source.role,
    noteCount: source.notes.length,
    status: source.notes.length > 0
      ? source.id === "bass-guide" || source.id === "chord-guide" ? "guide" : "ready"
      : source.statusWithoutNotes,
    pitchRange: pitchRange(source.notes),
    purpose: source.purpose,
    performance: source.performance,
    panorama: source.panorama,
    reverb: source.reverb,
    recommendations: source.recommendations,
  }))
  const midi = buildSmf({
    name: `${project.title} Logic Production Package`,
    tempoBpm: project.song.tempo,
    timeSignature: ts,
    markers: project.sections.map((section) => ({
      tick: beatsToTicks((section.startBar - 1) * ts.beatsPerBar),
      text: section.name,
    })),
    tracks: sourceTracks.filter((source) => source.notes.length > 0).map(toSmfTrack),
  })
  const directionTitle = arrangement.title
  return {
    version: "1.0.0",
    title: project.title,
    directionId,
    directionTitle,
    totalBars: project.sections.reduce((sum, section) => sum + Math.max(1, section.lengthBars), 0),
    midi,
    tracks,
    arrangement,
    guideMarkdown: markdown(project, directionTitle, tracks, arrangement),
  }
}

export function downloadProductionGuide(markdownText: string, filename: string): void {
  const blob = new Blob([markdownText], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename.endsWith(".md") ? filename : `${filename}.md`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
