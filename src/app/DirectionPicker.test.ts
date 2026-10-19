import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { generateSelectedDirection } from "./directionGeneration"

describe("DirectionPicker", () => {
  it("方向カードの画面がプロジェクト保存アクションへ接続されている", () => {
    const source = readFileSync(resolve(__dirname, "DirectionPicker.tsx"), "utf8")
    expect(source).toContain("setArrangementDirectorWorkspace")
    expect(source).toContain("generateSelectedDirection")
  })

  it("全曲生成より先に、選んだ方向を音源提案用のプロジェクト状態へ保存する", () => {
    const order: string[] = []
    const save = vi.fn((id: string) => order.push(`save:${id}`))
    const generate = vi.fn(() => order.push("generate"))
    generateSelectedDirection({
      id: "motif-relay",
      title: "陰影と意外性",
      summary: "短い特徴音を受け渡す",
      character: "dark-experimental",
    }, save, generate, 2)

    expect(order).toEqual(["save:motif-relay", "generate"])
    expect(generate).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("短い特徴音を受け渡す"),
      expect.objectContaining({ character: "dark-experimental" }),
    )
  })

  it("展開の型を選べて、選んだ型の文言だけが意図に続く", () => {
    const source = readFileSync(resolve(__dirname, "DirectionPicker.tsx"), "utf8")
    expect(source).toContain("EMOTIONAL_MECHANISMS")
    expect(source).toContain("aria-pressed")
    const generate = vi.fn()
    const chosen = { id: "balanced-architecture" as const, title: "Balanced", summary: "主旋律を守る", character: "balanced" as const }
    generateSelectedDirection(chosen, vi.fn(), generate, 0, ["level-fade"])
    const [, brief, directive] = generate.mock.calls[0]
    expect(directive.intention).toBe("主旋律を守る。終わりはフェードアウトで終える")
    expect(directive.emotionalMechanisms).toEqual([{ mechanism: "closure-decay", means: "level-fade" }])
    expect(brief).not.toContain("フェードアウト")
    generate.mockClear()
    generateSelectedDirection(chosen, vi.fn(), generate, 0)
    expect(generate.mock.calls[0][2].intention).toBe("主旋律を守る")
  })
})
