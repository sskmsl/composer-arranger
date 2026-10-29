const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
import { writeFileSync } from 'node:fs'
const browser=await chromium.launch({...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {channel:'chrome'}),headless:true})
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const downloads=[],errors=[]
 await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}))
 page.on('download',d=>downloads.push(d.suggestedFilename()));page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5183'}/tools/pr203-browser.html`);const button=page.getByRole('button',{name:'曲全体MIDI'})
 await button.click();await page.getByRole('alert').waitFor()
 const message=await page.getByRole('alert').textContent();if(!message.includes('楽器を揃える')||downloads.length)throw Error('Missing error or unexpected download')
 if(await button.getAttribute('aria-describedby')!=='song-midi-export-error')throw Error('Missing accessible description')
 const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);if(!noOverflow)throw Error('Horizontal overflow')
 await page.evaluate(()=>window.render({...window.overloaded,fullSongArrangement:{...window.overloaded.fullSongArrangement,tracks:window.overloaded.fullSongArrangement.tracks.slice(0,15)}}))
 const retry=page.waitForEvent('download',{timeout:5000});await button.click();await retry
 if(await page.getByRole('alert').count())throw Error('Error did not clear after success')
 await page.evaluate(()=>window.render(window.overloaded));await button.click();await page.getByRole('alert').waitFor()
 await page.evaluate(()=>window.render({...window.overloaded,projectId:'different-project'}));await page.waitForTimeout(100)
 if(await page.getByRole('alert').count())throw Error('Stale error on different project')
 await page.evaluate(()=>{window.setMode('logic');window.render(window.overloaded)})
 const download=page.waitForEvent('download');await button.click();await download
 if(await page.getByRole('alert').count())throw Error('Logic export rejected')
 await page.evaluate(()=>window.render({...window.overloaded,song:undefined}))
 await button.click();await page.waitForTimeout(150)
 if(errors.length!==1||await page.getByRole('alert').count())throw Error('Unexpected error was swallowed/mislabeled')
 writeFileSync('/private/tmp/pr203-browser-result.json',JSON.stringify({capacityMessage:message,browserFallbackDownload:true,capacityDownloadSuppressed:true,retryClearsAlert:true,newProjectHidesAlert:true,logicExportWorks:true,unexpectedErrorPropagates:errors[0],noOverflow,downloads},null,2))
}finally{await browser.close()}
