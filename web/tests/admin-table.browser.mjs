import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];try {
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5187/tests/admin-table-preview.html');
 const rows=page.locator('tbody tr:not(.crm-detail-row)'),search=page.getByRole('searchbox',{name:'Search fixture records'});
 await page.getByText('1–10 of 31 loaded records',{exact:true}).waitFor();assert.equal(await rows.count(),10);
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('11–20 of 31 loaded records',{exact:true}).waitFor();
 await search.fill('Record 31');await page.getByText('1–1 of 1 matching records · 31 before search',{exact:true}).waitFor();assert.equal(await rows.count(),1);
 await search.fill('nothing matches');await page.getByText('No matches. Try another search.',{exact:true}).waitFor();assert.equal(await rows.count(),0);
 await search.fill('');await page.getByRole('button',{name:'Amount',exact:true}).click();assert.match(await rows.first().innerText(),/Record 31/);assert.equal(await page.getByRole('columnheader',{name:'Amount'}).getAttribute('aria-sort'),'ascending');
 await page.getByRole('button',{name:'Amount',exact:true}).click();assert.match(await rows.first().innerText(),/Record 01/);
 await page.getByRole('combobox',{name:'Rows per page for Fixture records',exact:true}).selectOption('25');assert.equal(await rows.count(),25);await page.getByRole('button',{name:'Next',exact:true}).click();assert.equal(await rows.count(),6);
 await page.getByRole('button',{name:'Change source size',exact:true}).click();assert.equal(await rows.count(),1);await page.getByText('1–1 of 1 loaded records',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Decision note').count(),0);await page.getByRole('button',{name:'Open Record 01',exact:true}).click();await page.getByLabel('Decision note').fill('A review draft remains editable.');
 assert.equal(await page.getByRole('button',{name:'Close Record 01',exact:true}).getAttribute('aria-expanded'),'true');
 await page.addScriptTag({path:resolve('web/node_modules/axe-core/axe.min.js')});
 for(const width of [320,390,800,1440]) for(const theme of ['light','dark']) for(const size of ['100%','200%']) {
  await page.setViewportSize({width,height:900});await page.evaluate(({theme,size})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=size;},{theme,size});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow ${width}/${theme}/${size}`);
  const issues=await page.evaluate(async()=>(await window.axe.run('main',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']},rules:{'color-contrast-enhanced':{enabled:true}}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));assert.deepEqual(issues,[],`${width}/${theme}/${size}`);
 }
 await page.getByRole('button',{name:'Close Record 01',exact:true}).click();assert.equal(await page.getByLabel('Decision note').count(),0);
 await page.getByRole('region',{name:'Fixture records table, scroll for all columns'}).focus();assert(await page.getByRole('region',{name:'Fixture records table, scroll for all columns'}).evaluate(el=>el===document.activeElement));
 assert.deepEqual(errors,[]);console.log('PASS: search, numeric sorting, pagination, page clamping, deliberate detail mount, keyboard region and 16 responsive/AAA variants.');
}finally{await browser.close();}
