import type { FullSongArrangement } from "./arrangementGeneration"
import type { Section } from "./section"

/**
 * セクションを並べ替え・複製・削除・長さ変更したあとで、全曲アレンジ(AIのパート)を曲の並びへ追従させる。
 * 全曲アレンジの音は曲頭からの位置で持っているので、何もしないと後ろのセクションで音がずれる。
 * 各音は属するセクションごとに、そのセクションの新しい開始位置へ動かす。
 * - 消えたセクションの音は外す
 * - 短くなったセクションでは、はみ出す音を外し、終わりをセクション末で切る
 * - 複製したセクションには、元のセクションの音をそのまま写す(copiedFrom: 新ID → 元ID)
 */
export function realignArrangementToSections(
  arrangement: FullSongArrangement | undefined,
  before: readonly Section[],
  after: readonly Section[],
  beatsPerBar: number,
  copiedFrom: Readonly<Record<string, string>> = {},
): FullSongArrangement | undefined {
  if (!arrangement) return arrangement
  const startOf = (section: Section) => (section.startBar - 1) * beatsPerBar
  const oldById = new Map(before.map((section) => [section.id, section]))
  const newById = new Map(after.map((section) => [section.id, section]))
  const unchanged = before.length === after.length
    && Object.keys(copiedFrom).length === 0
    && before.every((section, index) =>
      section.id === after[index].id
      && section.startBar === after[index].startBar
      && section.lengthBars === after[index].lengthBars,
    )
  if (unchanged) return arrangement

  /** 元セクションの音を、移し先セクションの位置へ動かす(収まらない音は外す) */
  const place = <T extends { startBeat: number; durationBeats: number; sectionId: string }>(
    note: T,
    from: Section,
    to: Section,
  ): T | null => {
    const offset = note.startBeat - startOf(from)
    const length = to.lengthBars * beatsPerBar
    if (offset < 0 || offset >= length) return null
    return {
      ...note,
      sectionId: to.id,
      // 移動を繰り返しても小数の誤差がたまらないよう丸める
      startBeat: Math.round((startOf(to) + offset) * 1e6) / 1e6,
      // 次のセクションへ少しかかる伸ばし(レガート)はそのまま。短くしたセクションだけ末尾で切る
      durationBeats: to.lengthBars < from.lengthBars ? Math.min(note.durationBeats, length - offset) : note.durationBeats,
    }
  }

  const copies = Object.entries(copiedFrom)
  const tracks = arrangement.tracks.map((track) => {
    const moved = track.notes.flatMap((note) => {
      const from = oldById.get(note.sectionId)
      const to = newById.get(note.sectionId)
      if (!from || !to) return []
      const placed = place(note, from, to)
      return placed ? [placed] : []
    })
    const copied = copies.flatMap(([newId, sourceId]) => {
      const from = oldById.get(sourceId)
      const to = newById.get(newId)
      if (!from || !to) return []
      return track.notes
        .filter((note) => note.sectionId === sourceId)
        .flatMap((note) => {
          const placed = place(note, from, to)
          return placed ? [{ ...placed, id: `${note.id}:copy:${newId}` }] : []
        })
    })
    return {
      ...track,
      notes: [...moved, ...copied].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch),
    }
  })

  const planById = new Map(arrangement.plan.sections.map((plan) => [plan.sectionId, plan]))
  const sections = after.flatMap((section) => {
    const own = planById.get(section.id)
    if (own) return [{ ...own, sectionName: section.name }]
    const sourceId = copiedFrom[section.id]
    const source = sourceId ? planById.get(sourceId) : undefined
    return source ? [{ ...source, sectionId: section.id, sectionName: section.name }] : []
  })
  const totalBeats = after.reduce((sum, section) => sum + section.lengthBars * beatsPerBar, 0)

  return {
    ...arrangement,
    analysis: { ...arrangement.analysis, totalBeats },
    plan: { ...arrangement.plan, sections },
    tracks,
  }
}
