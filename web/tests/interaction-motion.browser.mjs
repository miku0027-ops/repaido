import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5187/tests/interaction-motion-preview.html');
 await page.waitForFunction(()=>document.querySelectorAll('[data-ready=true]').length===3);
 assert.equal(await page.locator('.interaction-motion-player svg').count(),3);
 await page.getByRole('button',{name:'Toggle animations'}).click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.interaction-motion')).every(node=>['paused','complete'].includes(node.dataset.motion)));
 await page.getByRole('button',{name:'Toggle animations'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-motion=complete]').length===3);
 // A completed asset holds its final frame; hiding and showing never loops it.
 await page.getByRole('button',{name:'Toggle animations'}).click();await page.getByRole('button',{name:'Toggle animations'}).click();
 assert.equal(await page.locator('[data-motion=complete]').count(),3);
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Replay',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-motion=reduced]').length===3);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>document.documentElement.classList.add('reduce-motion'));
 await page.getByRole('button',{name:'Replay',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-motion=reduced]').length===3);
 assert.equal(await page.getByRole('region',{name:'Action updates'}).isVisible(),false);
 await page.getByRole('button',{name:'Confirm action'}).click();
 await page.getByRole('status').filter({hasText:'Request sent'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.app-feedback-card [data-motion=reduced]'));
 assert.equal(await page.locator('.app-feedback-card').count(),1);
 await page.getByRole('button',{name:'Dismiss notification'}).click();assert.equal(await page.locator('.app-feedback-card').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: real Lottie renders, finite playback, hidden pause, OS/app reduced motion, explicit success feedback, no unsolicited notifications or runtime errors');
}finally{await browser.close();}
