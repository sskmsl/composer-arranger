import { describe, expect, it } from "vitest"
import { buildSmf, gridAlignedTicks, TICKS_PER_QUARTER } from "./smf"
import { parseTimeSignature } from "@/core/section"

/** SMFバイト列からFF 58 04(拍子メタイベント)を探し、[分子, 分母(2^n)]を返す */
function findTimeSignatureMeta(bytes: Uint8Array): [number, number] {
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x58 && bytes[i + 2] === 0x04) {
      return [bytes[i + 3], bytes[i + 4]]
    }
  }
  throw new Error("time signature meta event not found")
}

describe("buildSmf / time signature meta event (issue #6)", () => {
  it("6/8 の場合、MIDIメタイベントの分子は6(内部beatsPerBarの3ではない)", () => {
    const ts = parseTimeSignature("6/8")
    const bytes = buildSmf({
      name: "test",
      tempoBpm: 120,
      timeSignature: { numerator: ts.numerator, denominator: ts.denominator },
      markers: [],
      tracks: [{ name: "melody", notes: [{ pitch: 60, start: 0, duration: ts.beatsPerBar * TICKS_PER_QUARTER, velocity: 100, channel: 0 }] }],
    })
    const [numerator, denomPow2] = findTimeSignatureMeta(bytes)
    expect(numerator).toBe(6)
    expect(2 ** denomPow2).toBe(8)
  })

  it("6/8の1小節分(beatsPerBar=3拍)のノートは1440 tick(=numerator*TICKS_PER_QUARTER*4/denominator)になる", () => {
    const ts = parseTimeSignature("6/8")
    const oneBarTicks = Math.round(ts.beatsPerBar * TICKS_PER_QUARTER)
    const expectedOneBarTicks = (ts.numerator * TICKS_PER_QUARTER * 4) / ts.denominator
    expect(oneBarTicks).toBe(expectedOneBarTicks)
    expect(oneBarTicks).toBe(1440)
  })

  it("4/4 は従来どおり分子4・分母2^2", () => {
    const ts = parseTimeSignature("4/4")
    const bytes = buildSmf({
      name: "test",
      tempoBpm: 120,
      timeSignature: { numerator: ts.numerator, denominator: ts.denominator },
      markers: [],
      tracks: [{ name: "melody", notes: [] }],
    })
    const [numerator, denomPow2] = findTimeSignatureMeta(bytes)
    expect(numerator).toBe(4)
    expect(2 ** denomPow2).toBe(4)
  })
})

describe("gridAlignedTicks", () => {
  it("試聴用の小さな揺らぎは16分・3連のグリッドへ戻し、大きなずれは意図したリズムとして残す", () => {
    expect(gridAlignedTicks(0.9994, 1.4856)).toEqual({ start: 480, duration: 720 })
    expect(gridAlignedTicks(2.5083, 0.975)).toEqual({ start: 1200, duration: 480 })
    // 3連(1/3拍)はそのまま
    expect(gridAlignedTicks(1 / 3, 1 / 3)).toEqual({ start: 160, duration: 160 })
    // 0.1拍のずれは意図したものとして残す
    expect(gridAlignedTicks(2.1, 1)).toEqual({ start: 1008, duration: 480 })
  })
})
