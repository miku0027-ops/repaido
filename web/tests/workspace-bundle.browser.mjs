// Verify actual production chunks and guest workspace entry points against a local API.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),backend=resolve(web,'../backend'),work=await mkdtemp(resolve(tmpdir(),'repaido-workspace-bundle-'));
const api='http://127.0.0.1:8091',origin='http://127.0.0.1:5317';
const server=spawn(resolve(backend,'.venv/bin/python'),['-m','uvicorn','main:app','--host','127.0.0.1','--port','8091'],{cwd:backend,env:{...process.env,NO_GCE_CHECK:'true',REPAIDO_STORAGE:'sqlite',REPAIDO_DB:resolve(work,'test.db')},stdio:['ignore','pipe','pipe']});
const preview=spawn(process.execPath,[resolve(web,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','5317','--strictPort'],{cwd:web,stdio:['ignore','pipe','pipe']});
let log='',browser;for(const child of [server,preview])for(const stream of [child.stdout,child.stderr])stream.on('data',data=>log+=data);
async function ready(url,child){for(let n=0;n<150;n++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(url)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Readiness failed: '+url+' '+log);}
const errors=[],checks=[];
async function tab(failed=false){
 const context=await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(failed&&/\/assets\/LiveWorkerPortal-[\w-]+\.js$/.test(url.pathname))return route.fulfill({status:503,body:'Temporarily unavailable'});if(!url.pathname.startsWith('/api/'))return route.continue();try{const response=await route.fetch({url:api+url.pathname+url.search});await route.fulfill({response});}catch{await route.abort();}});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));return page;
}
try{
 await Promise.all([ready(api+'/health',server),ready(origin,preview)]);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const home=await tab(),assets=[];home.on('request',request=>assets.push(new URL(request.url()).pathname));await home.goto(origin+'/');await home.getByRole('navigation',{name:'Bottom Navigation',exact:true}).waitFor();assert(!assets.some(path=>/\/assets\/(OperationsAdmin|LiveWorkerPortal|PartnerRegistration)-/.test(path)),'Customer entry downloaded a deferred workspace');checks.push('Customer production entry does not download worker, admin or partner-registration chunks');await home.context().close();
 for(const [path,selector] of [['/worker','#worker-signin-form'],['/company-admin','.portal-login-form'],['/shop-admin','.portal-login-form']]){const page=await tab();await page.goto(origin+path);await page.locator(selector).waitFor();assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks.push('Production route loads its real workspace: '+path);await page.context().close();}
 const failure=await tab(true);await failure.goto(origin+'/worker');await failure.getByRole('alert').getByRole('heading',{name:'Worker workspace couldn’t load',exact:true}).waitFor();await failure.getByRole('button',{name:'Customer app',exact:true}).click();await failure.getByRole('navigation',{name:'Bottom Navigation',exact:true}).waitFor();checks.push('A failed real worker chunk shows recovery actions and returns to the customer app');await failure.context().close();
 assert.deepEqual(errors,[]);await writeFile(resolve(work,'report.json'),JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,work}));
}finally{await browser?.close();server.kill('SIGTERM');preview.kill('SIGTERM');await writeFile(resolve(work,'services.log'),log);}
