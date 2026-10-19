import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),origin=process.env.WORKSPACE_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:850},reducedMotion:'reduce'});
 await page.goto(origin+'/tests/async-workspace-preview.html');
 await page.getByRole('button',{name:'Open workspace',exact:true}).click();await page.getByRole('status').waitFor();
 await page.evaluate(()=>window.finishWorkspace());await page.getByRole('heading',{name:'Loaded workspace',exact:true}).waitFor();
 await page.getByRole('button',{name:'Open workspace',exact:true}).click();await page.getByRole('status').waitFor();
 await page.evaluate(()=>window.failWorkspace());await page.getByRole('alert').getByRole('heading',{name:'Worker workspace couldn’t load',exact:true}).waitFor();
 await page.getByRole('button',{name:'Reload app',exact:true}).waitFor();
 await page.addScriptTag({path:resolve(web,'node_modules/axe-core/axe.min.js')});
 for(const width of [320,390,768])for(const theme of ['light','dark'])for(const scale of [100,200]){await page.setViewportSize({width,height:900});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=scale+'%';},{theme,scale});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);const result=await page.evaluate(()=>window.axe.run('.async-workspace-state',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(result.violations.map(item=>item.id),[]);}
 await page.getByRole('button',{name:'Customer app',exact:true}).click();assert.equal(await page.getByRole('alert').count(),0);
 await page.getByRole('button',{name:'Open registration',exact:true}).click();await page.getByRole('dialog',{name:'Partner registration',exact:true}).getByRole('status').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert(await page.getByRole('button',{name:'Open registration',exact:true}).evaluate(node=>node===document.activeElement));
 await page.evaluate(()=>window.finishWorkspace());assert.equal(await page.getByRole('heading',{name:'Loaded workspace',exact:true}).count(),0,'Late download reopened a dismissed window');
 await page.getByRole('button',{name:'Open registration',exact:true}).click();await page.getByRole('dialog').getByRole('status').waitFor();await page.evaluate(()=>window.failWorkspace());await page.getByRole('dialog').getByRole('alert').waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
 console.log('PASS: slow/successful/failed workspace loads, recovery/back actions, pending registration Escape/focus, late dismissal, 320–768px/200%/light-dark AA.');
}finally{await browser.close();}
