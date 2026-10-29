import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { createEmptyProject } from "@/core/project"
import { arrangementPartMatrix, type ArrangementCellChange } from "@/core/arrangementChat"
import { ArrangementChangeSummary } from "./ArrangementChangeSummary"

const project = createEmptyProject("Summary")
project.sections = [
  { id: "verse", name: "Aメロ", role: "verse", startBar: 1, lengthBars: 8 },
  { id: "chorus", name: "サビ", role: "chorus", startBar: 9, lengthBars: 8 },
]
const matrix = arrangementPartMatrix(project, undefined)
const changes: ArrangementCellChange[] = [
  { sectionId: "chorus", rowId: "pad", kind: "added" },
  { sectionId: "chorus", rowId: "drums", kind: "removed" },
  { sectionId: "chorus", rowId: "bass", kind: "changed", detail: "音域を下げる" },
]
const play = () => {}

describe("arrangement changes in plain language", () => {
  it("shows only affected sections and distinguishes an unapplied proposal", () => {
    const html = renderToStaticMarkup(<ArrangementChangeSummary matrix={matrix} changes={changes}
      proposal={{ title: "広がりを出す案", summary: "主旋律を残す" }} playingSectionId={null} playingProposal={false}
      onPlayCurrent={play} onPlayProposal={play} onApply={play} />)
    expect(html).toContain("未適用")
    expect(html).toContain("サビの変更内容")
    expect(html).not.toContain("Aメロ")
    expect(html).toContain("パッドを加える")
    expect(html).toContain("ドラムを休ませる")
    expect(html).toContain("ベース：音域を下げる")
    expect(html).toContain("変更前を聴く")
    expect(html).toContain("変更案を聴く")
    expect(html).toContain("この案をまとめて適用します")
    expect(html).not.toContain("変える?")
  })

  it("does not offer a proposal preview or reapply action for applied changes", () => {
    const html = renderToStaticMarkup(<ArrangementChangeSummary matrix={matrix} changes={changes}
      playingSectionId={null} playingProposal={false} onPlayCurrent={play} />)
    expect(html).toContain("適用済み")
    expect(html).toContain("パッドを追加")
    expect(html).toContain("ドラムは休止")
    expect(html).toContain("この箇所を聴く")
    expect(html).not.toContain("変更案を聴く")
    expect(html).not.toContain("この案を使う")
  })

  it("handles no comparison without inventing a change or a reason", () => {
    const html = renderToStaticMarkup(<ArrangementChangeSummary matrix={matrix} changes={[]}
      playingSectionId={null} playingProposal={false} onPlayCurrent={play} />)
    expect(html).toContain("比較できる変更はありません")
    expect(html).not.toContain("適用済み")
    expect(html).not.toContain("を加える")
  })

  it("keeps a long list compact: shows the first six sections and offers the rest", () => {
    const long = createEmptyProject("Long")
    long.sections = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, name: `区間${i + 1}`, role: "verse" as const, startBar: 1 + i * 8, lengthBars: 8 }))
    const many: ArrangementCellChange[] = long.sections.map((section) => ({ sectionId: section.id, rowId: "pad", kind: "added" }))
    const html = renderToStaticMarkup(<ArrangementChangeSummary matrix={arrangementPartMatrix(long, undefined)} changes={many}
      playingSectionId={null} playingProposal={false} onPlayCurrent={play} />)
    expect(html).toContain("区間6の変更内容")
    expect(html).not.toContain("区間7の変更内容")
    expect(html).toContain("残り3区間を表示")
  })

  it("labels each change by kind and counts them so the result reads at a glance", () => {
    const html = renderToStaticMarkup(<ArrangementChangeSummary matrix={matrix} changes={changes}
      playingSectionId={null} playingProposal={false} onPlayCurrent={play} />)
    expect(html).toContain("1区間で")
    for (const label of ["追加 1", "変更 1", "休み 1"]) expect(html).toContain(label)
    expect(html.indexOf("パッドを追加")).toBeLessThan(html.indexOf("ベース：音域を下げる"))
    expect(html.indexOf("ベース：音域を下げる")).toBeLessThan(html.indexOf("ドラムは休止"))
  })

  it("lays the sections out in two columns so the list needs less scrolling", () => {
    const html = renderToStaticMarkup(<ArrangementChangeSummary matrix={matrix} changes={changes}
      playingSectionId={null} playingProposal={false} onPlayCurrent={play} />)
    expect(html).toContain("sm:grid-cols-2")
  })
})
