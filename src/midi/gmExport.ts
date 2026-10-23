import { assignGmChannels, GM_DRUM_CHANNEL, type SoundPart, type SoundSettings } from "@/core/gmInstruments"
import type { SmfTrack } from "./smf"

/** 書き出すトラックと、その音(パート・楽器番号・ドラム) */
export interface SoundedTrack {
  track: SmfTrack
  sound: SoundPart | number | "drums"
}

const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] as const

interface ActiveNote {
  end: number
  pitch: number
  trackIndex: number
}

interface ChannelState {
  channel: number
  program?: number
  active: ActiveNote[]
  /** 直近にプログラムチェンジを書いたtick。同tickに同じチャンネルを使う別トラックにも同じ指定を届ける。 */
  changeTick?: number
}

/** 1つのGMポートで保存音色とノートを保てない場合。音色を黙って統合しない。 */
export class GmChannelCapacityError extends Error {
  readonly tick: number
  readonly program: number
  readonly pitch: number

  constructor(tick: number, program: number, pitch: number) {
    super(`GM channel capacity exceeded at tick ${tick} (program ${program}, pitch ${pitch})`)
    this.name = "GmChannelCapacityError"
    this.tick = tick
    this.program = program
    this.pitch = pitch
  }
}

function dynamicallyAssignedTracks(entries: readonly SoundedTrack[], sounds: ReadonlyArray<number | "drums">): SmfTrack[] {
  const states: ChannelState[] = MELODIC_CHANNELS.map((channel) => ({ channel, active: [] }))
  const notes = entries.flatMap(({ track }, trackIndex) => sounds[trackIndex] === "drums" ? [] : track.notes.map((note) => ({
    note,
    trackIndex,
    program: sounds[trackIndex] as number,
  }))).sort((a, b) => a.note.start - b.note.start || a.trackIndex - b.trackIndex || a.note.pitch - b.note.pitch)
  const assignedNotes = entries.map(() => [] as SmfTrack["notes"])
  const programChanges = entries.map(() => [] as NonNullable<SmfTrack["programChanges"]>)
  const changeKeys = entries.map(() => new Set<string>())

  for (const scheduled of notes) {
    const { note, trackIndex, program } = scheduled
    // 同じトラックでは NoteOff → ProgramChange → NoteOn の順を保証できる。
    // 別トラックの同tick順は保証されないため、終了tickが同じ音は発音中として扱う。
    // 終了が同tickの別トラックの音は、後から処理する音のためにも残す(同tickの先行トラックの音で消さない)。
    const sounding = (active: ActiveNote) =>
      active.end > note.start || (active.end === note.start && active.trackIndex !== trackIndex)
    for (const state of states) state.active = state.active.filter((active) => active.end >= note.start)

    const sameProgram = states
      .filter((state) => state.program === program && !state.active.some((active) => sounding(active) && active.pitch === note.pitch))
      .sort((a, b) => b.active.filter(sounding).length - a.active.filter(sounding).length || a.channel - b.channel)[0]
    const idle = states
      .filter((state) => !state.active.some(sounding))
      .sort((a, b) => Number(b.program === program) - Number(a.program === program)
        || Number(a.program != null) - Number(b.program != null)
        || a.channel - b.channel)[0]
    const state = sameProgram ?? idle
    if (!state) throw new GmChannelCapacityError(note.start, program, note.pitch)

    const needsProgramChange = state.program !== program
    state.program = program
    state.active.push({ end: note.start + note.duration, pitch: note.pitch, trackIndex })
    assignedNotes[trackIndex].push({ ...note, channel: state.channel })
    // 同じprogramの再指定は持続音へ影響し得るため、初回と実際の時間再利用時だけ書く。
    // 同じtickに同じチャンネルを使う別トラックの NoteOn は、並びが逆でも指定を受けられるよう、同じ指定を各トラックに書く。
    const key = `${note.start}:${state.channel}:${program}`
    if ((needsProgramChange || state.changeTick === note.start) && !changeKeys[trackIndex].has(key)) {
      changeKeys[trackIndex].add(key)
      programChanges[trackIndex].push({ tick: note.start, channel: state.channel, program })
      state.changeTick = note.start
    }
  }

  return entries.map(({ track }, index) => {
    if (sounds[index] === "drums") {
      return { ...track, channel: GM_DRUM_CHANNEL }
    }
    if (track.notes.length === 0) {
      const { channel: _channel, program: _program, programChanges: _changes, ...rest } = track
      return rest
    }
    const { channel: _channel, program: _program, ...rest } = track
    return { ...rest, notes: assignedNotes[index], programChanges: programChanges[index] }
  })
}

/**
 * GM向けの書き出しでは、トラックごとにチャンネルと楽器番号を入れる(ドラムは10ch)。
 * programs がないとき(Logic向け)は、これまでどおり全トラックをチャンネル1のまま、楽器番号も入れない。
 */
export function withGmSounds(entries: readonly SoundedTrack[], programs?: SoundSettings["programs"]): SmfTrack[] {
  if (!programs) return entries.map((entry) => entry.track)
  const sounds = entries.map(({ sound }) =>
    sound === "drums" ? "drums" : typeof sound === "number" ? sound : programs[sound])
  const assigned = assignGmChannels(sounds)
  const usedChannels = new Set<number>()
  const sharesSoundingChannel = entries.some(({ track }, index) => {
    if (!track.notes.length || sounds[index] === "drums") return false
    const channel = assigned[index].channel
    if (usedChannels.has(channel)) return true
    usedChannels.add(channel)
    return false
  })
  if (sharesSoundingChannel) return dynamicallyAssignedTracks(entries, sounds)
  return entries.map(({ track }, index) => ({
    ...track,
    channel: assigned[index].channel,
    ...(assigned[index].program == null ? {} : { program: assigned[index].program }),
  }))
}
