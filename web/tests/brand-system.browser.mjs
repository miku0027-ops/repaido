import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BRAND_PREVIEW_ORIGIN||'http://127.0.0.1:5187';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const work=await mkdtemp(tmpdir()+'/repaido-brand-'),errors=[],failures=[],variants=[];
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const mode of ['cards','account']){
  const page=await browser.newPage({viewport:{width:390,height:850},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/tests/brand-system-preview.html?mode='+mode);await page.evaluate(()=>document.fonts.ready);
  await page.addScriptTag({path:fileURLToPath(new URL('../node_modules/axe-core/axe.min.js',import.meta.url))});
  for(const theme of ['light','dark'])for(const width of [320,465,1280]){
   await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const checked=await page.evaluate(async()=>{
    const fonts=[...document.querySelectorAll('h1,h2,h3,p,button,input,label,small,strong')].filter(el=>el.getClientRects().length).filter(el=>!getComputedStyle(el).fontFamily.includes('Poppins')).map(el=>({tag:el.tagName,class:el.className,font:getComputedStyle(el).fontFamily}));
    const audit=await window.axe.run('main',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}});
    return {fonts,overflow:document.documentElement.scrollWidth>innerWidth+1,violations:audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};
   });variants.push({mode,theme,width});if(checked.fonts.length||checked.overflow||checked.violations.length)failures.push({mode,theme,width,...checked});
   await page.screenshot({path:work+'/'+mode+'-'+theme+'-'+width+'.png',fullPage:true});
  }
  await page.setViewportSize({width:320,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'200% text overflow');
  await page.close();
 }
 await writeFile(work+'/report.json',JSON.stringify({variants,failures,errors},null,2));
 console.log(JSON.stringify({work,variants:variants.length,failures,errors}));assert.deepEqual(failures,[]);assert.deepEqual(errors,[]);
}finally{await browser.close();console.log('Evidence: '+work);}
