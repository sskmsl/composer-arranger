import { createHash } from 'node:crypto'
import { generateFullSongArrangement as originalGenerate } from '@/melody-engine/arrangementGenerator'
import { DEFAULT_PART_PROGRAMS } from '@/core/gmInstruments'
import { exportArrangementMidi } from '@/midi/exportArrangement'
import { parseMidi } from '@/midi/importMidi'
import { expect, it } from 'vitest'
import { ARRANGEMENT_TRACK_NAMES } from '@/core/arrangementGeneration'
import { writeFileSync } from 'node:fs'
import { normalizeProject } from '@/core/project'
import { generateFullSongArrangement, PR213_TRACE, PR213_LEGACY, PR213_INTERNALS } from '@/melody-engine/pr213-internals'
import { arrangementReviewSong } from '@/store/arrangementReviewFixtures'
it('records stage traces and checks the observation copy against production MIDI',()=>{
 const rows=[]
 for(const which of ['A','B'] as const)for(const genre of ['neoclassical','electronica',null] as const)for(const seed of [19,41,73]){
  let p=arrangementReviewSong(which);p.song.genreBlend=genre?[{id:genre,weight:1}]:[]
  let json=JSON.stringify(p);p.sections.forEach((s,i)=>json=json.split(s.id).join(`r${i}`));p=normalizeProject(JSON.parse(json))
  PR213_TRACE.length=0
  const a=generateFullSongArrangement(p,{seed});const riff=a.tracks.find(t=>t.id==='gtr-riff')
  const original=originalGenerate(p,{seed});const digest=(a:typeof original)=>createHash('sha256').update(JSON.stringify(a.tracks.map(t=>[t.id,t.notes.map(n=>[n.pitch,n.startBeat,n.durationBeats,n.velocity,n.sectionId])]))).digest('hex')
  expect(digest(a)).toBe(digest(original))
  const midi=parseMidi(exportArrangementMidi(p,a,DEFAULT_PART_PROGRAMS)),mn=midi.tracks.find(t=>t.name==='GTR_Riff')?.notes??[]
  const section=p.sections[5],total=Math.max(...p.sections.map(s=>s.startBar+s.lengthBars-1))
  const base=PR213_LEGACY!.tracks.filter(t=>!t.muted&&!t.id.startsWith('gtr-')&&PR213_INTERNALS.isBoundaryManagedRole(t.id)).map(t=>({id:t.id,on:PR213_INTERNALS.barPresence(t.notes,total,4)}))
  const window=Array.from({length:7},(_,i)=>section.startBar-1+i-2).map(bar=>({bar:bar+1,sectionLocalBar:bar-(section.startBar-1)+1,changing:base.filter(t=>t.on[bar-1]!==t.on[bar]).map(t=>t.id)}))
  const midiBars=p.sections.map(s=>({id:s.id,bars:Array.from({length:s.lengthBars},(_,b)=>b+1).filter(b=>mn.some(n=>n.startTick/midi.ppq<(s.startBar+b-1)*4&&(n.startTick+n.durationTicks)/midi.ppq>(s.startBar+b-2)*4+.01))}))
  const managedIds=new Set(['syn-dark-pad','syn-pad-air','syn-pad-motion','syn-chord-wide','syn-stabs','syn-pulse','syn-arp-low','syn-arp-high','syn-sub-bass','syn-bass-mid','gtr-arpeggio','gtr-strum','gtr-riff'])
  const managed=new Set(Object.entries(ARRANGEMENT_TRACK_NAMES).filter(([id])=>id.startsWith('str-')||managedIds.has(id)).map(([,name])=>name))
  const presence=midi.tracks.filter(t=>managed.has(t.name)).map(t=>{
   const on=Array.from({length:total},(_,b)=>t.notes.some(n=>n.startTick/midi.ppq<(b+1)*4&&(n.startTick+n.durationTicks)/midi.ppq>b*4+.01))
   for(let i=1;i<on.length-1;i++)if(on[i-1]&&!on[i]&&on[i+1])on[i]=true
   return on
  })
  let boundaryMax=0
  p.sections.forEach((s,i)=>{if(i===0||s.role==='outro'||s.lengthBars<8||p.sections[i-1].lengthBars<8)return;for(let delta=-2;delta<=4;delta++){const b=s.startBar-1+delta;boundaryMax=Math.max(boundaryMax,presence.filter(on=>on[b-1]!==on[b]).length)}})
  expect(boundaryMax).toBeLessThanOrEqual(2)
  rows.push({boundaryMax,which,genre,seed,originalOutputEqual:digest(original)===digest(a),originalHash:digest(original),midiBars,window,trace:[...PR213_TRACE],sections:p.sections.map(s=>({id:s.id,role:s.role,energy:a.plan.sections.find(t=>t.sectionId===s.id)?.energy,bars:new Set(riff?.notes.filter(n=>n.sectionId===s.id).map(n=>Math.floor(n.startBeat/4))).size})),quality:a.quality?.score})
 }
 writeFileSync('/private/tmp/pr213-trace.json',JSON.stringify(rows,null,2))
},120000)
