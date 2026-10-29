import { chromium } from '/Users/masaru/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { writeFileSync } from 'node:fs'
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:5184/tools/pr218-browser.html')
 const notice=page.getByLabel('ギターリフの配置について');await notice.waitFor()
 const text=await notice.innerText();if(!text.includes('サビ2')||!text.includes('十分に繰り返せる長さ')||/gtr-riff|short-phrase|r5/.test(text))throw Error('Incorrect explanation')
 await page.evaluate(()=>window.showUnknown());if(await notice.count())throw Error('Invented explanation for saved version')
 await page.evaluate(()=>window.showLong());const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);if(!noOverflow)throw Error('Long name overflow')
 await page.evaluate(()=>window.showInstruction());if(!(await notice.innerText()).includes('指定した音作りを優先'))throw Error('Instruction explanation missing')
 if(errors.length)throw Error(errors.join('\n'))
 writeFileSync('/private/tmp/pr218-browser-result.json',JSON.stringify({text,unknownVersionHidden:true,longNamesNoOverflow:noOverflow,instructionExplained:true,errors},null,2))
}finally{await browser.close()}
