import type { ComposerProject } from "@/core/project"
import type { SoundSettings } from "@/core/gmInstruments"
import { exportSongMidi } from "@/midi/exportMelody"
import { GmChannelCapacityError } from "@/midi/gmExport"

/** 音色や音符を変えず、書き出せない場合だけ利用者へ対処を案内する。 */
export function prepareSongMidiExport(project: ComposerProject, programs?: SoundSettings["programs"]):
  { ok: true; bytes: Uint8Array } | { ok: false; message: string } {
  try {
    return { ok: true, bytes: exportSongMidi(project, true, true, programs) }
  } catch (error) {
    if (!(error instanceof GmChannelCapacityError)) throw error
    return { ok: false, message: "同時に鳴る楽器が多すぎてMIDIを書き出せませんでした。パートの楽器を揃えるか、同時に使うレイヤーを減らして、もう一度お試しください。" }
  }
}
