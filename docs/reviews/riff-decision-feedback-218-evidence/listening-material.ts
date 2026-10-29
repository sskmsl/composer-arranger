import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { normalizeProject } from '@/core/project'
import { parseTimeSignature } from '@/core/section'
import { DEFAULT_PART_PROGRAMS } from '@/core/gmInstruments'
import { arrangementReviewSong } from '@/store/arrangementReviewFixtures'
import { generateFullSongArrangement } from '@/melody-engine/arrangementGenerator'
import { exportSongMidi } from '@/midi/exportMelody'
import { exportArrangementTrackMidi } from '@/midi/exportArrangement'
import { riffMeterSong } from './qa/riffMeterSong'
it('prepares MIDI material without claiming subjective listening',()=>{
 const rows=[]
 for(const id of ['review-a','review-b','meter-3-4']){
  let p=id==='meter-3-4'?riffMeterSong('3/4'):arrangementReviewSong(id==='review-a'?'A':'B')
  const seed=id==='review-b'?41:19
  if(id!=='meter-3-4'){
   p.song.genreBlend=[{id:id==='review-a'?'neoclassical':'electronica',weight:1}]
   let json=JSON.stringify(p);p.sections.forEach((s,i)=>json=json.split(s.id).join(`r${i}`));p=normalizeProject(JSON.parse(json))
  }
  const a=generateFullSongArrangement(p,{seed});p.fullSongArrangement=a
  const bpb=parseTimeSignature(p.song.timeSignature).beatsPerBar
  const variants={gm:exportSongMidi(p,true,true,DEFAULT_PART_PROGRAMS),logic:exportSongMidi(p,true,true),riff:exportArrangementTrackMidi(p,a,'gtr-riff',DEFAULT_PART_PROGRAMS)}
  for(const [kind,bytes]of Object.entries(variants))writeFileSync(`/private/tmp/riff-validation-listening/${id}-${kind}.mid`,bytes)
  rows.push({id,seed,meter:p.song.timeSignature,sections:p.sections.map(s=>({name:s.name,role:s.role,startBar:s.startBar,lengthBars:s.lengthBars,riffBars:new Set(a.tracks.find(t=>t.id==='gtr-riff')?.notes.filter(n=>n.sectionId===s.id).map(n=>Math.floor(n.startBeat/bpb))).size})),files:Object.entries(variants).map(([kind,bytes])=>({name:`${id}-${kind}.mid`,bytes:bytes.length}))})
 }
 writeFileSync('/private/tmp/riff-validation-listening/manifest.json',JSON.stringify({listeningPerformed:false,dawVerified:false,cases:rows},null,2))
},30000)
