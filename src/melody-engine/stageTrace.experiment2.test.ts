import { expect, it } from "vitest"
import { writeFileSync } from "node:fs"
import { parseChordInputText } from "@/core/chordInput"
import { RANGE_PRESETS } from "./generationParams"
import { generateFromChordsWithProfiles } from "./generateFromChords"
import { traceStages, type StageNote, type StageRecord } from "./stageTrace"

/**
 * 実験2(docs/rhythm-memory-controls.md)で、リズムの指標では説明できなかった3か所の段階診断(記録専用)。
 * 答えを公開した後の非盲検の診断で、この12条件に合わせて生成を直すためのものではない。
 * STAGE_DIAGNOSTIC_OUT を指定すると、段階ごとの記録を Markdown で書き出す。
 */
const TARGETS = [
  { label: "03 varied(終わりの大きな下降)", key: "C", progression: "Dm7 G7 Cmaj7 Am7", seed: 7003, style: "varied", window: [24, 32] },
  { label: "05 plain(核の終わりのオクターブ移動)", key: "Am", progression: "Am Dm Em Am", seed: 7005, style: "plain", window: [0, 8] },
  { label: "07 plain(短い音での大きな跳躍)", key: "G", progression: "C G D Em", seed: 7007, style: "plain", window: [0, 32] },
] as const

const LEAP = 8
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
const name = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
const sorted = (notes: readonly StageNote[]) => [...notes].sort((a, b) => a.startBeat - b.startBeat)
const inWindow = (notes: readonly StageNote[], [start, end]: readonly [number, number]) =>
  sorted(notes).filter((note) => note.startBeat >= start - 1e-6 && note.startBeat < end - 1e-6)
const describe = (notes: readonly StageNote[]) => notes.map((note) => `${note.startBeat}:${name(note.pitch)}(${note.durationBeats})`).join(" ")

/** 前の段階から、窓の中の音がどう変わったか。id で対応を取り、取れない音は追加・削除として数える */
function changeKind(previous: readonly StageNote[], current: readonly StageNote[]): string {
  const before = new Map(previous.map((note) => [note.id, note]))
  const after = new Map(current.map((note) => [note.id, note]))
  const added = current.filter((note) => !before.has(note.id)).length
  const removed = previous.filter((note) => !after.has(note.id)).length
  const matched = current.filter((note) => before.has(note.id))
  const deltas = matched.map((note) => note.pitch - before.get(note.id)!.pitch)
  const moved = deltas.filter((delta) => delta !== 0)
  const rhythm = matched.filter((note) => {
    const old = before.get(note.id)!
    return old.startBeat !== note.startBeat || old.durationBeats !== note.durationBeats
  }).length
  const parts: string[] = []
  const sameDirection = moved.length > 0 && moved.length === matched.length && matched.length >= 2 &&
    moved.every((delta) => Math.sign(delta) === Math.sign(moved[0])) && Math.max(...moved) - Math.min(...moved) <= 1
  if (sameDirection && new Set(moved).size === 1) parts.push(`全体の移高 ${moved[0] > 0 ? "+" : ""}${moved[0]}`)
  else if (sameDirection) parts.push(`全体の音階上の移高と見られる(${moved.join(", ")})`)
  else {
    const octave = moved.filter((delta) => Math.abs(delta) === 12).length
    if (octave > 0) parts.push(`オクターブの移動 ${octave}音`)
    if (moved.length - octave > 0) parts.push(`音高の変更 ${moved.length - octave}音(${moved.filter((delta) => Math.abs(delta) !== 12).join(", ")})`)
  }
  if (rhythm > 0) parts.push(`開始・長さの変更 ${rhythm}音`)
  if (added > 0) parts.push(`追加 ${added}音`)
  if (removed > 0) parts.push(`削除 ${removed}音`)
  return parts.join("、")
}

interface Stage { stage: string; notes: readonly StageNote[] }

/** 最終候補の1案目が通った段階だけを、実際の処理順に取り出す */
function chosenFinishOf(records: readonly StageRecord[], poolIndex: number): string {
  const survivor = records.filter((record) => record.stage === "pool:harmonicIntegrity" && record.context.poolIndex === poolIndex).at(-1)!
  return String(records.filter((record) => record.stage === "buildCandidate:chosen" &&
    record.context.poolIndex === poolIndex && record.context.attempt === survivor.context.attempt).at(-1)!.context.chosenFinish)
}

function pathOf(records: readonly StageRecord[], poolIndex: number): Stage[] {
  const survivor = records.filter((record) => record.stage === "pool:harmonicIntegrity" && record.context.poolIndex === poolIndex).at(-1)!
  const attempt = survivor.context.attempt
  const chosen = records.filter((record) => record.stage === "buildCandidate:chosen" &&
    record.context.poolIndex === poolIndex && record.context.attempt === attempt).at(-1)!
  return records.filter((record) => {
    if (record.context.phase === "final") return record.context.patternIndex === 1
    if (record.context.poolIndex !== poolIndex || record.context.attempt !== attempt) return false
    // 仕上げ(finish)は複数の案を試すことがあるので、採用した案の記録だけを残す
    return record.context.finish === undefined || record.context.finish === chosen.context.chosenFinish
  }).map((record) => ({
    stage: record.context.phase === "final" || (record.context.phase === "craft" && !record.stage.startsWith("craft:"))
      ? `${record.context.phase}:${record.stage}`
      : record.stage,
    notes: record.notes,
  }))
}

