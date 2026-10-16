import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright');
const evidence=process.env.LISTING_LAYOUT_EVIDENCE||'/tmp/repaido-listing-layout';await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const base=process.env.LISTING_LAYOUT_PREVIEW||'http://127.0.0.1:5187/tests/market-listing-layout-preview.html',checks=[],errors=[];
try{
 const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(u.pathname.endsWith('/market/eligibility'))return route.fulfill({json:{second_hand:true,exchange:true}});return route.continue();});
 for(const [width,theme,scale] of [[320,'light',1],[467,'light',1],[1440,'light',1],[320,'light',2],[320,'dark',2],[467,'dark',1],[1440,'dark',2]]){
  await page.setViewportSize({width,height:900});
  for(const mode of ['second_hand','exchange'])for(const step of [0,1,2,3]){
   await page.goto(`${base}?step=${step}&mode=${mode}`);await page.locator('.listing-editor').waitFor();
   await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=16*scale+'px';},{theme,scale});
   await page.locator('.listing-eligibility').count().then(async count=>{if(count)await page.getByText(/Eligible for|First eligible exchange:/).waitFor();});
   const layout=await page.locator('.listing-editor').evaluate(dialog=>{const box=dialog.getBoundingClientRect(),body=dialog.querySelector('.listing-scroll'),footer=dialog.querySelector('.listing-footer').getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,scrollWidth:body.scrollWidth,clientWidth:body.clientWidth,footerBottom:footer.bottom,width:innerWidth,height:innerHeight,buttons:[...dialog.querySelectorAll('button')].filter(button=>button.getClientRects().length&&!button.disabled).map(button=>({label:button.textContent?.trim()||button.ariaLabel,width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height}))};});
   assert(layout.left>=-1&&layout.right<=width+1,JSON.stringify({width,theme,scale,step,mode,layout}));assert(layout.top>=-1&&layout.bottom<=901);assert(layout.scrollWidth<=layout.clientWidth+1,`No content overflow: ${JSON.stringify({width,theme,scale,step,mode,layout})}`);assert(layout.footerBottom<=901,'Footer stays in view');
   for(const button of layout.buttons){assert(button.width>=43.5&&button.height>=43.5,`44px control: ${JSON.stringify({width,theme,scale,step,button})}`);}
   await page.addScriptTag({path:new URL('../node_modules/axe-core/axe.min.js',import.meta.url).pathname});
   const violations=await page.evaluate(async()=>{const result=await window.axe.run('.listing-editor',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}});return result.violations.map(issue=>({id:issue.id,nodes:issue.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}));});
   assert.deepEqual(violations,[],JSON.stringify({width,theme,scale,step,mode,violations}));
   if(mode==='second_hand'&&((width===467&&scale===1)||(width===320&&scale===2)))await page.screenshot({path:`${evidence}/${mode}-${width}-${theme}-${scale}-step-${step}.png`});
   checks.push({width,theme,scale,step,mode});
  }
 }
 assert.deepEqual(errors,[]);await writeFile(evidence+'/report.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,cases:checks.length,evidence}));
}finally{await browser.close();}
