/**
 * コードシンボルの解析とハーモニー情報の抽出。
 * ジャズ理論の完全な網羅は目指さず、ポップ/シネマティック領域で頻出する
 * 記法(m, maj7, sus2/4, add9, 6/9, 括弧内の追加・変化音, 分数コード)を対象にする。
 */

const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export type ChordTone = "root" | "third" | "fifth" | "seventh" | "sixth" | "tension"

export interface ChordToneInfo {
  /** ルートからの半音距離(0-23、拡張系は1オクターブ超も許容) */
  interval: number
  pitchClass: number
  role: ChordTone
}

export interface ParsedChord {
  symbol: string
  rootPc: number
  rootName: string
  bassPc: number
  bassName: string
  /** コードトーン(root/3rd/5th/7th/6th)。休符判定や解決先候補の基礎になる */
  tones: ChordToneInfo[]
  /** シンボルに明示された、または通常伴うテンション(9th/11th/13th系) */
  tensions: ChordToneInfo[]
  isMinor: boolean
  isSus: boolean
  isDominant: boolean
  isDiminished: boolean
}

function noteNameToPc(letter: string, accidental: string): number {
  let pc = NATURAL_PC[letter.toUpperCase()]
  if (accidental === "#") pc += 1
  if (accidental === "b") pc -= 1
  return ((pc % 12) + 12) % 12
}

function pcName(pc: number): string {
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return SHARP[((pc % 12) + 12) % 12]
}

const ALTER_TOKEN: Record<string, { interval: number; role: ChordTone }> = {
  "b5": { interval: 6, role: "fifth" },
  "#5": { interval: 8, role: "fifth" },
  "b9": { interval: 13, role: "tension" },
  "9": { interval: 14, role: "tension" },
  "#9": { interval: 15, role: "tension" },
  "11": { interval: 17, role: "tension" },
  "#11": { interval: 18, role: "tension" },
  "b13": { interval: 20, role: "tension" },
  "13": { interval: 21, role: "tension" },
  "6": { interval: 9, role: "sixth" },
  "2": { interval: 2, role: "tension" },
  "4": { interval: 5, role: "tension" },
}

/**
 * "F#m(add9)" "G7" "Dsus2" "Cmaj7" "Am7b5" "C/E" 等をパースする。
 * 不明な記法はnullを返し、呼び出し側でルートのみのトライアド等へフォールバックさせる。
 */
