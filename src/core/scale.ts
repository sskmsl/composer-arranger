/**
 * Issue #13: KeyからScale(ダイアトニック音名)を導出する。
 * Song Profile / Section Roleとは独立した、Key自体の唯一の生成的な意味づけとして、
 * テンション/経過音候補をこのScaleへ軽く寄せるために使う。
 */
const LETTER_PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]
const NATURAL_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10]

/** "F#m", "Bb", "Am" のようなKey表記からルートのピッチクラスと長調/短調を読み取る */
function parseKey(key: string): { rootPc: number; isMinor: boolean } | null {
  const m = /^([A-Ga-g])([#b]?)\s*(.*)$/.exec(key.trim())
  if (!m) return null
  const letter = m[1].toUpperCase()
  const base = LETTER_PITCH_CLASS[letter]
  if (base === undefined) return null
  let rootPc = base
  if (m[2] === "#") rootPc += 1
  if (m[2] === "b") rootPc -= 1
  rootPc = ((rootPc % 12) + 12) % 12
  const isMinor = /^m(?!aj)/i.test(m[3])
  return { rootPc, isMinor }
}

/** Keyのダイアトニックスケール(自然短音階/長音階)を構成するピッチクラス7つを返す。判定できない場合は空配列 */
export function keyScalePitchClasses(key: string): number[] {
  const parsed = parseKey(key)
  if (!parsed) return []
  const steps = parsed.isMinor ? NATURAL_MINOR_STEPS : MAJOR_STEPS
  return steps.map((s) => (parsed.rootPc + s) % 12)
}

/** 長調の主音ピッチクラス → 調号(シャープ正/フラット負)。F#/Gb(6)とC#/Db(1)は表記で決める */
const MAJOR_SHARPS_BY_PC: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 }

/**
 * Key表記("Bm", "Eb", "F#m"等)を、MIDIの調号メタイベント用の値へ変換する。判定できない場合はnull。
 * 短調は平行長調(主音+3半音)の調号を使う。
 */
export function keySignatureOf(key: string): { sharpsFlats: number; minor: boolean } | null {
  const parsed = parseKey(key)
  if (!parsed) return null
  const majorPc = parsed.isMinor ? (parsed.rootPc + 3) % 12 : parsed.rootPc
  let sharpsFlats = MAJOR_SHARPS_BY_PC[majorPc]
  if (majorPc === 6 && keyPrefersFlatSpelling(key)) sharpsFlats = -6
  // C#・A#m(♯7つ)は♯で書かれていれば♯の調号にする(Db・Bbmと同じ音だが表記を合わせる)
  if (majorPc === 1 && /^[A-Ga-g]#/.test(key.trim())) sharpsFlats = 7
  return { sharpsFlats, minor: parsed.isMinor }
}

const FLAT_MAJOR_ROOTS = new Set(["F", "BB", "EB", "AB", "DB", "GB", "CB"])
const FLAT_MINOR_ROOTS = new Set(["D", "G", "C", "F", "BB", "EB", "AB"])

/** Keyの調号傾向(フラット系かどうか)から、音名表記でシャープ/フラットどちらを優先すべきかを判定する */
export function keyPrefersFlatSpelling(key: string): boolean {
  const m = /^([A-Ga-g])([#b]?)\s*(.*)$/.exec(key.trim())
  if (!m) return false
  const letter = m[1].toUpperCase()
  const accidental = m[2]
  if (accidental === "#") return false
  if (accidental === "b") return true
  const isMinor = /^m(?!aj)/i.test(m[3])
  const root = `${letter}${accidental}`
  return isMinor ? FLAT_MINOR_ROOTS.has(root) : FLAT_MAJOR_ROOTS.has(root)
}
