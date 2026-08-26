/// <reference types="node" />
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function rgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "")
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((value) => {
    const normalized = value / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function themeColor(name: string): string {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8")
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`Missing color token: ${name}`)
  return match[1]
}

describe("dark UI text contrast", () => {
  const darkSurfaces = ["#000000", "#252527", "#272729", "#2a2a2c"]

  it("secondary text meets WCAG AA on every app surface", () => {
    const secondary = themeColor("ink-muted-48")
    for (const surface of darkSurfaces) {
      expect(contrastRatio(secondary, surface), `${secondary} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("regular muted copy has stronger contrast than secondary metadata", () => {
    const secondary = themeColor("ink-muted-48")
    const bodyMuted = themeColor("body-muted")
    for (const surface of darkSurfaces) {
      expect(contrastRatio(bodyMuted, surface)).toBeGreaterThan(contrastRatio(secondary, surface))
    }
  })
})
