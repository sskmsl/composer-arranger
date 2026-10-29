import { it } from "vitest"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { createEmptyProject, normalizeProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import { arrangementReviewSong } from "@/store/arrangementReviewFixtures"
import { generateFullSongArrangement } from "@/melody-engine/arrangementGenerator"
const hash=(a:ReturnType<typeof generateFullSongArrangement>)=>createHash("sha256").update(JSON.stringify({...a,createdAt:undefined})).digest("hex")
it("records complete arrangements, including plans and quality",()=>{
 const rows=[]
 for(const which of ["A","B"] as const)for(const genre of ["neoclassical","electronica",null] as const)for(const seed of [19,41,73]){
  let p=arrangementReviewSong(which);p.song.genreBlend=genre?[{id:genre,weight:1}]:[]
  let json=JSON.stringify(p);p.sections.forEach((s,i)=>json=json.split(s.id).join(`r${i}`));p=normalizeProject(JSON.parse(json))
  const a=generateFullSongArrangement(p,{seed});rows.push({case:`${which}/${genre}/${seed}`,hash:hash(a)})
 }
 for(const meter of ["4/4","3/4","6/8"])for(const seed of [19,41]){
  const p=createEmptyProject("Boundary equivalence");p.projectId="boundary-equivalence";p.song.timeSignature=meter;p.song.key="Am";p.song.genreBlend=[{id:"neoclassical",weight:1}]
  const roles=["intro","verse","pre-chorus","chorus","verse","pre-chorus","chorus","breakdown-chorus","bridge","pre-chorus","grand-chorus","outro","outro"] as const
  p.sections=roles.map((role,i)=>({id:`p${i}`,name:`Section ${i}`,role,startBar:1+i*16,lengthBars:16}))
  const bpb=parseTimeSignature(meter).beatsPerBar
  p.chords=p.sections.flatMap(s=>Array.from({length:8},(_,i)=>({id:`${s.id}:${i}`,sectionId:s.id,startBeat:i*2*bpb,durationBeats:2*bpb,symbol:["Am","F","C","G"][i%4],bass:null})))
  const a=generateFullSongArrangement(p,{seed});rows.push({case:`long/${meter}/${seed}`,hash:hash(a)})
 }
 writeFileSync(`/private/tmp/improvements-equivalence-${process.env.MEASURE_TAG}.json`,JSON.stringify(rows,null,2))
},180000)
