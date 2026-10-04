import { describe, expect, it } from "vitest"
import { DEFAULT_PART_PROGRAMS } from "@/core/gmInstruments"
import {
  arrangementPreviewMix,
  belongsToContinuousPreviewWindow,
  gmPreviewRequests,
  noisePercussionSpec,
  whiteNoiseSamples,
  previewLayersForMode,
  previewTailSeconds,
  resolveComparisonSwitchBeat,
  resolveReactivePreviewRange,
} from "./previewPlayer"

describe("continuous full-song preview", () => {
  it("区間境界の音を次区間だけへ割り当て、二重発音させない", () => {
    expect(belongsToContinuousPreviewWindow(32, 33, 0, 0, 32, true)).toBe(false)
    expect(belongsToContinuousPreviewWindow(32, 33, 0, 32, 64, false)).toBe(true)
  })

  it("途中再生時に開始位置をまたぐ長音を最初の区間へ含める", () => {
    expect(belongsToContinuousPreviewWindow(44, 48, 45, 45, 77, true)).toBe(true)
    expect(belongsToContinuousPreviewWindow(44, 45, 45, 45, 77, true)).toBe(false)
  })
})

describe("signature preview expression", () => {
  it("空間型だけはフレーズ終端で残響を切らない", () => {
    expect(previewTailSeconds("atmospheric")).toBeGreaterThanOrEqual(1)
    expect(previewTailSeconds("obsessive")).toBeLessThan(0.5)
    expect(previewTailSeconds("kinetic")).toBeLessThan(0.5)
  })
})

describe("comparison preview switching", () => {
  it("A/B/C切替時に現在の再生位置を維持する", () => {
    expect(resolveComparisonSwitchBeat(6.25, 4, 12)).toBe(6.25)
  })

  it("ループ範囲外なら共通の先頭位置へ戻す", () => {
    expect(resolveComparisonSwitchBeat(12, 4, 12)).toBe(4)
    expect(resolveComparisonSwitchBeat(2, 4, 12)).toBe(4)
  })
})

describe("reactive candidate preview range", () => {
  it("候補の前後だけを再生し、Section末まで待たせない", () => {
    expect(
      resolveReactivePreviewRange(
        [
          {
            id: "n1",
            startBeat: 6,
            durationBeats: 0.5,
            pitch: 64,
            velocity: 70,
            locks: [],
          },
          {
            id: "n2",
            startBeat: 7,
            durationBeats: 1,
            pitch: 67,
            velocity: 70,
            locks: [],
          },
        ],
        16,
      ),
    ).toEqual({ startBeat: 5, endBeat: 8.5 })
  })

  it("Section境界を越えない", () => {
    expect(
      resolveReactivePreviewRange(
        [
          {
            id: "n1",
            startBeat: 0.25,
            durationBeats: 0.5,
            pitch: 64,
            velocity: 70,
            locks: [],
          },
          {
            id: "n2",
            startBeat: 15,
            durationBeats: 1,
            pitch: 67,
            velocity: 70,
            locks: [],
          },
        ],
        16,
      ),
    ).toEqual({ startBeat: 0, endBeat: 16 })
  })
})

describe("preview layer modes", () => {
  it("Arpeggio Onlyではコードとメロディを鳴らさず伴奏Patternだけを鳴らす", () => {
    expect(previewLayersForMode("accompaniment-only")).toEqual({
      chords: false,
      melody: false,
      accompaniment: true,
      reactive: false,
    })
  })

  it("Chords OnlyへAccompaniment Patternが混入しない", () => {
    expect(previewLayersForMode("chords-only")).toEqual({
      chords: true,
      melody: false,
      accompaniment: false,
      reactive: false,
    })
  })

  it("Chords + Melodyでは独立伴奏Patternも合わせて鳴らす", () => {
    expect(previewLayersForMode("chords-melody")).toEqual({
      chords: true,
      melody: true,
      accompaniment: true,
      reactive: false,
    })
  })

  it("Reactive Layerを単独またはMelodyとのCombinedで選べる", () => {
    expect(previewLayersForMode("reactive-only")).toEqual({
      chords: false,
      melody: false,
      accompaniment: false,
      reactive: true,
    })
    expect(previewLayersForMode("melody-reactive")).toEqual({
      chords: false,
      melody: true,
      accompaniment: false,
      reactive: true,
    })
    expect(previewLayersForMode("chords-reactive")).toEqual({
      chords: true,
      melody: false,
      accompaniment: false,
      reactive: true,
    })
  })

  it("Full Active Contextでは全レイヤーを同じ時間軸で鳴らす", () => {
    expect(previewLayersForMode("active-context-reactive")).toEqual({
      chords: true,
      melody: true,
      accompaniment: true,
      reactive: true,
    })
  })
})

