import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { normalizeProject } from "@/core/project"
import { arrangementSoundInstructionFromText } from "@/core/arrangementIntent"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { addGuitarRiffLayer, generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { guitarRiffDecision } from "@/melody-engine/guitarRiffDecision"
import { GuitarRiffDecisionNotice } from "./GuitarRiffDecisionNotice"

function song(genre: "neoclassical" | null) {
  let p = arrangementReviewSong("A")
  p.song.genreBlend = genre ? [{ id: genre, weight: 1 }] : []
  let json = JSON.stringify(p)
  p.sections.forEach((s, i) => { json = json.split(s.id).join(`r${i}`) })
  return normalizeProject(JSON.parse(json))
}

describe("riff decision explanations", () => {
  it("explains the observed short second-chorus riff without exposing internal terms", () => {
    const p = song("neoclassical"), a = generateFullSongArrangement(p, { seed: 19 })
    const decision = guitarRiffDecision(a)!
    expect(decision.omissions).toContainEqual({ sectionId: "r5", reason: "short-phrase" })
    const played = new Set(a.tracks.find(t => t.id === "gtr-riff")?.notes.map(n => n.sectionId))
    expect(decision.omissions.every(item => !played.has(item.sectionId))).toBe(true)
    const html = renderToStaticMarkup(<GuitarRiffDecisionNotice project={p} arrangement={a} />)
    expect(html).toContain("サビ2")
    expect(html).toContain("十分に繰り返せる長さが残らず")
    expect(html).not.toMatch(/gtr-riff|short-phrase|r5|4\/8|budget/)
  })
  it("records balance rejections from actual candidate evaluation", () => {
    const p = song(null), a = generateFullSongArrangement(p, { seed: 19 })
    expect(guitarRiffDecision(a)?.omissions.some(item => item.reason === "balance")).toBe(true)
  })
  it("does not serialize diagnostics or invent explanations after loading saved data", () => {
    const p = song("neoclassical"), a = generateFullSongArrangement(p, { seed: 19 })
    expect(JSON.stringify(a)).not.toContain("omissions")
    const opened = normalizeProject(JSON.parse(JSON.stringify({ ...p, fullSongArrangement: a }))).fullSongArrangement!
    expect(guitarRiffDecision(opened)).toBeUndefined()
    expect(renderToStaticMarkup(<GuitarRiffDecisionNotice project={p} arrangement={opened} />)).toBe("")
  })
  it("explains instruction priority while preserving the input object", () => {
    const p = song("neoclassical"), a = generateFullSongArrangement(p, { seed: 19 })
    const soundInstruction = arrangementSoundInstructionFromText("ギターのリフ")
    expect(soundInstruction?.enabled).toBe(true)
    const legacy = { ...a, tracks: a.tracks.filter(t => t.id !== "gtr-riff"),
      plan: { ...a.plan, directive: { intention: "音の指定", soundInstruction: soundInstruction! } } }
    const before = JSON.stringify(legacy)
    expect(addGuitarRiffLayer(p, legacy)).toBe(legacy)
    expect(JSON.stringify(legacy)).toBe(before)
    expect(renderToStaticMarkup(<GuitarRiffDecisionNotice project={p} arrangement={legacy} />)).toContain("指定した音作りを優先")
  })
})
