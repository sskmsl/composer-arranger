import { useSyncExternalStore } from "react"
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings, type SoundSettings } from "@/core/gmInstruments"

/**
 * 試聴の音と、MIDI書き出しの形式・楽器の設定。曲ごとではなく、この端末の設定として保存する。
 * GM音源の読み込み状態(読み込み中・失敗)もここで知らせる。
 */
const STORAGE_KEY = "composer-arranger:sound-settings"

export type GmLoadState = "idle" | "loading" | "failed"

let settings: SoundSettings = read()
let loadState: GmLoadState = "idle"
const listeners = new Set<() => void>()

function read(): SoundSettings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeSoundSettings(JSON.parse(raw)) : DEFAULT_SOUND_SETTINGS
  } catch {
    return DEFAULT_SOUND_SETTINGS
  }
}

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSoundSettings(): SoundSettings {
  return settings
}

export function updateSoundSettings(patch: Partial<SoundSettings>): void {
  settings = normalizeSoundSettings({ ...settings, ...patch, programs: { ...settings.programs, ...patch.programs } })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 保存できない環境(プライベートモードなど)でも、このページを開いている間は設定を使う
  }
  emit()
}

export function getGmLoadState(): GmLoadState {
  return loadState
}

export function setGmLoadState(next: GmLoadState): void {
  if (loadState === next) return
  loadState = next
  emit()
}

/** MIDI書き出しに渡す楽器番号(GM向けのときだけ。Logic向けは undefined) */
export function gmExportPrograms(current: SoundSettings = settings): SoundSettings["programs"] | undefined {
  return current.midiExport === "gm" ? current.programs : undefined
}

export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(subscribe, getSoundSettings, getSoundSettings)
}

export function useGmLoadState(): GmLoadState {
  return useSyncExternalStore(subscribe, getGmLoadState, getGmLoadState)
}
