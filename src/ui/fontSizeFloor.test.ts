import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe("site font size floor", () => {
  it("11px未満の固定文字サイズをアプリとマニュアルへ追加しない", () => {
    const targets = [
      ...files(join(process.cwd(), "src")).filter((path) => /\.(?:ts|tsx|css)$/.test(path)),
      join(process.cwd(), "public/manual.html"),
    ]
    const violations = targets.flatMap((path) => {
      const source = readFileSync(path, "utf8")
      const values = [
        ...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g),
        ...source.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g),
        ...source.matchAll(/fontSize=\{(\d+(?:\.\d+)?)\}/g),
      ]
      return values
        .filter((match) => Number(match[1]) < 11)
        .map((match) => `${path}:${match[0]}`)
    })
    expect(violations).toEqual([])
  })
})
