import { it } from "vitest"
import { writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { createEmptyProject } from "@/core/project"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
it("records explicit non-adoption comparisons", () => {
 const results=[]
 for (const count of [1,8,13]) {
  const p=createEmptyProject("Riff fallback measurement");p.projectId=`fallback-${count}`;p.song.key="Cm";p.song.genreBlend=[{id:"neoclassical",weight:1}]
  p.sections=Array.from({length:count},(_,i)=>({id:`s${i}`,name:`Section ${i}`,role:"chorus" as const,startBar:1+i*8,lengthBars:8}))
  p.chords=p.sections.flatMap((s)=>["Cm","Ab","Bb","G7"].map((symbol,i)=>({id:`${s.id}:${i}`,sectionId:s.id,startBeat:i*8,durationBeats:8,symbol,bass:null})))
  const a=generateFullSongArrangement(p,{seed:19})
  const hash=createHash("sha256").update(JSON.stringify(a.tracks.map((t)=>[t.id,t.notes.map((n)=>[n.pitch,n.startBeat,n.durationBeats,n.velocity,n.sectionId])]))).digest("hex")
  results.push({count,hash,quality:a.quality?.score,passed:a.quality?.passed,riffNotes:a.tracks.find((t)=>t.id==="gtr-riff")?.notes.length??0})
 }
 writeFileSync(`/private/tmp/pr207-fallback-${process.env.RIFF_MEASURE_TAG}.json`,JSON.stringify(results,null,2))
},120000)
