import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { clsx } from "clsx"
import { SlidersHorizontal, X } from "lucide-react"
import { GM_INSTRUMENT_CHOICES, SOUND_PARTS, type SoundSettings } from "@/core/gmInstruments"
import { updateSoundSettings, useGmLoadState, useSoundSettings } from "@/audio/soundSettings"
import { backdropCloseHandlers } from "@/ui/backdropClose"
import { Select } from "@/ui/primitives"

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string; description: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            "rounded-sm border px-3 py-2 text-left transition",
            value === option.value
              ? "border-primary bg-primary/15 text-body-on-dark"
              : "border-hairline text-body-muted hover:bg-white/5 hover:text-body-on-dark",
          )}
        >
          <span className="block text-[13px] font-medium">{option.label}</span>
          <span className="mt-0.5 block text-[12px] leading-5 text-ink-soft">{option.description}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * 上部バーの「音色」。試聴の音(シンプル / GM音源)、パートごとの楽器、MIDI書き出しの形式を選ぶ。
 * 設定はこの端末に保存し、どの曲でも同じものを使う。
 */
export function SoundSettingsMenu() {
  const [open, setOpen] = useState(false)
  const settings = useSoundSettings()
  const loadState = useGmLoadState()
  const close = () => setOpen(false)
  const backdrop = useMemo(() => backdropCloseHandlers(() => setOpen(false)), [])
  const usesInstruments = settings.playback === "gm" || settings.midiExport === "gm"

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1 rounded-pill border border-hairline px-2.5 py-1 text-[13px] text-body-muted transition hover:bg-white/10 hover:text-body-on-dark"
        title="試聴の音色とMIDI書き出しの形式"
      >
        <SlidersHorizontal size={13} /> 音色
        {loadState === "loading" && <span className="text-[12px] text-primary-on-dark">読み込み中…</span>}
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3" {...backdrop}>
          <div
            role="dialog"
            aria-label="音色と書き出し"
            className="flex max-h-[90dvh] w-full max-w-[36rem] flex-col overflow-hidden rounded-lg border border-hairline bg-surface-tile-1 shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
              <h2 className="text-[15px] font-semibold text-body-on-dark">音色と書き出し</h2>
              <button type="button" onClick={close} className="rounded-full p-1 text-body-muted hover:bg-white/10 hover:text-body-on-dark" aria-label="閉じる">
                <X size={16} />
              </button>
            </header>
            <div className="flex flex-col gap-5 overflow-y-auto px-4 py-4">
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold text-body-on-dark">試聴の音</h3>
                <Choice<SoundSettings["playback"]>
                  value={settings.playback}
                  onChange={(playback) => updateSoundSettings({ playback })}
                  options={[
                    { value: "simple", label: "シンプル", description: "これまでの軽い合成音。すぐに鳴り、通信もしません" },
                    { value: "gm", label: "GM音源", description: "ピアノや弦などの録音した音。初回は楽器ごとに数MBを読み込みます" },
                  ]}
                />
                {settings.playback === "gm" && loadState === "failed" && (
                  <p className="text-[12px] text-amber-400">GM音源を読み込めなかったので、シンプルな音で鳴らしました。通信できる状態で、もう一度再生してください。</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold text-body-on-dark">MIDIの書き出し</h3>
                <Choice<SoundSettings["midiExport"]>
                  value={settings.midiExport}
                  onChange={(midiExport) => updateSoundSettings({ midiExport })}
                  options={[
                    { value: "logic", label: "Logic向け", description: "全トラックをチャンネル1、楽器の指定なし。Logic Pro で音源を選んで使うとき" },
                    { value: "gm", label: "GM向け", description: "パートごとにチャンネルと下の楽器を入れる(ドラムは10ch)。GM音源でそのまま鳴らすとき" },
                  ]}
                />
              </section>

              <section className={clsx("flex flex-col gap-2", !usesInstruments && "opacity-50")}>
                <h3 className="text-[13px] font-semibold text-body-on-dark">パートごとの楽器</h3>
                <p className="text-[12px] text-ink-soft">
                  {usesInstruments ? "GM音源の試聴と、GM向けの書き出しで使います。" : "GM音源の試聴か、GM向けの書き出しを選ぶと使います。"}
                  全曲アレンジのパートとドラムは、役割に合わせた楽器を自動で使います。
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SOUND_PARTS.map((part) => (
                    <label key={part.id} className="flex items-center justify-between gap-2 text-[13px] text-body-muted">
                      <span className="w-20 shrink-0">{part.label}</span>
                      <Select
                        value={settings.programs[part.id]}
                        onChange={(event) => updateSoundSettings({ programs: { ...settings.programs, [part.id]: Number(event.target.value) } })}
                        className="min-w-0 flex-1 !py-1"
                      >
                        {GM_INSTRUMENT_CHOICES.map((choice) => (
                          <option key={choice.program} value={choice.program}>{choice.label}</option>
                        ))}
                      </Select>
                    </label>
                  ))}
                </div>
              </section>

              <p className="text-[12px] leading-5 text-ink-soft">
                GM音源: FluidR3_GM(Frank Wen)を MIDI.js 用に書き出したもの(
                <a className="underline" href="https://github.com/gleitz/midi-js-soundfonts" target="_blank" rel="noreferrer">gleitz/midi-js-soundfonts</a>
                、CC BY 3.0)。設定はこの端末に保存し、どの曲でも同じものを使います。
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
