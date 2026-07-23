import type { ParsedChord } from "@/core/chord"

export interface ChordVoicing {
  bassMidi: number
  upperMidi: number[]
}

/** コードトーンをベース+近接ボイシングへ配置する(MIDI出力・プレビュー共通) */
export function voiceChord(chord: ParsedChord): ChordVoicing {
  const bassMidi = 36 + chord.bassPc // C2付近
  const pitchClasses = [...new Set(chord.tones.map((t) => t.pitchClass))]
  let prev = 59 // 直前の音より高い位置へ積み上げる基準(B3付近)
  const upperMidi: number[] = []
  for (const pc of pitchClasses) {
    let m = prev + 1
    while (((m % 12) + 12) % 12 !== pc) m++
    upperMidi.push(m)
    prev = m
  }
  return { bassMidi, upperMidi }
}