/** 最終の大きな跳躍(隣り合う音で LEAP 半音以上)が、どの段階で初めて現れ、その後どう保たれたか */
function leapLedger(path: readonly Stage[], window: readonly [number, number]): string[] {
  const final = sorted(path.at(-1)!.notes)
  const lines: string[] = []
  final.forEach((note, index) => {
    const next = final[index + 1]
    if (!next || note.startBeat < window[0] - 1e-6 || note.startBeat >= window[1] - 1e-6) return
    if (Math.abs(next.pitch - note.pitch) < LEAP) return
    const history = path.map(({ stage, notes }) => {
      const ordered = sorted(notes)
      const a = ordered.findIndex((item) => item.id === note.id)
      const b = ordered.findIndex((item) => item.id === next.id)
      if (a < 0 || b < 0) return { stage, state: "対応不明(どちらかの音がまだない)" }
      if (b !== a + 1) return { stage, state: "隣り合っていない" }
      return { stage, state: `${name(ordered[a].pitch)}→${name(ordered[b].pitch)} (${ordered[b].pitch - ordered[a].pitch})`, interval: ordered[b].pitch - ordered[a].pitch }
    })
    const firstLeap = history.findIndex((entry) => entry.interval !== undefined && Math.abs(entry.interval) >= LEAP)
    lines.push(`- ${note.startBeat}拍 ${name(note.pitch)}(長さ ${note.durationBeats}) → ${next.startBeat}拍 ${name(next.pitch)}(長さ ${next.durationBeats}):${next.pitch - note.pitch} 半音`)
    lines.push(`  - 初めて ${LEAP} 半音以上になった段階:${firstLeap < 0 ? "不明" : history[firstLeap].stage}`)
    const changes = history.filter((entry, i) => i === 0 || entry.state !== history[i - 1].state)
    for (const entry of changes) lines.push(`  - ${entry.stage}:${entry.state}`)
  })
  return lines
}

it("実験2の3か所を、段階ごとに記録する(記録専用)", () => {
  const report: string[] = ["# 実験2の段階診断(記録専用、非盲検)", ""]
  for (const target of TARGETS) {
    const bars = target.progression.split(" ")
    const chords = parseChordInputText([...bars, ...bars].join(" | "), "s1", 4, "c")
    const { result, records } = traceStages(() => generateFromChordsWithProfiles({
      chords, sectionId: "s1", sectionRole: "chorus", songProfile: "dark-romantic", density: "balanced",
      range: RANGE_PRESETS.middle, drama: "growing", totalBeats: 32, seed: target.seed, profiles: ["standard"], key: target.key,
      coreRhythmOverride: target.style,
    }))
    const candidate = result.candidates[0]
    const poolIndex = candidate.generationDiagnostics!.candidatePoolIndex
    const path = pathOf(records, poolIndex)
    // 取り出した道筋の最後は、実際に出した音と同じ
    expect(path.at(-1)!.stage).toBe("final:output")
    expect(sorted(path.at(-1)!.notes)).toEqual(sorted(candidate.notes.map(({ id, startBeat, durationBeats, pitch }) => ({ id, startBeat, durationBeats, pitch }))))

    report.push(`## ${target.label}`, "", `- 調 ${target.key}、進行 ${target.progression}(2回)、seed ${target.seed}、候補プールの ${poolIndex} 番、窓 ${target.window[0]}〜${target.window[1]} 拍、採用した仕上げの案 ${chosenFinishOf(records, poolIndex)}`)
    const core = (candidate.coreNotes ?? []).map((note, index) => ({ id: `core${index}`, ...note }))
    report.push(`- 生成時点の核(核の頭を0拍とする):${describe(core)}`, "", "### 窓の中の音が変わった段階", "")
    let previous: readonly StageNote[] | undefined
    for (const { stage, notes } of path) {
      const current = inWindow(notes, target.window)
      if (previous && describe(current) === describe(previous) && current.every((note, index) => note.id === previous![index].id)) continue
      report.push(`- ${stage}${previous ? `(${changeKind(previous, current) || "並びの変化のみ"})` : "(最初の記録)"}:${describe(current)}`)
      previous = current
    }
    report.push("", `### 大きな跳躍(${LEAP} 半音以上)の履歴`, "", ...leapLedger(path, target.window), "")
  }
  if (process.env.STAGE_DIAGNOSTIC_OUT) writeFileSync(process.env.STAGE_DIAGNOSTIC_OUT, report.join("\n"))
})
