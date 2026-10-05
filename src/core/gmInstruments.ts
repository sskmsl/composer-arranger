import type { ArrangementTrackId } from "./arrangementGeneration"

/**
 * GM(General MIDI)の楽器。試聴(GM音源)と、MIDI書き出し(GM向け)の楽器番号に共通で使う。
 * 名前は GM の128音色の並び(プログラム番号 0〜127)で、試聴用のサンプル(MIDI.js Soundfonts の FluidR3_GM)のファイル名と同じ。
 */
export const GM_PROGRAM_FILES = [
  "acoustic_grand_piano", "bright_acoustic_piano", "electric_grand_piano", "honkytonk_piano", "electric_piano_1", "electric_piano_2", "harpsichord", "clavinet",
  "celesta", "glockenspiel", "music_box", "vibraphone", "marimba", "xylophone", "tubular_bells", "dulcimer",
  "drawbar_organ", "percussive_organ", "rock_organ", "church_organ", "reed_organ", "accordion", "harmonica", "tango_accordion",
  "acoustic_guitar_nylon", "acoustic_guitar_steel", "electric_guitar_jazz", "electric_guitar_clean", "electric_guitar_muted", "overdriven_guitar", "distortion_guitar", "guitar_harmonics",
  "acoustic_bass", "electric_bass_finger", "electric_bass_pick", "fretless_bass", "slap_bass_1", "slap_bass_2", "synth_bass_1", "synth_bass_2",
  "violin", "viola", "cello", "contrabass", "tremolo_strings", "pizzicato_strings", "orchestral_harp", "timpani",
  "string_ensemble_1", "string_ensemble_2", "synth_strings_1", "synth_strings_2", "choir_aahs", "voice_oohs", "synth_choir", "orchestra_hit",
  "trumpet", "trombone", "tuba", "muted_trumpet", "french_horn", "brass_section", "synth_brass_1", "synth_brass_2",
  "soprano_sax", "alto_sax", "tenor_sax", "baritone_sax", "oboe", "english_horn", "bassoon", "clarinet",
  "piccolo", "flute", "recorder", "pan_flute", "blown_bottle", "shakuhachi", "whistle", "ocarina",
  "lead_1_square", "lead_2_sawtooth", "lead_3_calliope", "lead_4_chiff", "lead_5_charang", "lead_6_voice", "lead_7_fifths", "lead_8_bass__lead",
  "pad_1_new_age", "pad_2_warm", "pad_3_polysynth", "pad_4_choir", "pad_5_bowed", "pad_6_metallic", "pad_7_halo", "pad_8_sweep",
  "fx_1_rain", "fx_2_soundtrack", "fx_3_crystal", "fx_4_atmosphere", "fx_5_brightness", "fx_6_goblins", "fx_7_echoes", "fx_8_scifi",
  "sitar", "banjo", "shamisen", "koto", "kalimba", "bagpipe", "fiddle", "shanai",
  "tinkle_bell", "agogo", "steel_drums", "woodblock", "taiko_drum", "melodic_tom", "synth_drum", "reverse_cymbal",
  "guitar_fret_noise", "breath_noise", "seashore", "bird_tweet", "telephone_ring", "helicopter", "applause", "gunshot",
] as const

/**
 * General MIDI Level 1で定義された128音色の正式な英語名。
 * 画面では検索語を「プリセット名」と誤表示せず、必ずこの標準名を表示する。
 */
export const GM_PROGRAM_NAMES = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)", "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Choir", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag Pipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot",
] as const

/** どのGM対応音源でも照合できる、Program番号付きの標準音色名。 */
export function gmProgramPresetLabel(program: number): string {
  const normalized = Math.max(0, Math.min(127, Math.round(program)))
  return `GM ${String(normalized + 1).padStart(3, "0")} ${GM_PROGRAM_NAMES[normalized]}`
}

/** 画面で選べる楽器(よく使うものに絞る)。番号は GM のプログラム番号(0始まり) */
export const GM_INSTRUMENT_CHOICES: ReadonlyArray<{ program: number; label: string }> = [
  { program: 0, label: "ピアノ" },
  { program: 1, label: "明るいピアノ" },
  { program: 4, label: "エレピ(ローズ)" },
  { program: 5, label: "エレピ(FM)" },
  { program: 6, label: "チェンバロ" },
  { program: 8, label: "チェレスタ" },
  { program: 10, label: "オルゴール" },
  { program: 11, label: "ビブラフォン" },
  { program: 12, label: "マリンバ" },
  { program: 19, label: "パイプオルガン" },
  { program: 24, label: "ナイロンギター" },
  { program: 25, label: "スチールギター" },
  { program: 27, label: "クリーンギター" },
  { program: 32, label: "ウッドベース" },
  { program: 33, label: "エレキベース" },
  { program: 38, label: "シンセベース" },
  { program: 40, label: "バイオリン" },
  { program: 41, label: "ビオラ" },
  { program: 42, label: "チェロ" },
  { program: 45, label: "弦のピチカート" },
  { program: 46, label: "ハープ" },
  { program: 48, label: "弦楽合奏" },
  { program: 49, label: "弦楽合奏(やわらかい)" },
  { program: 50, label: "シンセストリングス" },
  { program: 52, label: "コーラス(アー)" },
  { program: 53, label: "コーラス(ウー)" },
  { program: 56, label: "トランペット" },
  { program: 60, label: "ホルン" },
  { program: 65, label: "アルトサックス" },
  { program: 68, label: "オーボエ" },
  { program: 71, label: "クラリネット" },
  { program: 73, label: "フルート" },
  { program: 75, label: "パンフルート" },
  { program: 79, label: "オカリナ" },
  { program: 80, label: "シンセリード(矩形)" },
  { program: 81, label: "シンセリード(のこぎり)" },
  { program: 88, label: "パッド(ニューエイジ)" },
  { program: 89, label: "パッド(あたたかい)" },
  { program: 91, label: "パッド(クワイア)" },
  { program: 92, label: "パッド(ボウ)" },
  { program: 94, label: "パッド(ヘイロー)" },
  { program: 108, label: "カリンバ" },
]

