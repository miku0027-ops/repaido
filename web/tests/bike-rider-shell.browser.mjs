import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';import {mkdtemp} from 'node:fs/promises';const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=await mkdtemp('/tmp/repaido-rider-shell-'),port=8076,base=process.env.REPAIDO_QA_URL||'http://127.0.0.1:5187';let phase='in_progress';const writes=[];
const server=spawn(web+'/../backend/.venv/bin/python',[web+'/tests/business_suites_api.py',work+'/fixture.db',String(port)],{cwd:web+'/../backend',stdio:['ignore','pipe','pipe']});let log='',browser,page;for(const stream of [server.stdout,server.stderr])stream.on('data',d=>log+=d);
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error(log);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
 await context.route('**/@vite/client',async route=>{const response=await route.fetch();const body=(await response.text()).replace(/new WebSocket\(/g,'new PreviewSocket(');await route.fulfill({response,body:'class PreviewSocket { addEventListener(){} removeEventListener(){} send(){} close(){} }\n'+body});});
 await context.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());const now=Date.now()/1000;if(!['GET','HEAD'].includes(req.method()))writes.push(url.pathname);
  if(url.pathname.includes('/bike-rides/driver/availability'))return route.fulfill({json:{rider_approved:true,vehicles:[{id:'qa-bike',name:'QA · Honda Activa',active:true,status:'approved',vehicle_kind:'bike'}],availability:{vehicle_id:'qa-bike',online:true,updated_at:now,position:{lat:21.49,lng:86.91,accuracy:8,captured_at:now,received_at:now}},server_time:now,dispatch_ready:true,service_ready:true}});
  if(url.pathname.includes('/bike-rides/driver/rides'))return route.fulfill({json:{rides:[{id:'qa-current',state:phase,version:5,vehicle_name:'QA · Honda Activa',passenger_name:'Sample passenger',passenger_phone:'+919999999999',pickup:{lat:21.49,lng:86.91},dropoff:{lat:21.5,lng:86.92},pickup_address:'College Road, Balasore',dropoff_address:'Hospital Road, Balasore',pricing:{free:true,customer_total_paise:0},created_at:now-600,allowed_actions:phase==='in_progress'?['complete','dispute']:['start','cancel'],stop_status:{pickup:{status:'inside',distance_metres:40,valid_until:now+75},destination:{status:'inside',distance_metres:90,valid_until:now+75}}}],server_time:now,next_cursor:null}});
  if(url.pathname.includes('/bike-rides/driver/payroll'))return route.fulfill({json:{driver_id:'worker',period:'2026-10',compensation_model:'monthly_salary',monthly_salary_paise:700000,rostered:true,approved:true,obligations:[],server_time:now}});
  try{const response=await route.fetch({url:`http://127.0.0.1:${port}`+url.pathname+url.search});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}
 });
 page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const visibleAction=async name=>{
  const button=page.getByRole('region',{name:'Current bike ride',exact:true}).getByRole('button',{name,exact:true});await button.waitFor();
  await page.waitForFunction(()=>{const action=document.querySelector('.bike-rider-trip-actions>.bike-rider-primary'),nav=document.querySelector('.suite-navigation');if(!action||!nav)return false;const a=action.getBoundingClientRect(),n=nav.getBoundingClientRect();return a.top>=0&&a.bottom<n.top;});
  assert.equal(await button.evaluate(element=>{const b=element.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===element;}),true,'current action is immediately reachable above the fixed navigation');
  return button;
 };
 for(const width of [320,390,485]){
  await page.setViewportSize({width,height:850});
  await page.goto(base+'/tests/business-suites-preview.html?mode=cab_owner&uid=worker&portal=1&tab=bikes',{waitUntil:'networkidle'});
  await visibleAction('Finish ride');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`shell overflow at ${width}`);
  assert.equal(await page.getByRole('link',{name:'Navigate to drop-off',exact:true}).getAttribute('href'),'https://www.google.com/maps/dir/?api=1&destination=21.5,86.92&travelmode=driving');
  await page.screenshot({path:work+`/rider-shell-${width}.png`,fullPage:true});
  if(width===390){
   await page.addScriptTag({path:web+'/node_modules/axe-core/axe.min.js'});
   const violations=await page.evaluate(async()=>(await window.axe.run('.bike-rider-workspace',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})));assert.deepEqual(violations,[],'rider workspace inside the actual business portal passes WCAG A/AA');
   await page.evaluate(()=>window.scrollBy(0,100));const before=await page.evaluate(()=>scrollY);
   await page.evaluate(()=>document.querySelector('.bike-rider-trip').style.paddingBottom='36px');await page.waitForTimeout(200);
   assert.equal(await page.evaluate(()=>scrollY),before,'later layout updates never pull the rider back to the panel header');
  }
 }
 phase='arrived';await page.goto(base+'/tests/business-suites-preview.html?mode=cab_owner&uid=worker&portal=1',{waitUntil:'networkidle'});await page.getByRole('navigation',{name:'Cab owner suite navigation',exact:true}).getByRole('button',{name:'Bookings',exact:true}).click();await page.getByRole('navigation',{name:'Booking types',exact:true}).getByRole('button',{name:'Bike rides',exact:true}).click();await (await visibleAction('Verify OTP & start')).click();await page.getByRole('dialog',{name:'Verify OTP & start',exact:true}).getByLabel('Passenger OTP').waitFor();
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:320,height:850});await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.style.fontSize='200%';});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'worker shell supports dark 200% text');
 assert.deepEqual(writes,[],'the shell regression never submits a real or disposable ride change');assert.deepEqual(errors,[]);
 console.log('PASS: actual worker portal bike entry and deep links, current actions above navigation at320/390/485, no repeated scroll, OTP dialog, dark200% and WCAG A/AA. Evidence: '+work);

}catch(error){await page?.screenshot({path:work+'/rider-shell-failure.png',fullPage:true}).catch(()=>{});console.error('Evidence: '+work);throw error;}finally{await browser?.close();server.kill('SIGTERM');}
