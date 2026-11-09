import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:5190';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const work=await mkdtemp('/tmp/repaido-ui-consistency-'),checks=[],errors=[];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:390,height:900},reducedMotion:'no-preference'});page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/tests/ui-consistency-preview.html');await page.getByRole('heading',{name:'Shared controls'}).waitFor();await page.evaluate(()=>document.fonts.ready);
 const actions=page.getByRole('region',{name:'Primary actions'}).getByRole('button');
 for(const state of ['normal','hover','focus']){
  const styles=[];
  for(const action of await actions.all()){
   if(state==='hover')await action.hover();if(state==='focus')await action.focus();
   styles.push(await action.evaluate(node=>{const style=getComputedStyle(node);return Object.fromEntries(['padding','borderRadius','fontSize','fontWeight','backgroundColor','color','transitionProperty','boxShadow','outlineWidth'].map(key=>[key,style[key]]));}));
   await page.mouse.move(0,0);await action.evaluate(node=>node.blur());
  }
  assert(styles.every(style=>JSON.stringify(style)===JSON.stringify(styles[0])),state+' is consistent across roles');
 }
 checks.push('Customer, agent, contractor and community buttons share normal, hover and focus styles');
 const name=page.getByLabel('Name',{exact:true}),city=page.getByLabel('City',{exact:true});
 const fields=await Promise.all([name,city].map(field=>field.evaluate(node=>{const s=getComputedStyle(node);return [s.padding,s.borderRadius,s.fontSize,s.minHeight];})));
 assert.deepEqual(fields[0],fields[1]);assert.equal(await page.getByLabel('Phone number',{exact:true}).getAttribute('aria-describedby'),'phone-note phone-error');
 await page.getByRole('button',{name:'Save details',exact:true}).click();assert.equal(await name.evaluate(node=>node.validity.valueMissing),true);
 await name.fill('Test customer');await city.selectOption('Balasore');await page.getByRole('button',{name:'Save details',exact:true}).click();await page.getByRole('button',{name:'Saving…',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Saving…',exact:true}).isDisabled());await page.getByText('Changes saved.',{exact:true}).waitFor();
 checks.push('Shared fields retain labels, errors, native validation and single-submit loading feedback');
 const opener=page.getByRole('button',{name:'Open dialog',exact:true});await opener.click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert(await opener.evaluate(node=>node===document.activeElement));checks.push('Dialogs close with Escape and restore focus');
 assert.deepEqual(await page.locator('.service-category-card').first().evaluate(node=>{const style=getComputedStyle(node);return [style.padding,style.borderRadius,style.borderTopWidth];}),['16px','12px','1px']);
 const initial=await page.locator('.service-category-grid').innerText(),serviceSummary=await page.locator('.service-preview-accordion>summary').innerText();await page.waitForTimeout(7100);assert.equal(await page.locator('.service-preview-accordion>summary').innerText(),serviceSummary);assert.equal(await page.locator('.service-category-grid').innerText(),initial);await page.getByRole('heading',{name:'Home cleaning',exact:true}).waitFor();
 await page.getByRole('button',{name:'Slide 2: Appliance repairs'}).click();await page.getByRole('heading',{name:'Appliance repairs',exact:true}).waitFor();assert.equal(await page.locator('video[autoplay]').count(),0);assert.equal(await page.locator('.interaction-motion svg').count(),2);
 assert.deepEqual(await page.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==='running').map(animation=>animation.animationName)),[]);checks.push('No automatic category changes, carousel rotation or decorative animation');
 await page.addScriptTag({path:require.resolve('axe-core')});
 for(const theme of ['light','dark'])for(const width of [320,768,1440])for(const text of [100,200]){
  await page.setViewportSize({width,height:900});await page.evaluate(({theme,text})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=text+'%';},{theme,text});await page.waitForTimeout(160);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${theme}/${width}/${text} overflow`);
  assert.equal(await page.locator('.home-entry').evaluate(node=>getComputedStyle(node).backgroundImage),'none','Home plan entry uses a theme-aware surface');
  const violations=await page.evaluate(async()=>(await window.axe.run('main',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);
  await page.screenshot({path:`${work}/${theme}-${width}-${text}.png`,fullPage:true});
 }
 checks.push('12 phone/tablet/desktop, light/dark and enlarged-text variants pass overflow and WCAG AA checks');
 await page.getByRole('button',{name:'Show loading'}).click();await page.locator('.app-feedback-spinner').waitFor();assert.equal(await page.locator('.app-feedback-spinner').evaluate(node=>getComputedStyle(node).animationName),'ui-pending');await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.app-feedback-spinner').evaluate(node=>getComputedStyle(node).animationName),'none');
 checks.push('Only pending-state motion runs; reduced motion disables it');assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,work}));
} finally {await writeFile(work+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();console.log(work);}