export function parseChordSymbol(symbol: string, explicitBass?: string): ParsedChord | null {
  const trimmed = symbol.trim()
  if (!trimmed) return null

  const slash = /^(.*?)\/([A-Ga-g])([#b]?)$/.exec(trimmed)
  let body = trimmed
  let bassPc: number | null = null
  if (slash) {
    body = slash[1]
    bassPc = noteNameToPc(slash[2], slash[3])
  }

  const rootMatch = /^([A-Ga-g])([#b]?)/.exec(body)
  if (!rootMatch) return null
  const rootPc = noteNameToPc(rootMatch[1], rootMatch[2])
  let rest = body.slice(rootMatch[0].length).trim()

  // 括弧内の追加・変化トークンを取り出す (例: "(add9)" "(b9,#11)")
  const bracketTokens: string[] = []
  rest = rest
    .replace(/\(([^)]*)\)/g, (_m, inner: string) => {
      bracketTokens.push(
        ...inner
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
      return ""
    })
    .trim()

  let isMinor = false
  let isDim = false
  let isAug = false
  let isSus = false
  let hasExplicitMajorSeventh = false
  let hasDominantSeventh = false
  let hasSixth = false
  let stackedExtension: 9 | 11 | 13 | null = null

  if (/^maj7|^M7|^Δ7?/i.test(rest)) {
    hasExplicitMajorSeventh = true
    rest = rest.replace(/^(maj7|M7|Δ7?)/i, "")
  } else if (/^dim7/i.test(rest)) {
    isDim = true
    hasDominantSeventh = false
    rest = rest.replace(/^dim7/i, "")
  } else if (/^m7b5|^m7-5|^ø/i.test(rest)) {
    isMinor = true
    isDim = true
    hasDominantSeventh = true
    rest = rest.replace(/^(m7b5|m7-5|ø)/i, "")
  } else if (/^mmaj7|^mM7/i.test(rest)) {
    isMinor = true
    hasExplicitMajorSeventh = true
    rest = rest.replace(/^(mmaj7|mM7)/i, "")
  } else if (/^dim(?!7)|^°|^o(?!\d)/i.test(rest)) {
    isDim = true
    rest = rest.replace(/^(dim|°|o)/i, "")
  } else if (/^aug|^\+/i.test(rest)) {
    isAug = true
    rest = rest.replace(/^(aug|\+)/i, "")
  } else if (/^(m|min|-)(?!aj)/i.test(rest)) {
    isMinor = true
    rest = rest.replace(/^(m|min|-)/i, "")
  } else if (/^maj(?!\d)/i.test(rest)) {
    rest = rest.replace(/^maj/i, "")
  }

  if (/^sus2/i.test(rest)) {
    isSus = true
    rest = rest.replace(/^sus2/i, "")
  } else if (/^sus4?/i.test(rest)) {
    isSus = true
    rest = rest.replace(/^sus4?/i, "")
  }

  if (/^13/.test(rest)) {
    stackedExtension = 13
    hasDominantSeventh = hasDominantSeventh || !hasExplicitMajorSeventh
    rest = rest.replace(/^13/, "")
  } else if (/^11/.test(rest)) {
    stackedExtension = 11
    hasDominantSeventh = hasDominantSeventh || !hasExplicitMajorSeventh
    rest = rest.replace(/^11/, "")
  } else if (/^9/.test(rest)) {
    stackedExtension = 9
    hasDominantSeventh = hasDominantSeventh || !hasExplicitMajorSeventh
    rest = rest.replace(/^9/, "")
  } else if (/^7/.test(rest)) {
    hasDominantSeventh = true
    rest = rest.replace(/^7/, "")
  } else if (/^6\/?9?/.test(rest)) {
    hasSixth = true
    if (/^6\/9/.test(rest)) stackedExtension = 9
    rest = rest.replace(/^6\/?9?/, "")
  }

  // 残ったadd/altトークンを走査 (例: "add9", "add#11")
  const addMatches = rest.match(/add[#b]?\d+/gi) ?? []
  const allTokens = [...bracketTokens, ...addMatches.map((t) => t.replace(/^add/i, ""))]

  const tones: ChordToneInfo[] = [{ interval: 0, pitchClass: rootPc, role: "root" }]
  if (!isSus) {
    tones.push({ interval: isMinor ? 3 : 4, pitchClass: (rootPc + (isMinor ? 3 : 4)) % 12, role: "third" })
  } else {
    // susは3度の代わりに2度/4度を主要トーンとして保持する
    tones.push({ interval: 2, pitchClass: (rootPc + 2) % 12, role: "third" })
  }
  const fifthInterval = isDim ? 6 : isAug ? 8 : 7
  tones.push({ interval: fifthInterval, pitchClass: (rootPc + fifthInterval) % 12, role: "fifth" })

  if (hasExplicitMajorSeventh) {
    tones.push({ interval: 11, pitchClass: (rootPc + 11) % 12, role: "seventh" })
  } else if (hasDominantSeventh) {
    tones.push({ interval: 10, pitchClass: (rootPc + 10) % 12, role: "seventh" })
  } else if (isDim && /dim7/i.test(body)) {
    tones.push({ interval: 9, pitchClass: (rootPc + 9) % 12, role: "seventh" })
  }
  if (hasSixth) {
    tones.push({ interval: 9, pitchClass: (rootPc + 9) % 12, role: "sixth" })
  }

  const tensions: ChordToneInfo[] = []
  if (stackedExtension && stackedExtension >= 9) {
    tensions.push({ interval: 14, pitchClass: (rootPc + 14) % 12, role: "tension" })
  }
  if (stackedExtension && stackedExtension >= 11) {
    tensions.push({ interval: 17, pitchClass: (rootPc + 17) % 12, role: "tension" })
  }
  if (stackedExtension && stackedExtension >= 13) {
    tensions.push({ interval: 21, pitchClass: (rootPc + 21) % 12, role: "tension" })
  }
  for (const tok of allTokens) {
    const alt = ALTER_TOKEN[tok.replace(/[()]/g, "")]
    if (alt && !tensions.some((t) => t.interval === alt.interval)) {
      if (alt.role === "tension") tensions.push({ ...alt, pitchClass: (rootPc + alt.interval) % 12 })
      else if (alt.role === "sixth" && !tones.some((t) => t.role === "sixth")) {
        tones.push({ ...alt, pitchClass: (rootPc + alt.interval) % 12 })
      } else if (alt.role === "fifth") {
        const idx = tones.findIndex((t) => t.role === "fifth")
        if (idx >= 0) tones[idx] = { ...alt, pitchClass: (rootPc + alt.interval) % 12 }
      }
    }
  }

  const resolvedBassPc = bassPc ?? (explicitBass ? noteNameToPc(explicitBass[0], explicitBass[1] ?? "") : rootPc)

  return {
    symbol: trimmed,
    rootPc,
    rootName: pcName(rootPc),
    bassPc: resolvedBassPc,
    bassName: pcName(resolvedBassPc),
    tones,
    tensions,
    isMinor,
    isSus,
    isDominant: hasDominantSeventh && !hasExplicitMajorSeventh,
    isDiminished: isDim,
  }
}

/** シンボルに書かれていなくても、この和音の性格上「使える」テンション群(9.1 使用可能テンション) */
export function availableTensionPool(chord: ParsedChord): number[] {
  const r = chord.rootPc
  if (chord.isDiminished) return [(r + 14) % 12] // 9th程度に留める
  if (chord.isSus) return [(r + 2) % 12, (r + 5) % 12]
  if (chord.isDominant) {
    // ドミナント系は変化音を積極的に許容(Dark Romanticの半音階的経過音と相性が良い)
    return [
      (r + 14) % 12, // 9
      (r + 17) % 12, // 11
      (r + 21) % 12, // 13
      (r + 13) % 12, // b9
      (r + 15) % 12, // #9
      (r + 18) % 12, // #11
      (r + 20) % 12, // b13
    ]
  }
  if (chord.isMinor) return [(r + 14) % 12, (r + 17) % 12] // 9, 11
  return [(r + 14) % 12, (r + 21) % 12] // major: 9, 13(11は回避音として除外)
}

export function chordTonePitchClasses(chord: ParsedChord): number[] {
  return [...new Set(chord.tones.map((t) => t.pitchClass))]
}

export function allUsablePitchClasses(chord: ParsedChord): number[] {
  return [...new Set([...chordTonePitchClasses(chord), ...chord.tensions.map((t) => t.pitchClass), ...availableTensionPool(chord)])]
}

export function isChordTone(chord: ParsedChord, pc: number): boolean {
  return chordTonePitchClasses(chord).includes(((pc % 12) + 12) % 12)
}

export function isTensionTone(chord: ParsedChord, pc: number): boolean {
  const p = ((pc % 12) + 12) % 12
  return !isChordTone(chord, p) && allUsablePitchClasses(chord).includes(p)
}

/** 2つの和音の共通ピッチクラス数(9.1 前後コードとの共通音) */
export function commonToneCount(a: ParsedChord, b: ParsedChord): number {
  const setA = new Set(chordTonePitchClasses(a))
  return chordTonePitchClasses(b).filter((pc) => setA.has(pc)).length
}

/** 半音衝突の危険があるか(9.1) — 対象ピッチクラスがコード外で隣接半音を持つか */
export function hasSemitoneRisk(chord: ParsedChord, pc: number): boolean {
  const p = ((pc % 12) + 12) % 12
  const usable = new Set(allUsablePitchClasses(chord))
  if (usable.has(p)) return false
  return usable.has((p + 1) % 12) || usable.has((p - 1 + 12) % 12)
}
