import { describe, expect, it, vi } from "vitest"
import { backdropCloseHandlers } from "./backdropClose"

describe("モーダルの背景クリック", () => {
  const backdrop = {} as EventTarget
  const input = {} as EventTarget

  it("背景で押して背景で離したときは閉じる", () => {
    const onClose = vi.fn()
    const handlers = backdropCloseHandlers(onClose)
    handlers.onPointerDown({ target: backdrop, currentTarget: backdrop })
    handlers.onClick({ target: backdrop, currentTarget: backdrop })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("入力欄で押してドラッグし、背景で離したとき(文字の範囲選択)は閉じない", () => {
    const onClose = vi.fn()
    const handlers = backdropCloseHandlers(onClose)
    handlers.onPointerDown({ target: input, currentTarget: backdrop })
    handlers.onClick({ target: backdrop, currentTarget: backdrop })
    expect(onClose).not.toHaveBeenCalled()
  })

  it("パネルの中のクリックでは閉じない", () => {
    const onClose = vi.fn()
    const handlers = backdropCloseHandlers(onClose)
    handlers.onPointerDown({ target: input, currentTarget: backdrop })
    handlers.onClick({ target: input, currentTarget: backdrop })
    expect(onClose).not.toHaveBeenCalled()
  })
})
