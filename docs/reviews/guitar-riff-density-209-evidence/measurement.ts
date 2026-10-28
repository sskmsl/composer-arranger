import { it } from 'vitest'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { normalizeProject } from '@/core/project'
import { ARRANGEMENT_TRACK_NAMES } from '@/core/arrangementGeneration'
import { parseChordSymbol } from '@/core/chord'
import { DEFAULT_PART_PROGRAMS } from '@/core/gmInstruments'
import { buildSongPlaybackMaterial } from '@/core/sectionTimeline'
import { generateFullSongArrangement, regenerateFullSongArrangementTarget } from '@/melody-engine/arrangementGenerator'
import { arrangementReviewSong } from '@/store/arrangementReviewFixtures'
import { arrangementSoundedTracks, exportArrangementMidi } from '@/midi/exportArrangement'
import { withGmSounds } from '@/midi/gmExport'
import { parseMidi } from '@/midi/importMidi'
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
it('records final MIDI density and safety without changing fixtures',()=>{
 const rows=[]
 for(const which of ['A','B'] as const) for(const genre of ['neoclassical','electronica',null] as const) for(const seed of [1,19,41,73,101]) {
  let p=arrangementReviewSong(which);p.song.genreBlend=genre?[{id:genre,weight:1}]:[]
  let json=JSON.stringify(p);p.sections.forEach((s,i)=>json=json.split(s.id).join(`r${i}`));p=normalizeProject(JSON.parse(json))
  const a=generateFullSongArrangement(p,{seed});const bytes=exportArrangementMidi(p,a,DEFAULT_PART_PROGRAMS);const midi=parseMidi(bytes)
  const riff=midi.tracks.find(t=>t.name==='GTR_Riff')?.notes??[]
  const rawRiff=a.tracks.find(t=>t.id==='gtr-riff')?.notes??[]
  const bars=p.sections.map(s=>({id:s.id,role:s.role,length:s.lengthBars,bars:Array.from({length:s.lengthBars},(_,b)=>b).filter(b=>riff.some(n=>n.startTick/midi.ppq<(s.startBar+b)*4&&(n.startTick+n.durationTicks)/midi.ppq>(s.startBar+b-1)*4+.01))}))
  const notes=(name:string)=>midi.tracks.filter(t=>t.name===name).flatMap(t=>t.notes.map(n=>({start:n.startTick/midi.ppq,end:(n.startTick+n.durationTicks)/midi.ppq,pitch:n.pitch})))
  const bass=notes('SYN_Bass');const r=notes('GTR_Riff');const pc=(n:number)=>((n%12)+12)%12
  const bassClashes=r.filter(n=>bass.some(b=>Math.min(n.end,b.end)-Math.max(n.start,b.start)>.1&&[1,11].includes(Math.abs(pc(n.pitch)-pc(b.pitch))))).length
  const clusters: typeof r[]=[]
  for(const n of [...r].sort((a,b)=>a.start-b.start||a.pitch-b.pitch)){
   const last=clusters.at(-1);if(last&&Math.abs(last[0].start-n.start)<.05)last.push(n);else clusters.push([n])
  }
  let rootOff=0,fifthClashes=0,powerRangeOff=0
  for(const group of clusters.filter(c=>c.length>=2)){
   const low=group[0],sounding=bass.filter(b=>b.start<=low.start+.05&&b.end>low.start+.1)
   const section=p.sections.find(s=>low.start>=(s.startBar-1)*4&&low.start<(s.startBar-1+s.lengthBars)*4)
   const local=section?low.start-(section.startBar-1)*4:0
   const chord=section?p.chords.find(c=>c.sectionId===section.id&&c.startBeat<=local+.001&&local<c.startBeat+c.durationBeats-.001):null
   const parsed=chord?parseChordSymbol(chord.symbol,chord.bass??undefined):null
   if(sounding.length?!sounding.some(b=>pc(b.pitch)===pc(low.pitch)):parsed&&pc(low.pitch)!==parsed.rootPc)rootOff++
   if(low.pitch<40||low.pitch>52)powerRangeOff++
   const fifth=group.find(n=>pc(n.pitch-low.pitch)===7),tones=parsed?.tones.map(t=>t.pitchClass)??[]
   if(fifth&&!tones.includes(pc(fifth.pitch))&&tones.some(t=>[1,11].includes(Math.abs(pc(fifth.pitch)-t))))fifthClashes++
  }
  const range=r.length?[Math.min(...r.map(n=>n.pitch)),Math.max(...r.map(n=>n.pitch))]:null
  const lead=buildSongPlaybackMaterial(p,a.plan.directive?.timelineConstraints).lead
  const leadClashes=rawRiff.filter(n=>lead.some(l=>l.startBeat<n.startBeat+n.durationBeats&&l.startBeat+l.durationBeats>n.startBeat&&Math.abs(l.pitch-n.pitch)<=5)).length
  const managedIds=new Set(['syn-dark-pad','syn-pad-air','syn-pad-motion','syn-chord-wide','syn-stabs','syn-pulse','syn-arp-low','syn-arp-high','syn-sub-bass','syn-bass-mid','gtr-arpeggio','gtr-strum','gtr-riff'])
  const managed=new Set(Object.entries(ARRANGEMENT_TRACK_NAMES).filter(([id])=>id.startsWith('str-')||managedIds.has(id)).map(([,name])=>name))
  const total=Math.max(...p.sections.map(s=>s.startBar+s.lengthBars-1))
  const presence=midi.tracks.filter(t=>t.name.startsWith('STR_')||managed.has(t.name)).map(t=>{
   const on=Array.from({length:total},(_,b)=>t.notes.some(n=>n.startTick/midi.ppq<(b+1)*4&&(n.startTick+n.durationTicks)/midi.ppq>b*4+.01))
   for(let i=1;i<on.length-1;i++)if(on[i-1]&&!on[i]&&on[i+1])on[i]=true
   return on
  })
  let boundaryMax=0
  p.sections.forEach((s,i)=>{if(i===0||s.role==='outro'||s.lengthBars<8||p.sections[i-1].lengthBars<8)return;for(let d=-2;d<=4;d++){const b=s.startBar-1+d;boundaryMax=Math.max(boundaryMax,presence.filter(on=>on[b-1]!==on[b]).length)}})
  const allocated=withGmSounds(arrangementSoundedTracks(a),DEFAULT_PART_PROGRAMS)
  const events=allocated.flatMap(t=>t.notes.flatMap(n=>{const c=t.channel??n.channel;return c===9?[]:[[n.start,1,c],[n.start+n.duration,-1,c]]})).sort((a,b)=>a[0]-b[0]||a[1]-b[1])
  const active=new Map<number,number>();let peakChannels=0
  for(const [,delta,c]of events){const v=(active.get(c)??0)+delta;if(v===0)active.delete(c);else active.set(c,v);peakChannels=Math.max(peakChannels,active.size)}
  const reopened=normalizeProject(JSON.parse(JSON.stringify({...p,fullSongArrangement:a})))
  const savedMidiEqual=hash([...exportArrangementMidi(reopened,reopened.fullSongArrangement!,DEFAULT_PART_PROGRAMS)])===hash([...bytes])
  const changed=regenerateFullSongArrangementTarget(p,a,{trackId:'gtr-riff'})
  const regeneratedBars=new Set(changed.tracks.find(t=>t.id==='gtr-riff')?.notes.map(n=>Math.floor(n.startBeat/4)))
  rows.push({which,genre,seed,bars,riffNotes:riff.length,legacy:a.tracks.filter(t=>t.id==='gtr-strum'||t.id==='gtr-arpeggio').map(t=>({id:t.id,notes:t.notes.length})),quality:a.quality,audition:a.audition,peakChannels,bassClashes,leadClashes,rootOff,fifthClashes,powerRangeOff,range,boundaryMax,savedMidiEqual,regenerated:{barsBefore:new Set(rawRiff.map(n=>Math.floor(n.startBeat/4))).size,barsAfter:regeneratedBars.size,changed:hash(rawRiff)!==hash(changed.tracks.find(t=>t.id==='gtr-riff')?.notes??[]),othersEqual:hash(a.tracks.filter(t=>t.id!=='gtr-riff'))===hash(changed.tracks.filter(t=>t.id!=='gtr-riff'))},allHash:hash(a.tracks.map(t=>[t.id,t.notes.map(n=>[n.pitch,n.startBeat,n.durationBeats,n.velocity,n.sectionId])])),otherHash:hash(a.tracks.filter(t=>!t.id.startsWith('gtr-')).map(t=>[t.id,t.notes.map(n=>[n.pitch,n.startBeat,n.durationBeats,n.velocity,n.sectionId])]))})
 }
 writeFileSync(`/private/tmp/pr209-measure-${process.env.MEASURE_TAG}.json`,JSON.stringify(rows,null,2))
},180000)
