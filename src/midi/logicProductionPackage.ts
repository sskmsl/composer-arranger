import { songTempoChanges } from "@/core/tempoMap"
import { voiceChord } from "@/audio/chordVoicing"
import { parseChordSymbol } from "@/core/chord"
import type { MelodyNote } from "@/core/melody"
import type { ComposerProject } from "@/core/project"
import type { ArrangementTrackId } from "@/core/arrangementGeneration"
import { parseTimeSignature } from "@/core/section"
import { buildSongPlaybackMaterial } from "@/core/sectionTimeline"
import {
  buildMultiPartArrangementPackage,
  type MultiPartArrangementPackage,
} from "@/ai-arranger/multiPartArrangementPackage"
import type { WholeSongDirectionId } from "@/ai-arranger/wholeSongDirectionPlan"
import { buildSmf, TICKS_PER_QUARTER, type SmfTrack } from "./smf"
import { arrangementTrackLabel } from "@/core/arrangementChat"

export type LogicProductionTrackId =
  | "bass-guide"
  | "chord-guide"
  | "active-melody"
  | "melody-accompaniment"
  | "pulse"
  | "counter"
  | "decoration"
  | "selected-phrase"
  | "selected-intro-phrase"

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
  const material = buildSongPlaybackMaterial(
    project,
    project.fullSongArrangement?.plan.directive?.timelineConstraints,
  )
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
  const material = buildSongPlaybackMaterial(
    project,
    project.fullSongArrangement?.plan.directive?.timelineConstraints,
  )
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
    {
      id: "selected-phrase", name: "08 Selected Phrase", notes: material.phraseLayers, statusWithoutNotes: "empty",
      role: "Adopted Phrase", purpose: "短いフレーズ画面で全曲採用した素材を、曲中の採用位置へ配置する。",
      performance: "主旋律と競合する場合は音色を後景へ置き、採用したリズムと音価は保持する。",
      panorama: "音色に応じてCenter〜±35", reverb: "主旋律より少し後景。",
      recommendations: [{ library: "u-he Repro", product: "Repro-1", searchTerms: ["short motif", "soft pluck", "muted sequence"], reason: "短い素材の輪郭と発音を確認しやすい。" }],
    },
    {
      id: "selected-intro-phrase", name: "09 Selected Intro Phrase", notes: material.signaturePhraseLayers, statusWithoutNotes: "empty",
      role: "Adopted Intro Phrase", purpose: "イントロフレーズ画面で全曲採用した素材を、曲中の採用位置へ配置する。",
      performance: "候補固有の反復・和音・余白を保ち、主旋律より前に曲の印象を提示する。",
      panorama: "Center〜±30", reverb: "必要に応じて短いRoomまたはTempo Delay。",
      recommendations: [{ library: "Native Instruments Komplete 15 Ultimate", product: "Playbox", searchTerms: ["tonal motif", "short chord", "rhythmic texture"], reason: "単音・和音・リズム素材のいずれにも割り当てやすい。" }],
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
    "MIDIはイントロの1小節目を基準にしたSMF Type 1です。Logic Proへ読み込むと、各Roleが独立トラックとして同じ小節位置へ配置されます。Bass GuideとChord Guideは完成演奏ではなく置換用の設計ガイドです。",
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
    tempoChanges: songTempoChanges(project).map((change) => ({ tick: beatsToTicks(change.beat), bpm: change.bpm })),
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

/** アレンジ画面「Logic Pro用の書き出し」の1行。曲全体MIDIのトラック名と、おすすめ音源・プリセット・一言の設定 */
export interface LogicSoundRow {
  trackName: string
  role: string
  product: string
  /** 実在するFactory preset名、またはKontaktで読み込む実在ライブラリ／楽器名。 */
  preset: string
  /** Logic Proのフェーダーへ設定する開始目安。最終値ではなく、全体のヘッドルームを確保する基準。 */
  volumeDb: number
  setting: string
}

export interface LogicSoundPalette {
  dominantFamily: LogicSoundWorldFamily
  supportingFamilies: LogicSoundWorldFamily[]
  title: string
  description: string
  coreSounds: string[]
  mixFocus: string
  reason: string
}

export type LogicSoundWorldFamily =
  | "strings"
  | "band"
  | "synth"
  | "piano"
  | "percussion"
  | "hybrid"

interface LogicSoundWorld extends LogicSoundPalette {
  directionId: WholeSongDirectionId
}

/** 曲全体MIDI(exportSongMidi)で使うトラック名 */
const SONG_MIDI_TRACK_NAMES: Partial<Record<LogicProductionTrackId, string>> = {
  "chord-guide": "Chords",
  "active-melody": "Active Melodies",
  "melody-accompaniment": "Accompaniment",
  pulse: "Accompaniment Pattern",
  counter: "Selected Counter Melody",
  decoration: "Selected Decoration",
  "selected-phrase": "Selected Phrases",
  "selected-intro-phrase": "Selected Intro Phrases",
}

/** Logic表の「パート」欄に出す日本語名 */
const SONG_TRACK_ROLES: Partial<Record<LogicProductionTrackId, string>> = {
  "chord-guide": "コード（ベース音を含む）",
  "active-melody": "主旋律",
  "melody-accompaniment": "主旋律の伴奏",
  pulse: "伴奏パターン",
  counter: "対旋律",
  decoration: "合いの手・装飾",
  "selected-phrase": "短いフレーズ",
  "selected-intro-phrase": "イントロのフレーズ",
}

type OwnedSound = Pick<LogicSoundRow, "product" | "preset" | "setting"> & {
  match: (id: ArrangementTrackId) => boolean
  role: string
}

type SoundDetails = Omit<OwnedSound, "match">

/**
 * この制作環境で確認できた所有音源だけを使う。Reproは端末上のFactory .h2pと
 * 一致する「フォルダ / プリセット名」、Kontakt音源は実在する読み込み先を示す。
 */
const ARRANGEMENT_SOUNDS: OwnedSound[] = [
  { match: (id) => ["dr-kick", "dr-kick-sub", "dr-kick-click"].includes(id), role: "キック", product: "Battery 4", preset: "Battery 4 Factory Library / Kits / Elektro 500 Kit", setting: "低いキックを中心に置き、クリック成分は小さめ／残響 なし〜短め" },
  { match: (id) => ["dr-snare", "dr-snare-body", "dr-clap"].includes(id), role: "スネア", product: "Kontakt 8", preset: "Butch Vig Drums / Factory Kit", setting: "Kontakt 8内でButch Vig Drumsを開く。胴鳴りとクラップを同じ音量にせず、主役は中央／残響 短め" },
  { match: (id) => ["dr-closed-hat", "dr-open-hat", "dr-ride", "dr-crash"].includes(id), role: "シンバル", product: "Kontakt 8", preset: "Studio Drummer / Factory Kit", setting: "Kontakt 8内でStudio Drummerを開く。ハイハットは控えめ、オープンとクラッシュは節目だけ" },
  { match: (id) => ["dr-field-drum", "dr-low-tom", "dr-high-tom", "dr-shaker", "dr-percussion-high"].includes(id), role: "パーカッション", product: "Kontakt 8", preset: "Session Percussionist / Factory Preset", setting: "Kontakt 8内でSession Percussionistを開く。主旋律の切れ目だけに置き、フィル後半へ向けて少し強くする" },
  { match: (id) => ["dr-gran-cassa", "dr-cymbal-swell", "dr-impact"].includes(id), role: "大きな打撃", product: "Kontakt 8", preset: "Damage / Factory Kit", setting: "Kontakt 8内でDamageを開く。セクションの境目だけで鳴らし、連打しない／低音の余韻を整理" },
  { match: (id) => id === "syn-bass", role: "ベース", product: "Repro-1", preset: "01 Basses / EH Heavy Pulse Bass", setting: "音を短めに切り、キックと重ねない／定位 中央／残響 なし" },
  { match: (id) => id === "syn-sub-bass", role: "サブベース", product: "Repro-1", preset: "1981 Historic / 14 Bass Synth Sustain", setting: "最低音だけを薄く支え、長く重なる場所は短くする／定位 中央" },
  { match: (id) => id === "syn-bass-mid", role: "中域ベース", product: "Kontakt 8", preset: "Session Bassist - Prime Bass / Prime Bass", setting: "Kontakt 8内でPrime Bassを開く。高くなりすぎる音を避け、シンセベースより少し奥へ置く" },
  { match: (id) => id === "syn-pulse", role: "短く繰り返すシンセ", product: "Repro-1", preset: "07 Seq - Melodic / HS Metronomi", setting: "短く歯切れよく／定位 左右15／ディレイは少量" },
  { match: (id) => id === "syn-arp-low", role: "低い分散音", product: "Repro-1", preset: "06 Arpeggios / EH Classic Runner", setting: "ベースの邪魔をしない音域へ上げ、主旋律が動く所では音数を減らす" },
  { match: (id) => id === "syn-arp-high", role: "高い分散音", product: "Repro-1", preset: "07 Seq - Melodic / SA Shimmer Sequence", setting: "サビや後半だけに使い、音量を抑える／定位 左右25" },
  { match: (id) => id === "syn-stabs", role: "短い和音", product: "Repro-5", preset: "03 Keys - Synths / JH Midrange Synthstab (MW)", setting: "一音ごとの輪郭を残し、主旋律と同時に強く鳴らさない／残響 短め" },
  { match: (id) => id === "syn-chord-wide", role: "広い和音", product: "Repro-5", preset: "07 Chords / HS Seventh Soft", setting: "左右へ広げるが低音は中央から外す／残響 中程度" },
  { match: (id) => id === "syn-dark-pad", role: "暗い背景の和音", product: "Repro-5", preset: "09 Pads - Orchestral / EH Dark Emotion Pad", setting: "ゆっくり立ち上げ、主旋律の音域を避ける／定位 広め" },
  { match: (id) => id === "syn-pad-air", role: "薄い高域パッド", product: "Repro-5", preset: "08 Pads - Synths / HS Glass Glider", setting: "高域を小さく足し、主旋律が高い所では休ませる／残響 長め" },
  { match: (id) => id === "syn-pad-motion", role: "動くパッド", product: "Repro-5", preset: "08 Pads - Synths / SD Musical Sync", setting: "動きは背景に留め、ほかの反復音がある場所では使わない" },
  { match: (id) => id === "syn-high-glass", role: "高音のきらめき", product: "Repro-5", preset: "05 Keys - Plucks & Mallets / SD Synthetic Bells", setting: "音量は控えめに、一音ずつ置く／定位 左右40／残響 長め" },
  { match: (id) => id === "syn-transition-phrase", role: "つなぎのフレーズ", product: "Repro-5", preset: "10 Effects / EH Mod-ex Q Sweep", setting: "セクションの境目だけで鳴らし、次の主旋律が始まる前に消す" },
  { match: (id) => id === "syn-final-lift", role: "最後の広がり", product: "Repro-5", preset: "09 Pads - Orchestral / TUC Brass Crescendo", setting: "最後のサビだけに使い、ゆっくり大きくする／定位 広め" },
]

function selectedDirection(project: ComposerProject): WholeSongDirectionId {
  return project.arrangementDirectorWorkspace?.selectedDirectionId ?? "balanced-architecture"
}

const SOUND_FAMILY_LABELS: Record<LogicSoundWorldFamily, string> = {
  strings: "弦",
  band: "バンド",
  synth: "シンセ",
  piano: "鍵盤",
  percussion: "リズム",
  hybrid: "生音と電子音",
}

const DIRECTION_FAMILY_SCORES: Record<WholeSongDirectionId, Record<LogicSoundWorldFamily, number>> = {
  "preserve-space": { strings: 2.4, band: 0.8, synth: 0.8, piano: 2.2, percussion: 0.2, hybrid: 1.4 },
  "controlled-escalation": { strings: 2.8, band: 1.0, synth: 1.2, piano: 1.2, percussion: 1.2, hybrid: 2.2 },
  "rhythmic-propulsion": { strings: 0.6, band: 2.4, synth: 2.0, piano: 0.4, percussion: 3.0, hybrid: 1.4 },
  "motif-relay": { strings: 1.4, band: 1.0, synth: 2.6, piano: 1.2, percussion: 0.8, hybrid: 2.0 },
  "balanced-architecture": { strings: 1.2, band: 1.4, synth: 1.4, piano: 1.2, percussion: 1.0, hybrid: 2.4 },
}

function addScore(scores: Record<LogicSoundWorldFamily, number>, family: LogicSoundWorldFamily, value: number): void {
  scores[family] += value
}

function briefForSoundWorld(project: ComposerProject): string {
  return [
    project.arrangementDirectorWorkspace?.brief,
    project.fullSongArrangement?.plan.brief,
  ].filter(Boolean).join(" ").toLowerCase()
}

const BRIEF_FAMILY_SIGNALS: Array<[LogicSoundWorldFamily, RegExp]> = [
    ["strings", /弦|ストリング|strings?|orchestr|オーケストラ|室内楽/iu],
    ["band", /ギター|バンド|ロック|生演奏|guitar|band|rock/iu],
    ["synth", /シンセ|電子|テクノ|エレクトロ|アナログ|synth|techno|electro/iu],
    ["piano", /ピアノ|鍵盤|フェルト|piano|keys?|felt/iu],
    ["percussion", /ドラム|打楽器|パーカッション|ビート|リズム主体|drums?|percussion|beat/iu],
    ["hybrid", /ハイブリッド|生音.*電子|電子.*生音|hybrid/iu],
]

interface BriefFamilyIntent {
  requested: LogicSoundWorldFamily[]
  excluded: LogicSoundWorldFamily[]
  lead: LogicSoundWorldFamily | null
}

function familyIsExcluded(brief: string, pattern: RegExp): boolean {
  const source = pattern.source
  return new RegExp(`(?:${source})(?:を|は|が|系)?[^。、「」,]{0,8}(?:なし|使わない|使わず|抜き|除外|以外)`, "iu").test(brief)
}

function scoreBrief(scores: Record<LogicSoundWorldFamily, number>, brief: string): BriefFamilyIntent {
  const excluded = BRIEF_FAMILY_SIGNALS
    .filter(([, pattern]) => familyIsExcluded(brief, pattern))
    .map(([family]) => family)
  const requested: LogicSoundWorldFamily[] = []
  for (const [family, pattern] of BRIEF_FAMILY_SIGNALS) {
    if (excluded.includes(family) || !pattern.test(brief)) continue
    // 「主体」がなくても、利用者が列挙した音源は世界観の候補として優先する。
    addScore(scores, family, 12)
    requested.push(family)
  }
  const leadRequests: Array<[LogicSoundWorldFamily, RegExp]> = [
    ["strings", /(?:弦|ストリング|strings?).{0,8}(?:主体|中心|主役)/iu],
    ["band", /(?:ギター|バンド|guitar|band).{0,8}(?:主体|中心|主役)/iu],
    ["synth", /(?:シンセ|電子|synth).{0,8}(?:主体|中心|主役)/iu],
    ["piano", /(?:ピアノ|鍵盤|piano|keys?).{0,8}(?:主体|中心|主役)/iu],
    ["percussion", /(?:ドラム|打楽器|パーカッション|drums?|percussion).{0,8}(?:主体|中心|主役)/iu],
  ]
  for (const [family, pattern] of leadRequests) {
    if (!excluded.includes(family) && pattern.test(brief)) addScore(scores, family, 8)
  }
  // ギター／ベースと生ドラムをまとめて求める指示は、ドラム単体ではなくバンド編成として扱う。
  if (requested.includes("band") && requested.includes("percussion")) addScore(scores, "band", 10)
  const lead = explicitlyRequestedLeadFamily(brief, excluded)
  return { requested, excluded, lead }
}

function explicitlyRequestedLeadFamily(
  brief: string,
  excluded: readonly LogicSoundWorldFamily[] = [],
): LogicSoundWorldFamily | null {
  if (!excluded.includes("band") && !excluded.includes("percussion") && /(?:ギター|バンド|guitar|band)/iu.test(brief) && /(?:ドラム|打楽器|drums?|percussion)/iu.test(brief) && /主体|中心|主役/iu.test(brief)) return "band"
  const patterns: Array<[LogicSoundWorldFamily, RegExp]> = [
    ["strings", /(?:弦|ストリング|strings?).{0,12}(?:主体|中心|主役)/iu],
    ["band", /(?:ギター|バンド|guitar|band).{0,12}(?:主体|中心|主役)/iu],
    ["synth", /(?:シンセ|電子|synth).{0,12}(?:主体|中心|主役)/iu],
    ["piano", /(?:ピアノ|鍵盤|piano|keys?).{0,12}(?:主体|中心|主役)/iu],
    ["percussion", /(?:ドラム|打楽器|パーカッション|drums?|percussion).{0,12}(?:主体|中心|主役)/iu],
  ]
  return patterns.find(([family, pattern]) => !excluded.includes(family) && pattern.test(brief))?.[0] ?? null
}

function scoreArrangementTracks(project: ComposerProject, scores: Record<LogicSoundWorldFamily, number>): void {
  const activity = new Map<LogicSoundWorldFamily, { notes: number; soundingBeats: number; weightedVelocity: number }>()
  const collect = (family: LogicSoundWorldFamily, track: NonNullable<ComposerProject["fullSongArrangement"]>["tracks"][number], share = 1) => {
    const current = activity.get(family) ?? { notes: 0, soundingBeats: 0, weightedVelocity: 0 }
    for (const note of track.notes) {
      current.notes += share
      current.soundingBeats += Math.min(8, note.durationBeats) * share
      current.weightedVelocity += note.velocity * share
    }
    activity.set(family, current)
  }
  for (const track of project.fullSongArrangement?.tracks ?? []) {
    if (track.muted || track.notes.length === 0) continue
    if (track.id.startsWith("str-")) collect("strings", track)
    else if (track.id.startsWith("dr-")) collect("percussion", track)
    else if (["syn-bass", "syn-bass-mid"].includes(track.id)) {
      collect("band", track, 0.7)
      collect("synth", track, 0.3)
    } else if (track.id === "syn-sub-bass") {
      collect("synth", track)
    } else if (["syn-stabs", "syn-chord-wide"].includes(track.id)) {
      collect("piano", track, 0.4)
      collect("band", track, 0.25)
      collect("synth", track, 0.35)
    } else if (track.id.startsWith("syn-")) {
      collect("synth", track)
    }
  }
  const values = [...activity.values()]
  const maxNotes = Math.max(1, ...values.map((value) => value.notes))
  const maxBeats = Math.max(1, ...values.map((value) => value.soundingBeats))
  for (const [family, value] of activity) {
    const averageVelocity = value.weightedVelocity / Math.max(1, value.notes)
    const normalizedAmount = Math.sqrt(value.notes / maxNotes) * 2
      + Math.sqrt(value.soundingBeats / maxBeats) * 2
      + Math.min(1, averageVelocity / 100) * 0.75
    // 多数のドラム分割トラックを、同じ数の独立した主役として数えない。
    addScore(scores, family, normalizedAmount * (family === "percussion" ? 0.78 : 1))
  }
}

function scoreSongShape(project: ComposerProject, scores: Record<LogicSoundWorldFamily, number>): void {
  const tempo = project.fullSongArrangement?.analysis.bpm ?? project.song.tempo
  if (tempo >= 124) {
    addScore(scores, "percussion", 1.7)
    addScore(scores, "synth", 1.2)
  } else if (tempo <= 84) {
    addScore(scores, "piano", 1.4)
    addScore(scores, "strings", 1.1)
  }
  const sections = project.fullSongArrangement?.analysis.sections ?? []
  if (sections.length === 0) return
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const restRatio = average(sections.map((section) => section.melodyRestRatio))
  const repetition = average(sections.map((section) => Math.max(section.chordRepetition, section.melodyRepetition)))
  const energies = sections.map((section) => section.energy)
  const energyRange = Math.max(...energies) - Math.min(...energies)
  if (restRatio >= 0.28) {
    addScore(scores, "strings", 1.0)
    addScore(scores, "piano", 0.8)
  }
  if (repetition >= 0.58) {
    addScore(scores, "synth", 1.0)
    addScore(scores, "percussion", 0.7)
  }
  if (energyRange >= 35) {
    addScore(scores, "strings", 0.8)
    addScore(scores, "hybrid", 1.1)
  }
}

function coreSoundsFor(family: LogicSoundWorldFamily, direction: WholeSongDirectionId): string[] {
  if (family === "strings") {
    if (direction === "rhythmic-propulsion") return ["Session Strings Pro 2", "LUX Orchestral Strings Elements", "Session Bassist - Prime Bass", "Studio Drummer", "Repro-1"]
    if (direction === "controlled-escalation") return ["LUX Orchestral Strings Elements", "Emotive Strings", "Symphony Essentials Percussion", "Piano Colors", "Straylight"]
    return ["Emotive Strings", "Session Strings Pro 2", "LUX Orchestral Strings Elements", "Noire", "Ethereal Earth"]
  }
  if (family === "band") {
    const guitar = direction === "preserve-space" ? "Session Guitarist - Picked Nylon"
      : direction === "motif-relay" ? "Session Guitarist - Electric Vintage"
        : direction === "controlled-escalation" ? "Session Guitarist - Electric Sunburst Deluxe"
          : "Session Guitarist - Electric Mint"
    return [guitar, "Session Bassist - Icon Bass", "Studio Drummer", "Noire", "Repro-1"]
  }
  if (family === "synth") return ["Repro-1", "Repro-5", "Schema Dark", "Analog Dreams", "Straylight"]
  if (family === "piano") return ["Noire", "Piano Colors", "Una Corda", "Emotive Strings", "Ethereal Earth"]
  if (family === "percussion") return ["Battery 4", "Studio Drummer", "Butch Vig Drums", "Session Percussionist", "Damage"]
  return direction === "motif-relay"
    ? ["Schema Dark", "Session Guitarist - Electric Vintage", "Emotive Strings", "Playbox", "Butch Vig Drums"]
    : ["Noire", "Repro-5", "Session Bassist - Prime Bass", "Session Strings Pro 2", "Studio Drummer"]
}

function soundWorldCopy(family: LogicSoundWorldFamily, direction: WholeSongDirectionId): Omit<LogicSoundPalette, "dominantFamily" | "supportingFamilies" | "reason"> {
  const directionPhrase: Record<WholeSongDirectionId, string> = {
    "preserve-space": "音数を詰めず、近い音と遠い余韻の差を保ちます。",
    "controlled-escalation": "前半は小さく、後半へ向けて使う音域と音色を段階的に開きます。",
    "rhythmic-propulsion": "短い発音と明確なタイミングを優先し、重い持続音は控えます。",
    "motif-relay": "特徴的な短い音を一度に一つだけ前へ出し、別の音色へ受け渡します。",
    "balanced-architecture": "主旋律を中心に、生音と電子音が同じ場所で競わないよう分担します。",
  }
  const copy: Record<LogicSoundWorldFamily, { title: string; description: string; mixFocus: string }> = {
    strings: { title: "弦の表情が曲を動かす世界", description: "長い弦、短い弦、低い弦を別のライブラリへ分け、同じストリングス音色の重ね録りにはしません。", mixFocus: "主旋律に近い弦は一つまで。残りは音域と距離を分け、全員を同じ強さで鳴らさない。" },
    band: { title: "奏者の距離が見えるバンドの世界", description: "ギター、ベース、ドラム、鍵盤を独立した奏者として割り当て、シンセは必要な背景だけに使います。", mixFocus: "キックとベースを中央へ置き、ギターと鍵盤は左右と音域を分ける。" },
    synth: { title: "アナログシンセが形を変える世界", description: "Reproの芯、SchemaとStraylightの質感、Analog Dreamsの動きを役割ごとに使い分けます。", mixFocus: "低いシンセ、反復音、広いパッドを同時に前へ出さず、主役をセクションごとに交代する。" },
    piano: { title: "鍵盤の手触りから広がる世界", description: "Noire、Piano Colors、Una Cordaを同じピアノ扱いにせず、輪郭・色・近さの役割に分けます。", mixFocus: "鍵盤の中域を空けて主旋律を通し、弦と質感音は残響の奥へ置く。" },
    percussion: { title: "打音の個性で景色を作る世界", description: "Battery、Studio Drummer、Butch Vig Drums、Session Percussionistを役割別に使い、キット一つで全曲を埋めません。", mixFocus: "キックとスネア以外は小さく始め、節目の打撃だけに十分な余白を残す。" },
    hybrid: { title: "生音と電子音が交代する世界", description: "弦・バンド・鍵盤・シンセを均等に足すのではなく、各セクションで主役の音色を交代します。", mixFocus: "同じ音域では生音か電子音のどちらかを前へ出し、もう一方は背景へ下げる。" },
  }
  return {
    title: copy[family].title,
    description: `${copy[family].description}${directionPhrase[direction]}`,
    coreSounds: coreSoundsFor(family, direction),
    mixFocus: copy[family].mixFocus,
  }
}

function planLogicSoundWorld(project: ComposerProject): LogicSoundWorld {
  const directionId = selectedDirection(project)
  const scores = { ...DIRECTION_FAMILY_SCORES[directionId] }
  scoreArrangementTracks(project, scores)
  scoreSongShape(project, scores)
  const brief = briefForSoundWorld(project)
  const intent = scoreBrief(scores, brief)
  const ranked = (Object.entries(scores) as Array<[LogicSoundWorldFamily, number]>)
    .filter(([family]) => !intent.excluded.includes(family))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  const dominantFamily = intent.lead ?? ranked[0]?.[0] ?? "hybrid"
  const supportingFamilies = ranked.filter(([family]) => family !== dominantFamily).slice(0, 2).map(([family]) => family)
  const copy = soundWorldCopy(dominantFamily, directionId)
  const explicit = intent.requested.includes(dominantFamily)
  return {
    directionId,
    dominantFamily,
    supportingFamilies,
    ...copy,
    reason: explicit
      ? `指示内容と実際のパート構成から、${SOUND_FAMILY_LABELS[dominantFamily]}を主役にしました。`
      : `テンポ、曲の起伏、実際に生成されたパートの比率から、${SOUND_FAMILY_LABELS[dominantFamily]}を主役にしました。`,
  }
}

export function logicSoundPalette(project: ComposerProject): LogicSoundPalette {
  return planLogicSoundWorld(project)
}

function stringRole(id: ArrangementTrackId): string {
  if (id === "str-cello") return "チェロ"
  if (id === "str-viola") return "ビオラ"
  if (id === "str-contrabass") return "コントラバス"
  if (id === "str-spiccato") return "短い弦"
  return "高い弦"
}

/**
 * 弦をSession Strings Pro 2へ一律に寄せず、選ばれた全曲方針の質感を保ったまま
 * Kontakt内の所有ライブラリへ分担する。ここは推奨音源だけを変え、MIDIノートは変更しない。
 */
function kontaktStringSound(id: ArrangementTrackId, world: LogicSoundWorld): SoundDetails | null {
  if (!id.startsWith("str-")) return null
  const role = stringRole(id)
  const direction = world.directionId

  if (id === "str-spiccato" || direction === "rhythmic-propulsion") {
    return {
      role,
      product: "Kontakt 8",
      preset: "Session Strings Pro 2",
      setting: direction === "rhythmic-propulsion"
        ? "Dry Stringsを選び、短い刻みを中心にする。ドラムと同時に強く鳴らしすぎない"
        : "短くそろえ、拍の頭だけ少し強くする。長音パートとは役割を分ける",
    }
  }

  if (world.dominantFamily === "strings") {
    const preset = id === "str-cello"
      ? "Session Strings Pro 2 / Celli - Modern / Celli Mod - Chamber"
      : id === "str-contrabass" ? "Symphony Essentials String Ensemble"
        : id === "str-viola" ? "Emotive Strings"
          : direction === "controlled-escalation" && ["str-violin-1", "str-high-octave", "str-upper"].includes(id)
            ? "LUX Orchestral Strings Elements"
            : "Emotive Strings"
    return {
      role,
      product: "Kontakt 8",
      preset,
      setting: direction === "controlled-escalation"
        ? "前半は少人数のように薄く、後半ほど音域と強さを開く。弦主体でも全パートを同時に大きくしない"
        : "主旋律の休みにだけ薄く入り、別の弦パートと同じ強さ・同じ距離で重ねない",
    }
  }

  if (direction === "preserve-space" || direction === "motif-relay") {
    return {
      role,
      product: "Kontakt 8",
      preset: id === "str-cello" ? "Session Strings Pro 2 / Celli - Modern / Celli Mod - Chamber" : "Emotive Strings",
      setting: direction === "preserve-space"
        ? "音を長く残しすぎず、主旋律の休みにだけ薄く入れる。余白を生かす方針を保つ"
        : "主旋律の切れ目へ短く応答し、同じ旋律をなぞらない。モチーフ受け渡しの方針を保つ",
    }
  }

  if (direction === "controlled-escalation") {
    return {
      role,
      product: "Kontakt 8",
      preset: "LUX Orchestral Strings Elements",
      setting: "前半は薄く、後半ほど音域と強さを開く。壮大に盛り上げる方針を保つ",
    }
  }

  if (id === "str-cello") {
    return {
      role,
      product: "Kontakt 8",
      preset: "Session Strings Pro 2 / Celli - Modern / Celli Mod - Chamber",
      setting: "長くなめらかに鳴らす／定位 やや左／残響 ホール。輪郭を明瞭にしたい場合はCelli Mod - Dry Stringsへ変更",
    }
  }

  return {
    role,
    product: "Kontakt 8",
    preset: "LUX Orchestral Strings Elements",
    setting: "主旋律を覆わない音量にし、必要な所だけ支える。バランス重視の方針を保つ",
  }
}

function drumRole(id: ArrangementTrackId): string {
  if (id.includes("kick")) return "キック"
  if (id.includes("snare") || id === "dr-clap") return "スネア"
  if (["dr-closed-hat", "dr-open-hat", "dr-ride", "dr-crash", "dr-cymbal-swell"].includes(id)) return "シンバル"
  if (["dr-gran-cassa", "dr-impact"].includes(id)) return "大きな打撃"
  return "パーカッション"
}

function directionBasedDrumSound(id: ArrangementTrackId, world: LogicSoundWorld): SoundDetails | null {
  if (!id.startsWith("dr-")) return null
  const direction = world.directionId
  const role = drumRole(id)
  const largeHit = id === "dr-gran-cassa" || id === "dr-impact" || id === "dr-cymbal-swell"
  const percussion = ["dr-field-drum", "dr-low-tom", "dr-high-tom", "dr-shaker", "dr-percussion-high"].includes(id)

  if (world.dominantFamily === "synth" || direction === "rhythmic-propulsion") {
    const sound = largeHit
      ? { product: "Kontakt 8", preset: "Damage" }
      : percussion
        ? { product: "Kontakt 8", preset: "Session Percussionist" }
        : id.includes("snare") || id === "dr-clap"
          ? { product: "Kontakt 8", preset: "Butch Vig Drums" }
          : ["dr-closed-hat", "dr-open-hat", "dr-ride", "dr-crash"].includes(id)
            ? { product: "Kontakt 8", preset: "Studio Drummer" }
            : { product: "Battery 4", preset: "Battery 4 Factory Library / Kits / Elektro 500 Kit" }
    return {
      role,
      ...sound,
      setting: "短く乾いた音を中心にし、キック・スネア・ハイハットの前後関係を明確にする。電子音の輪郭と競わせない",
    }
  }
  if (world.dominantFamily === "band") {
    return {
      role,
      product: "Kontakt 8",
      preset: percussion ? "Session Percussionist" : largeHit ? "Butch Vig Drums" : "Studio Drummer",
      setting: "生ドラムの距離感をそろえ、打撃だけ別空間にしない。フィルは主旋律の切れ目に限定する",
    }
  }
  if (world.dominantFamily === "percussion") {
    const sound = largeHit
      ? { product: "Kontakt 8", preset: "Damage" }
      : percussion ? { product: "Kontakt 8", preset: "Session Percussionist" }
        : id.includes("snare") || id === "dr-clap" ? { product: "Kontakt 8", preset: "Butch Vig Drums" }
          : ["dr-closed-hat", "dr-open-hat", "dr-ride", "dr-crash"].includes(id) ? { product: "Kontakt 8", preset: "Studio Drummer" }
            : { product: "Battery 4", preset: "Battery 4 Factory Library / Kits / Elektro 500 Kit" }
    return {
      role,
      ...sound,
      setting: "役割ごとに音量差を付け、すべての打音を同じ距離・同じ強さで鳴らさない",
    }
  }
  if (direction === "motif-relay") {
    return {
      role,
      product: "Kontakt 8",
      preset: largeHit ? "Damage" : percussion ? "Session Percussionist" : "Butch Vig Drums",
      setting: "毎拍を埋めず、フレーズの切れ目にだけ特徴的な打音を置く。暗い質感の世界を保つ",
    }
  }
  if (direction === "controlled-escalation") {
    return {
      role,
      product: "Kontakt 8",
      preset: largeHit ? "Damage" : percussion ? "Symphony Essentials Percussion" : "Studio Drummer",
      setting: "前半は小さく、後半の境目だけ打撃とシンバルを開く。段階的に広がる世界を保つ",
    }
  }
  if (direction === "preserve-space") {
    return {
      role,
      product: "Kontakt 8",
      preset: percussion ? "Session Percussionist" : "Studio Drummer",
      setting: "余韻の短い自然な音を選び、休符を埋めない。近い生音と遠い余韻の世界を保つ",
    }
  }
  if (id.includes("kick")) {
    return { role, product: "Battery 4", preset: "Battery 4 Factory Library / Kits / Elektro 500 Kit", setting: "輪郭のあるキックを中央へ置き、低い成分とクリック成分の音量を分ける" }
  }
  return {
    role,
    product: "Kontakt 8",
    preset: largeHit ? "Damage" : percussion ? "Session Percussionist" : "Studio Drummer",
    setting: "主旋律を覆わない自然な強弱にし、節目以外では音数を増やさない",
  }
}

function directionBasedBassSound(id: ArrangementTrackId, world: LogicSoundWorld): SoundDetails | null {
  if (!["syn-bass", "syn-sub-bass", "syn-bass-mid"].includes(id)) return null
  const direction = world.directionId
  const role = id === "syn-sub-bass" ? "サブベース" : id === "syn-bass-mid" ? "中域ベース" : "ベース"
  if (id === "syn-sub-bass") {
    return { role, product: "Repro-1", preset: "1981 Historic / 14 Bass Synth Sustain", setting: "最低音だけを薄く支え、キックの余韻と重なる場所は短くする" }
  }
  if (world.dominantFamily === "synth") {
    return { role, product: "Repro-1", preset: "01 Basses / EH Heavy Pulse Bass", setting: "アタックを短くし、サブベースと同じ音域を長く重ねない" }
  }
  if (world.dominantFamily === "band") {
    return { role, product: "Kontakt 8", preset: id === "syn-bass-mid" ? "Session Bassist - Prime Bass" : "Session Bassist - Icon Bass", setting: "Melody Instrumentを使い、キックの直前を短くして奏者同士の隙間を作る" }
  }
  if (world.dominantFamily === "strings" || world.dominantFamily === "piano" || direction === "preserve-space") {
    return { role, product: "Kontakt 8", preset: "Session Bassist - Upright Bass", setting: "Melody Instrumentを使い、音数を減らして自然な減衰を残す。余白重視の世界を保つ" }
  }
  if (direction === "rhythmic-propulsion") {
    return { role, product: "Kontakt 8", preset: id === "syn-bass-mid" ? "Session Bassist - Prime Bass" : "Session Bassist - Icon Bass", setting: "Melody Instrumentを使い、ゲートを短めにしてキックと交互に前へ進める" }
  }
  if (direction === "controlled-escalation") {
    return { role, product: "Kontakt 8", preset: "Session Bassist - Prime Bass", setting: "Melody Instrumentを使い、前半は低く小さく、後半だけオクターブ感を足す" }
  }
  if (direction === "motif-relay") {
    return { role, product: "Repro-1", preset: "01 Basses / EH Heavy Pulse Bass", setting: "短い反復を常時鳴らさず、モチーフが受け渡される所だけ輪郭を出す" }
  }
  return { role, product: "Kontakt 8", preset: "Session Bassist - Prime Bass", setting: "Melody Instrumentを使い、キックと重なる音を短くする。主旋律より前へ出さない" }
}

function directionBasedSound(id: ArrangementTrackId, world: LogicSoundWorld): SoundDetails | null {
  const direction = world.directionId
  const strings = kontaktStringSound(id, world)
  if (strings) return strings
  const drums = directionBasedDrumSound(id, world)
  if (drums) return drums
  const bass = directionBasedBassSound(id, world)
  if (bass) return bass

  if (id === "syn-stabs") {
    if (direction === "rhythmic-propulsion" && !["strings", "piano"].includes(world.dominantFamily)) {
      return { role: "短い和音", product: "Kontakt 8", preset: "Session Guitarist - Electric Mint", setting: "Melody Instrumentを選び、短い刻みでドラムと噛み合わせる。リズム重視の方針を保つ" }
    }
    if (world.dominantFamily === "strings") {
      return { role: "短い和音", product: "Kontakt 8", preset: direction === "controlled-escalation" ? "LUX Orchestral Strings Elements" : "Session Strings Pro 2", setting: "短い弦の和音として使い、長音の弦とは同時に強く鳴らさない" }
    }
    if (world.dominantFamily === "piano") {
      return { role: "短い和音", product: "Kontakt 8", preset: "Piano Colors", setting: "短い鍵盤の色として使い、主旋律の直前では一段小さくする" }
    }
    if (world.dominantFamily === "synth") {
      return { role: "短い和音", product: "Repro-5", preset: "03 Keys - Synths / JH Midrange Synthstab (MW)", setting: "短いアナログ和音として使い、パッドと同時に中域を埋めない" }
    }
    if (direction === "preserve-space") {
      return { role: "短い和音", product: "Kontakt 8", preset: "Session Guitarist - Picked Nylon", setting: "Melody Instrumentを選び、音を短くしすぎず余韻を残す。余白重視の方針を保つ" }
    }
    if (direction === "controlled-escalation") {
      return { role: "短い和音", product: "Kontakt 8", preset: "Session Guitarist - Electric Sunburst Deluxe", setting: "Melody Instrumentを選び、後半ほど音量と開放弦の響きを増やす。盛り上げる方針を保つ" }
    }
    if (direction === "motif-relay") {
      return { role: "短い和音", product: "Kontakt 8", preset: "Session Guitarist - Electric Vintage", setting: "Melody Instrumentを選び、主旋律の切れ目にだけ短く応答する。モチーフ受け渡しの方針を保つ" }
    }
    return { role: "短い和音", product: "Kontakt 8", preset: "Session Guitarist - Electric Mint", setting: "Melody Instrumentを選び、主旋律の後ろで短く支える。バンドと室内楽の中間の世界を保つ" }
  }

  if (world.dominantFamily === "strings" && ["syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide"].includes(id)) {
    return {
      role: id === "syn-chord-wide" ? "広い和音" : "背景の和音",
      product: "Kontakt 8",
      preset: direction === "controlled-escalation" ? "LUX Orchestral Strings Elements" : "Emotive Strings",
      setting: "弦の背景として薄く使い、独立した旋律の弦より音量を下げる。低音は重ねない",
    }
  }
  if (world.dominantFamily === "piano" && ["syn-dark-pad", "syn-chord-wide"].includes(id)) {
    return { role: "背景の和音", product: "Kontakt 8", preset: id === "syn-chord-wide" ? "Piano Colors" : "Noire", setting: "鍵盤の余韻だけを背景に残し、主旋律と同じ高さのアタックを弱くする" }
  }
  if (world.dominantFamily === "synth" && ["syn-dark-pad", "syn-pad-air", "syn-pad-motion", "syn-chord-wide"].includes(id)) {
    const preset = id === "syn-dark-pad" ? "Schema Dark" : id === "syn-pad-air" ? "Schema Light" : id === "syn-pad-motion" ? "Analog Dreams" : "Straylight"
    return { role: id === "syn-chord-wide" ? "広い和音" : "背景の和音", product: "Kontakt 8", preset, setting: "電子的な質感として奥へ置き、Reproの反復音と同時に動かしすぎない" }
  }

  if (id === "syn-dark-pad" && direction === "motif-relay") {
    return { role: "暗い背景の和音", product: "Kontakt 8", preset: "Schema Dark", setting: "低い持続音を薄く使い、フレーズ間の陰影だけを作る。主旋律より手前へ出さない" }
  }
  if (id === "syn-pad-air" && direction === "preserve-space") {
    return { role: "薄い高域パッド", product: "Kontakt 8", preset: "Ethereal Earth", setting: "高域の尾だけを小さく残し、主旋律が高い所では休ませる。余白重視の方針を保つ" }
  }
  if (id === "syn-pad-motion" && direction === "controlled-escalation") {
    return { role: "動くパッド", product: "Kontakt 8", preset: "Straylight", setting: "前半は動きを抑え、後半だけ広がりを足す。盛り上げる方針を保つ" }
  }
  if (id === "syn-high-glass" && direction === "motif-relay") {
    return { role: "高音のきらめき", product: "Kontakt 8", preset: "Playbox", setting: "一音または短いモチーフだけを使い、既存フレーズへ応答させる" }
  }
  if (id === "syn-chord-wide" && direction === "preserve-space") {
    return { role: "広い和音", product: "Kontakt 8", preset: "Piano Colors", setting: "アタックを弱くし、コードの変わり目だけを薄く支える。音を埋めすぎない" }
  }
  if (id === "syn-chord-wide" && direction === "controlled-escalation") {
    return { role: "広い和音", product: "Kontakt 8", preset: "Piano Colors", setting: "前半は単音に近い薄さにし、後半だけ広い和音へ開く" }
  }
  if (id === "syn-pad-motion" && direction === "rhythmic-propulsion") {
    return { role: "動くパッド", product: "Kontakt 8", preset: "Analog Dreams", setting: "動きを小さく保ち、キックとベースの隙間だけで周期を感じさせる" }
  }
  if (id === "syn-pad-air" && direction === "motif-relay") {
    return { role: "薄い高域パッド", product: "Kontakt 8", preset: "Schema Light", setting: "高い断片を小さく置き、Schema Darkと同時に強く鳴らさない" }
  }
  return null
}

function counterSound(world: LogicSoundWorld): Pick<LogicSoundRow, "product" | "preset"> {
  const direction = world.directionId
  if (world.dominantFamily === "piano") return { product: "Kontakt 8", preset: "Piano Colors" }
  if (world.dominantFamily === "synth") return { product: "Repro-5", preset: "05 Keys - Plucks & Mallets / SD Mellow Vibes" }
  if (world.dominantFamily === "band") return { product: "Kontakt 8", preset: "Session Guitarist - Electric Vintage" }
  if (direction === "preserve-space" || direction === "motif-relay") {
    return { product: "Kontakt 8", preset: "Emotive Strings" }
  }
  if (direction === "controlled-escalation") {
    return { product: "Kontakt 8", preset: "LUX Orchestral Strings Elements" }
  }
  if (direction === "rhythmic-propulsion") {
    return { product: "Kontakt 8", preset: "Session Strings Pro 2" }
  }
  return { product: "Kontakt 8", preset: "Session Strings Pro 2 / Celli - Modern / Celli Mod - Dry Strings" }
}

const SOURCE_SOUNDS: Partial<Record<LogicProductionTrackId, Pick<LogicSoundRow, "product" | "preset">>> = {
  "chord-guide": { product: "Repro-5", preset: "09 Pads - Orchestral / EH Dark Emotion Pad" },
  "active-melody": { product: "Kontakt 8", preset: "Noire / Pure" },
  "melody-accompaniment": { product: "Repro-1", preset: "07 Seq - Melodic / HS Zing Pluck" },
  pulse: { product: "Repro-1", preset: "07 Seq - Melodic / HS Metronomi" },
  decoration: { product: "Kontakt 8", preset: "Playbox / Factory Presets" },
  "selected-phrase": { product: "Repro-5", preset: "05 Keys - Plucks & Mallets / SD Mellow Vibes" },
  "selected-intro-phrase": { product: "Kontakt 8", preset: "Playbox / Factory Presets" },
}

function sourceSound(id: LogicProductionTrackId, world: LogicSoundWorld): Pick<LogicSoundRow, "product" | "preset"> {
  const direction = world.directionId
  if (id === "counter") return counterSound(world)
  if (id === "melody-accompaniment") {
    if (world.dominantFamily === "strings") return { product: "Kontakt 8", preset: direction === "controlled-escalation" ? "LUX Orchestral Strings Elements" : "Emotive Strings" }
    if (world.dominantFamily === "piano") return { product: "Kontakt 8", preset: "Piano Colors" }
    if (world.dominantFamily === "synth") return { product: "Repro-1", preset: "07 Seq - Melodic / HS Zing Pluck" }
    if (direction === "preserve-space") return { product: "Kontakt 8", preset: "Session Guitarist - Picked Nylon" }
    if (direction === "rhythmic-propulsion") return { product: "Kontakt 8", preset: "Session Guitarist - Electric Mint" }
    if (direction === "motif-relay") return { product: "Kontakt 8", preset: "Session Guitarist - Electric Vintage" }
    if (direction === "controlled-escalation") return { product: "Kontakt 8", preset: "Session Guitarist - Electric Sunburst Deluxe" }
  }
  if (id === "decoration" && direction === "preserve-space") {
    return { product: "Kontakt 8", preset: "Straylight" }
  }
  if (id === "selected-intro-phrase" && direction === "motif-relay") {
    return { product: "Kontakt 8", preset: "Schema Dark" }
  }
  return SOURCE_SOUNDS[id] ?? { product: "Kontakt 8", preset: "Noire" }
}

/**
 * Kontaktの製品名だけで終わらず、この端末のKomplete Kontrol DBで確認できた
 * 最後のSnapshot / Instrument名まで表示する。ユーザーは末尾の名前を検索すればよい。
 */
function finalPresetName(
  preset: string,
  id: LogicProductionTrackId | ArrangementTrackId,
  world: LogicSoundWorld,
): string {
  if (preset === "Session Strings Pro 2") {
    if (id === "str-cello") return "Session Strings Pro 2 / Celli - Modern / Celli Mod - Chamber"
    if (id === "str-contrabass") return "Session Strings Pro 2 / Basses - Modern / Basses Mod - Small & Dry"
    if (id === "str-viola") return "Session Strings Pro 2 / Violas - Modern / Violas Mod - Dry Strings"
    if (id === "str-spiccato") return "Session Strings Pro 2 / Violins - Modern / Violins Mod - Dry Strings"
    if (id === "syn-stabs") return "Session Strings Pro 2 / Ensemble - Modern / Ens Mod - Small & Dry"
    return "Session Strings Pro 2 / Violins - Modern / Violins Mod - Chamber"
  }
  if (preset === "Emotive Strings") {
    if (["str-cello", "str-contrabass"].includes(id)) return "Emotive Strings / Low Melodic / Dark Prophecy Low"
    if (id === "str-spiccato") return "Emotive Strings / High Basic / Basic Ostinatos 2"
    return "Emotive Strings / High Melodic / Afterlife"
  }
  if (preset === "LUX Orchestral Strings Elements") {
    if (id === "str-violin-2") return "LUX Orchestral Strings Elements / 02 LUX Violins 2 Elements"
    if (id === "str-viola") return "LUX Orchestral Strings Elements / 03 LUX Violas Elements"
    if (id === "str-cello") return "LUX Orchestral Strings Elements / 04 LUX Celli Elements"
    if (id === "str-contrabass") return "LUX Orchestral Strings Elements / 05 LUX Basses Elements"
    return "LUX Orchestral Strings Elements / 01 LUX Violins 1 Elements"
  }
  if (preset === "Symphony Essentials String Ensemble") {
    if (id === "str-contrabass") return "Symphony Essentials String Ensemble / Basses Essential"
    if (id === "str-cello") return "Symphony Essentials String Ensemble / Cellos Essential"
    if (id === "str-viola") return "Symphony Essentials String Ensemble / Violas Essential"
    if (id === "str-violin-2") return "Symphony Essentials String Ensemble / Violins 2 Essential"
    return "Symphony Essentials String Ensemble / Violins 1 Essential"
  }
  if (preset === "Studio Drummer" || preset === "Studio Drummer / Factory Kit") {
    if (world.directionId === "controlled-escalation") return "Studio Drummer / Stadium Kit - Full / Stadium Ballad"
    if (world.directionId === "preserve-space") return "Studio Drummer / Session Kit - Full / Session Ballad"
    return "Studio Drummer / Session Kit - Full / Session Indie Rock"
  }
  if (preset === "Butch Vig Drums" || preset === "Butch Vig Drums / Factory Kit") {
    return world.directionId === "preserve-space"
      ? "Butch Vig Drums / Dead Room (87 bpm)"
      : "Butch Vig Drums / The Nasty Room (140 bpm)"
  }
  if (preset === "Session Percussionist" || preset === "Session Percussionist / Factory Preset") {
    if (id === "dr-shaker") return "Session Percussionist / 3 Players / Double Shaker I"
    if (id === "dr-percussion-high") return "Session Percussionist / 1 Player / Bright Chimes"
    if (["dr-low-tom", "dr-high-tom", "dr-field-drum"].includes(id)) return "Session Percussionist / 3 Players / Organic Clock"
    return "Session Percussionist / 3 Players / Small Combo"
  }
  if (preset === "Damage" || preset === "Damage / Factory Kit") {
    if (id === "dr-gran-cassa") return "Damage / Main Percussion / PERC Studio Concert Bass Drum"
    if (id === "dr-cymbal-swell") return "Damage / Main Percussion / PERC Cymbal Performance FX"
    return "Damage / One Shot / Kits / PERC Damage Hit Impacts"
  }
  if (preset === "Symphony Essentials Percussion") {
    if (id === "dr-field-drum") return "Symphony Essentials Percussion / Drums / Field Drum"
    if (id === "dr-low-tom") return "Symphony Essentials Percussion / Drums / Tom 1"
    if (id === "dr-high-tom") return "Symphony Essentials Percussion / Drums / Tom 3"
    if (id === "dr-shaker") return "Symphony Essentials Percussion / Wood / Shakers"
    if (id === "dr-cymbal-swell") return "Symphony Essentials Percussion / Cymbals / Cymbal 2"
    return "Symphony Essentials Percussion / Orchestral Percussion Kit"
  }
  if (preset === "Session Bassist - Prime Bass" || preset === "Session Bassist - Prime Bass / Prime Bass") return "Session Bassist - Prime Bass / Melody / 8th Bass (Melody)"
  if (preset === "Session Bassist - Icon Bass") return "Session Bassist - Icon Bass / Melody / In the Pocket (Melody)"
  if (preset === "Session Bassist - Upright Bass") return "Session Bassist - Upright Bass / Melody / Keep It Simple (Melody)"
  if (preset === "Session Guitarist - Picked Nylon") return "Session Guitarist - Picked Nylon / Melody / Calm Sea (Melody)"
  if (preset === "Session Guitarist - Electric Mint") return "Session Guitarist - Electric Mint / Melody / Clean and Wide (Melody)"
  if (preset === "Session Guitarist - Electric Vintage") return "Session Guitarist - Electric Vintage / Melody / Cold Lake (Melody)"
  if (preset === "Session Guitarist - Electric Sunburst Deluxe") return "Session Guitarist - Electric Sunburst Deluxe / Melody / In the Clouds (Melody)"
  if (preset === "Piano Colors") {
    return id === "syn-stabs"
      ? "Piano Colors / Combined / Dark Mallet"
      : "Piano Colors / Combined / Relaxed Chords"
  }
  if (preset === "Noire" || preset === "Noire / Pure") {
    return id === "syn-dark-pad" ? "Noire / Felt - Grand Piano / Gentle Dark" : "Noire / Basic Pure"
  }
  if (preset === "Playbox" || preset === "Playbox / Factory Presets") {
    return id === "selected-intro-phrase"
      ? "Playbox / Instruments / A Movie Plot"
      : "Playbox / Instruments / Dream Sequence"
  }
  if (preset === "Schema Dark") return "Schema Dark / Tonal / Orchestral / Dirty Sustain Strings"
  if (preset === "Schema Light") return "Schema Light / Chord / Ghost Chords"
  if (preset === "Straylight") return "Straylight / Atmospheres / Cold Morning"
  if (preset === "Analog Dreams") return "Analog Dreams / Analog Dreams 2.0 / Sensual Background"
  if (preset === "Ethereal Earth") return "Ethereal Earth / Ethereal Earth 1.0 / Angelic Whispers"
  return preset
}

const SOURCE_VOLUME_DB: Record<LogicProductionTrackId, number> = {
  "bass-guide": -14,
  "chord-guide": -18,
  "active-melody": -7,
  "melody-accompaniment": -15,
  pulse: -17,
  counter: -13,
  decoration: -18,
  "selected-phrase": -15,
  "selected-intro-phrase": -16,
}

function familyForTrack(id: ArrangementTrackId): LogicSoundWorldFamily {
  if (id.startsWith("str-")) return "strings"
  if (id.startsWith("dr-")) return "percussion"
  if (["syn-bass", "syn-bass-mid"].includes(id)) return "band"
  return "synth"
}

function arrangementVolumeDb(id: ArrangementTrackId, world: LogicSoundWorld): number {
  let base: number
  if (id === "dr-kick") base = -8
  else if (id === "dr-kick-sub") base = -14
  else if (id === "dr-kick-click") base = -17
  else if (id === "dr-snare") base = -10
  else if (id === "dr-snare-body") base = -14
  else if (id === "dr-clap") base = -16
  else if (["dr-closed-hat", "dr-shaker", "dr-percussion-high"].includes(id)) base = -19
  else if (["dr-open-hat", "dr-ride", "dr-cymbal-swell"].includes(id)) base = -17
  else if (["dr-low-tom", "dr-high-tom", "dr-field-drum", "dr-crash"].includes(id)) base = -15
  else if (id === "dr-gran-cassa" || id === "dr-impact") base = -13
  else if (id === "syn-bass") base = -10
  else if (id === "syn-sub-bass") base = -15
  else if (id === "syn-bass-mid") base = -14
  else if (id === "syn-pulse") base = -17
  else if (id === "syn-arp-low" || id === "syn-arp-high") base = -20
  else if (id === "syn-stabs") base = -15
  else if (id === "syn-chord-wide") base = -19
  else if (["syn-dark-pad", "syn-pad-air", "syn-pad-motion"].includes(id)) base = -21
  else if (["syn-high-glass", "syn-transition-phrase"].includes(id)) base = -18
  else if (id === "syn-final-lift") base = -17
  else if (id === "str-cello") base = -15
  else if (id === "str-contrabass") base = -17
  else if (id === "str-spiccato") base = -18
  else base = -18
  const family = familyForTrack(id)
  const adjustment = family === world.dominantFamily ? 1 : world.supportingFamilies.includes(family) ? 0 : -1
  return Math.max(-24, Math.min(0, base + adjustment))
}

function sourceSetting(source: TrackSource): string {
  return [
    source.performance.split("。")[0],
    `定位 ${source.panorama}`,
    `残響 ${source.reverb.split("。")[0]}`,
  ].filter(Boolean).join("／")
}

/**
 * 曲全体MIDIに入るトラックごとの、おすすめ音源と一言の設定。
 * トラックの並びと名前は曲全体MIDIと同じにする(Logicで開いたときに対応が分かるように)。
 */
export function logicSoundRows(project: ComposerProject): LogicSoundRow[] {
  const byId = new Map(sources(project).map((source) => [source.id, source]))
  const world = planLogicSoundWorld(project)
  const order: LogicProductionTrackId[] = [
    "chord-guide",
    "active-melody",
    "melody-accompaniment",
    "pulse",
    "counter",
    "decoration",
    "selected-phrase",
    "selected-intro-phrase",
  ]
  const rows: LogicSoundRow[] = order.flatMap((id) => {
    const source = byId.get(id)
    if (!source || source.notes.length === 0) return []
    const sound = sourceSound(id, world)
    return [{
      trackName: SONG_MIDI_TRACK_NAMES[id] ?? source.name,
      role: SONG_TRACK_ROLES[id] ?? source.role,
      ...sound,
      preset: finalPresetName(sound.preset, id, world),
      volumeDb: SOURCE_VOLUME_DB[id],
      setting: sourceSetting(source),
    }]
  })
  for (const track of project.fullSongArrangement?.tracks ?? []) {
    if (track.muted || track.notes.length === 0) continue
    const sound = directionBasedSound(track.id, world)
      ?? ARRANGEMENT_SOUNDS.find((candidate) => candidate.match(track.id))
    if (!sound) continue
    const label = arrangementTrackLabel(track.id)
    rows.push({ trackName: track.name, role: label === sound.role ? label : `${sound.role}・${label}`, product: sound.product, preset: finalPresetName(sound.preset, track.id, world), volumeDb: arrangementVolumeDb(track.id, world), setting: sound.setting })
  }
  return rows
}
