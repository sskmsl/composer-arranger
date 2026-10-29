import React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { SongMidiExportButton } from '../src/app/SongMidiExportButton'
import { createEmptyProject } from '../src/core/project'
import { ARRANGEMENT_TRACK_NAMES, type ArrangementTrackId } from '../src/core/arrangementGeneration'
import { generateFullSongArrangement } from '../src/melody-engine/arrangementGenerator'
import { updateSoundSettings } from '../src/audio/soundSettings'
import '../src/index.css'
const p=createEmptyProject('Export notification');p.sections=[{id:'s',name:'サビ',role:'chorus',startBar:1,lengthBars:8}]
const a=generateFullSongArrangement(p,{seed:19})
const overloaded={...p,fullSongArrangement:{...a,tracks:(Object.keys(ARRANGEMENT_TRACK_NAMES) as ArrangementTrackId[]).filter(id=>id.startsWith('syn-')||id.startsWith('str-')).slice(0,16).map((id,i)=>({...a.tracks[0],id,name:ARRANGEMENT_TRACK_NAMES[id],family:'synth' as const,muted:false,instrument:{program:i,reason:'fixture'},notes:[{id:`n${i}`,sectionId:'s',startBeat:0,durationBeats:4,pitch:60,velocity:80,locks:[],character:'safe' as const,reason:'fixture'}]}))}}
const root=createRoot(document.getElementById('root')!)
const render=(project=overloaded)=>flushSync(()=>root.render(<div className="flex flex-wrap gap-2 p-3"><SongMidiExportButton project={project}/></div>))
Object.assign(window,{overloaded,render,setMode:(m:'gm'|'logic')=>updateSoundSettings({midiExport:m})})
updateSoundSettings({midiExport:'gm'});render()
