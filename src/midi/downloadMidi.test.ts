import { afterEach, describe, expect, it, vi } from "vitest"
import { downloadMidi } from "./exportMelody"

describe("downloadMidi", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("保存開始後までObject URLを保持し、安全な.mid名で書き出す", () => {
    vi.useFakeTimers()
    const click = vi.fn()
    const remove = vi.fn()
    const anchor = {
      href: "",
      download: "",
      style: { display: "" },
      click,
      remove,
    }
    const appendChild = vi.fn()
    const createObjectURL = vi.fn(() => "blob:midi")
    const revokeObjectURL = vi.fn()

    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    })
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL })
    vi.stubGlobal("window", { setTimeout, isSecureContext: false })

    downloadMidi(new Uint8Array([0x4d, 0x54, 0x68, 0x64]), "Song/A Melody")

    expect(anchor.href).toBe("blob:midi")
    expect(anchor.download).toBe("Song-A Melody.mid")
    expect(anchor.style.display).toBe("none")
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    expect(remove).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:midi")
  })

  it("対応ブラウザでは保存ダイアログ経由でMIDIを書き込む", async () => {
    const write = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const createWritable = vi.fn(async () => ({ write, close }))
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }))
    const createObjectURL = vi.fn()

    vi.stubGlobal("document", {
      createElement: vi.fn(),
      body: { appendChild: vi.fn() },
    })
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() })
    vi.stubGlobal("window", { isSecureContext: true, showSaveFilePicker })

    downloadMidi(new Uint8Array([0x4d, 0x54, 0x68, 0x64]), "Melody")
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "Melody.mid",
      types: [{
        description: "Standard MIDI File",
        accept: { "audio/midi": [".mid"] },
      }],
    })
    expect(createWritable).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith(expect.any(Blob))
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