describe("GM音源で鳴らすときに読み込む音", () => {
  const note = (pitch: number) => ({ id: `n${pitch}`, startBeat: 0, durationBeats: 1, pitch, velocity: 80, locks: [] })

  it("鳴らすレイヤーの音だけを、パートの楽器ごとに集める(ドラムは読み込まない)", () => {
    const requests = gmPreviewRequests({
      bpm: 96,
      chords: [],
      melody: [note(72), note(74)],
      reactive: [note(60)],
      reactivePart: "decoration",
      melodyPart: "phrase",
      arrangementTracks: [
        { id: "dr-kick", notes: [{ ...note(36), sectionId: "s", reason: "", role: "drums" } as never] },
        { id: "str-cello", notes: [{ ...note(48), sectionId: "s", reason: "", role: "strings" } as never] },
      ],
      mode: "melody-reactive",
    }, { ...DEFAULT_PART_PROGRAMS, phrase: 73, decoration: 12 })
    expect(Object.fromEntries([...requests].map(([file, pitches]) => [file, [...pitches]]))).toEqual({
      flute: [72, 74],
      marimba: [60],
      cello: [48],
    })
  })

  it("主旋律だけの再生では、対旋律の音を読み込まない", () => {
    const requests = gmPreviewRequests({ bpm: 96, chords: [], melody: [note(72)], reactive: [note(60)], mode: "melody-only" }, DEFAULT_PART_PROGRAMS)
    expect([...requests.keys()]).toEqual(["acoustic_grand_piano"])
  })
})

describe("打楽器の雑音", () => {
  it("雑音は特定の高さの音(以前の約3kHzの音)ではなく、平均0で隣の値と相関しない", () => {
    const samples = whiteNoiseSamples(44_100)
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    expect(Math.abs(mean)).toBeLessThan(0.02)
    let lag1 = 0
    let power = 0
    for (let index = 1; index < samples.length; index += 1) {
      lag1 += samples[index] * samples[index - 1]
      power += samples[index] * samples[index]
    }
    expect(Math.abs(lag1 / power)).toBeLessThan(0.05)
    expect(samples.every((value) => value >= -1 && value <= 1)).toBe(true)
  })

  it("クローズのハイハットは短く、クラッシュは長く減衰する(音価によらない)", () => {
    expect(noisePercussionSpec("dr-closed-hat").decay).toBeLessThanOrEqual(0.06)
    expect(noisePercussionSpec("dr-open-hat").decay).toBeGreaterThan(noisePercussionSpec("dr-closed-hat").decay)
    expect(noisePercussionSpec("dr-crash").decay).toBeGreaterThan(0.8)
    expect(noisePercussionSpec("dr-snare").body).toBeDefined()
  })

  it("追加したドラム層を同じスネア音へ潰さず、役割ごとの減衰と胴鳴りに分ける", () => {
    expect(noisePercussionSpec("dr-kick-click").decay).toBeLessThan(0.05)
    expect(noisePercussionSpec("dr-shaker").frequency).toBeGreaterThan(8000)
    expect(noisePercussionSpec("dr-ride").decay).toBeGreaterThan(0.5)
    expect(noisePercussionSpec("dr-cymbal-swell").decay).toBeGreaterThan(1)
    expect(noisePercussionSpec("dr-snare-body").body).toBeDefined()
  })
})

describe("全曲アレンジの試聴ミックス", () => {
  it("補助層を中央へ重ねず、低域・中域・高域を別の帯域と左右へ配置する", () => {
    expect(arrangementPreviewMix("syn-sub-bass")).toMatchObject({ pan: 0, filter: { type: "lowpass" } })
    expect(arrangementPreviewMix("syn-pad-air").pan).toBeLessThan(-0.3)
    expect(arrangementPreviewMix("syn-pad-motion").pan).toBeGreaterThan(0.3)
    expect(arrangementPreviewMix("str-high-octave")).toMatchObject({ filter: { type: "highpass" } })
    expect(arrangementPreviewMix("dr-shaker").pan).not.toBe(0)
    expect(arrangementPreviewMix("dr-ride").pan).not.toBe(0)
  })

  it("主役を残しつつ、追加層が消えない実用的な音量を持つ", () => {
    expect(arrangementPreviewMix("syn-bass").gain).toBeGreaterThan(arrangementPreviewMix("syn-bass-mid").gain)
    expect(arrangementPreviewMix("syn-bass-mid").gain).toBeGreaterThanOrEqual(0.64)
    expect(arrangementPreviewMix("syn-pad-air").gain).toBeGreaterThanOrEqual(0.64)
    expect(arrangementPreviewMix("str-high-octave").gain).toBeGreaterThanOrEqual(0.64)
  })
})
