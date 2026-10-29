import React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { GuitarRiffDecisionNotice } from '../src/app/GuitarRiffDecisionNotice'
import { generateFullSongArrangement, addGuitarRiffLayer } from '../src/melody-engine/arrangementGenerator'
import { arrangementSoundInstructionFromText } from '../src/core/arrangementIntent'
import { normalizeProject } from '../src/core/project'
import { arrangementReviewSong } from '../src/store/arrangementReviewFixtures'
import '../src/index.css'
let p=arrangementReviewSong('A');p.song.genreBlend=[{id:'neoclassical',weight:1}]
let json=JSON.stringify(p);p.sections.forEach((s,i)=>json=json.split(s.id).join(`r${i}`));p=normalizeProject(JSON.parse(json))
const a=generateFullSongArrangement(p,{seed:19}),root=createRoot(document.getElementById('root')!)
const render=(project=p,arrangement=a)=>flushSync(()=>root.render(<div className="w-full min-w-0 p-3"><GuitarRiffDecisionNotice project={project} arrangement={arrangement}/></div>))
Object.assign(window,{showKnown:()=>render(),showUnknown:()=>render(p,JSON.parse(JSON.stringify(a))),showLong:()=>render({...p,sections:p.sections.map(s=>s.id==='r5'?{...s,name:'LongSectionName'.repeat(18)}:s)}),showInstruction:()=>{const legacy={...a,tracks:a.tracks.filter(t=>t.id!=='gtr-riff'),plan:{...a.plan,directive:{intention:'指定',soundInstruction:arrangementSoundInstructionFromText('ギターのリフ')!}}};render(p,addGuitarRiffLayer(p,legacy))}})
render()
