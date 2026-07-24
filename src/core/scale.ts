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
