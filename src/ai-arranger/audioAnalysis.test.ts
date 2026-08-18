import { describe, expect, it } from "vitest"
import { summarizeAudioSamples } from "./audioAnalysis"

describe("summarizeAudioSamples", () => {
  it("extracts a normalized energy shape and peak position", () => {
    const samples = new Float32Array(16_000)
    for (let index = 0; index < samples.length; index += 1) {
      const strength = index < 8_000 ? 0.1 : 0.8
      samples[index] = Math.sin(index / 8) * strength
    }
    const result = summarizeAudioSamples(samples, 2, 8_000, 1)
    expect(result.energyCurve).toHaveLength(16)
    expect(result.energyCurve[15]).toBeGreaterThan(result.energyCurve[0])
    expect(result.peakPosition).toBeGreaterThan(0.5)
    expect(result.dynamicRange).toBeGreaterThan(0.5)
  })

  it("reports silence for an empty waveform", () => {
    const result = summarizeAudioSamples(new Float32Array(8_000), 1, 8_000, 1)
    expect(result.silenceRatio).toBe(1)
    expect(result.dynamicRange).toBe(0)
  })
})