/** 試聴と書き出しで楽器を分けるパート */
export type SoundPart = "melody" | "chords" | "accompaniment" | "counter" | "decoration" | "phrase" | "signature"

export const SOUND_PARTS: ReadonlyArray<{ id: SoundPart; label: string }> = [
  { id: "melody", label: "主旋律" },
  { id: "chords", label: "コード" },
  { id: "accompaniment", label: "伴奏" },
  { id: "counter", label: "対旋律" },
  { id: "decoration", label: "装飾" },
  { id: "phrase", label: "短いフレーズ" },
  { id: "signature", label: "イントロ" },
]

export const DEFAULT_PART_PROGRAMS: Readonly<Record<SoundPart, number>> = {
  melody: 0,
  chords: 89,
  accompaniment: 4,
  counter: 42,
  decoration: 11,
  phrase: 11,
  signature: 8,
}

/** 試聴の音(simple = これまでの合成音、gm = GM音源のサンプル。既定はgm)と、MIDI書き出しの形式 */
export interface SoundSettings {
  playback: "simple" | "gm"
  /** logic = 全トラックをチャンネル1・楽器指定なし(Logic Proでソフトウェア音源として読む)。gm = パートごとにチャンネルと楽器番号を入れる */
  midiExport: "logic" | "gm"
  programs: Record<SoundPart, number>
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  playback: "gm",
  midiExport: "logic",
  programs: { ...DEFAULT_PART_PROGRAMS },
}

const isProgram = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 127

/** 保存された設定を読み、足りない項目や壊れた値は既定値で補う */
export function normalizeSoundSettings(raw: unknown): SoundSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SoundSettings>
  const savedPrograms = (r.programs && typeof r.programs === "object" ? r.programs : {}) as Partial<Record<SoundPart, unknown>>
  const programs = { ...DEFAULT_PART_PROGRAMS }
  for (const { id } of SOUND_PARTS) {
    const value = savedPrograms[id]
    if (isProgram(value)) programs[id] = value
  }
  return {
    // 選んだことがあればそれを使い、無ければ(初めて開く端末・ブラウザ)GM音源から始める
    playback: r.playback === "simple" || r.playback === "gm" ? r.playback : DEFAULT_SOUND_SETTINGS.playback,
    midiExport: r.midiExport === "gm" ? "gm" : "logic",
    programs,
  }
}

export function gmFileForProgram(program: number): string {
  return GM_PROGRAM_FILES[Math.max(0, Math.min(127, Math.round(program)))]
}

/** 全曲アレンジのトラックの楽器(ドラムは GM のドラムチャンネルで鳴らす) */
export function arrangementTrackProgram(trackId: ArrangementTrackId): number | "drums" {
  if (trackId.startsWith("dr-")) return "drums"
  switch (trackId) {
    case "syn-bass":
    case "syn-sub-bass": return 38
    case "syn-bass-mid": return 39
    case "syn-pulse":
    case "syn-arp-low": return 81
    case "syn-arp-high": return 80
    case "syn-stabs":
    case "syn-chord-wide": return 62
    case "syn-dark-pad": return 89
    case "syn-pad-air": return 94
    case "syn-pad-motion": return 92
    case "syn-high-glass": return 98
    case "syn-transition-phrase": return 88
    case "syn-final-lift": return 50
    case "str-cello": return 42
    case "str-viola": return 41
    case "str-contrabass": return 43
    case "str-spiccato": return 45
    case "str-violin-2": return 40
    case "str-violin-1": return 40
    case "str-upper":
    case "str-high-octave": return 49
    default: return 0
  }
}

/** GM のドラムチャンネル(0始まりで9 = 10ch) */
export const GM_DRUM_CHANNEL = 9

/**
 * GM向け書き出しのチャンネル割り当て。ドラムは10ch、ほかは1chから順に(10chを飛ばす)。
 * 15を超える楽器トラックは、先頭から順にチャンネルを使い回す。
 */
export function assignGmChannels(programs: ReadonlyArray<number | "drums">): Array<{ channel: number; program: number | null }> {
  const melodic = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]
  let next = 0
  return programs.map((program) => {
    if (program === "drums") return { channel: GM_DRUM_CHANNEL, program: null }
    const channel = melodic[next % melodic.length]
    next += 1
    return { channel, program }
  })
}
