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
})
