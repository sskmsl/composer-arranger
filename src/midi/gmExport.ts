import { assignGmChannels, type SoundPart, type SoundSettings } from "@/core/gmInstruments"
import type { SmfTrack } from "./smf"

/** 書き出すトラックと、その音(パート・楽器番号・ドラム) */
export interface SoundedTrack {
  track: SmfTrack
  sound: SoundPart | number | "drums"
}

/**
 * GM向けの書き出しでは、トラックごとにチャンネルと楽器番号を入れる(ドラムは10ch)。
 * programs がないとき(Logic向け)は、これまでどおり全トラックをチャンネル1のまま、楽器番号も入れない。
 */
export function withGmSounds(entries: readonly SoundedTrack[], programs?: SoundSettings["programs"]): SmfTrack[] {
  if (!programs) return entries.map((entry) => entry.track)
  const assigned = assignGmChannels(entries.map(({ sound }) =>
    sound === "drums" ? "drums" : typeof sound === "number" ? sound : programs[sound]))
  return entries.map(({ track }, index) => ({
    ...track,
    channel: assigned[index].channel,
    ...(assigned[index].program == null ? {} : { program: assigned[index].program }),
  }))
}
