import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--disable-dev-shm-usage']});
const base='http://127.0.0.1:5186/tests/market-preview.html';
const refurbishment={grade:'B',cosmetic_condition:'Small scratch on casing',tested_functions:'Power, charging and buttons passed bench testing',tested_on:'2026-01-01',repairs:'Charging port replaced',known_defects:'Small scratch only',accessories:'Charger and cable',battery_health_percent:86,warranty_days:90,warranty_terms:'Shop repair warranty for electrical faults',return_days:7,return_terms:'Return to shop for a disclosed fault mismatch'};
const prime={active:true,paid_placement:true,ends_at:Date.now()/1000+86400};
const product=(id,name,condition,price,paid=false)=>({id,name,condition,price_paise:price,shop_id:paid?'prime-shop':'ordinary-shop',sku:id,category:'smartphones',compatibility:'USB C phones',stock:2,reserved:0,low_stock:1,version:1,status:'approved',gst_bps:1800,stock_confirmed_at:Date.now()/1000,refurbishment:condition==='refurbished'?refurbishment:null,prime:paid?prime:{active:false}});
let items=[product('new','New charging cable','new',50000),product('ref','Refurbished tested phone','refurbished',150000),product('prime','Prime refurbished phone','refurbished',199900,true)];
const shops=[{id:'prime-shop',name:'Paid Prime Shop',address:'12 Test Road',city:'Test City',location:{lat:21.4,lng:86.9},prime},{id:'ordinary-shop',name:'Independent Shop',address:'23 Test Road',city:'Test City',location:{lat:21.4,lng:86.9},prime:{active:false}}];
const errors=[],writes=[],orders=[];let fail=false,ready=true,active=false,memberPaid=false;
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
 await page.addInitScript(()=>{window.Razorpay=class {constructor(config){window.checkoutConfig=config;}on(){}open(){}};});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/operations/products/catalog')return fail?route.fulfill({status:503,json:{detail:'Unavailable'}}):route.fulfill({json:{items,shops}});
  if(url.pathname==='/api/operations/shop/inventory')return route.fulfill({json:{items:items.filter(p=>p.shop_id==='ordinary-shop')}});
  if(url.pathname.startsWith('/api/operations/shop/inventory/')){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{...body,id:'saved',stock:body.on_hand,version:1}});}
  if(url.pathname.startsWith('/api/operations/shop/prime')){
   if(url.pathname.endsWith('/order')){orders.push(route.request().postData());return route.fulfill({json:{key_id:'test-key',order_id:'order_test',amount:149900,currency:'INR',shop_id:'ordinary-shop'}});}
   if(url.pathname.endsWith('/check')&&memberPaid)active=true;
   return route.fulfill({json:{shop_id:'ordinary-shop',shop_name:'Independent Shop',amount:149900,active,ends_at:active?prime.ends_at:null,payments_ready:ready,history:[]}});
  }
  if(url.pathname==='/api/catalog')return route.fulfill({json:{services:[],categories:[]}});
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{items:[],listings:[],slides:[]}});
  return route.continue();
 });
 const accessibility=async()=>{await page.addScriptTag({content:await readFile(require.resolve('axe-core/axe.min.js'),'utf8')});const result=await page.evaluate(async()=>await axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(result.violations.map(v=>[v.id,v.nodes.map(n=>n.target)]),[]);};
 const layout=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No horizontal page overflow');
 await mkdir('test-results',{recursive:true});
 for(const width of [320,390,524,1024]){
  await page.setViewportSize({width,height:850});await page.goto(base);await page.getByRole('heading',{name:'New charging cable',exact:true}).waitFor();
  assert.equal(await page.locator('.spare-compact-card').count(),1);assert.equal(await page.getByRole('tab',{name:/Refurbished/}).count(),1);
  assert.equal(await page.locator('.spare-category-rail').getByText('Refurbished',{exact:true}).count(),0);
  await page.getByRole('tab',{name:/Refurbished/}).click();await page.getByRole('heading',{name:'Prime refurbished phone',exact:true}).waitFor();
  assert.equal(await page.locator('.spare-compact-card').count(),2);assert.equal(await page.locator('.spare-compact-card h3').first().textContent(),'Prime refurbished phone');
  assert.equal(await page.locator('.shop-prime-badge').count(),1);await layout();
  await page.getByRole('button',{name:'View details for Refurbished tested phone',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  await dialog.getByText('Charging port replaced',{exact:true}).waitFor();await dialog.getByText('86% (shop measured)',{exact:true}).waitFor();
  assert.equal(await dialog.getByText(/40-Point|Repaido Certified|No Questions Asked/).count(),0);await layout();await page.keyboard.press('Escape');
  if(width===390)await page.evaluate(()=>scrollTo(0,0));
  if(width===390)await page.screenshot({path:'test-results/refurbished-mobile.png',fullPage:true});
  if(width===390)await accessibility();
  console.log('Separate sections, real disclosures, badge and layout:',width);
 }
 await page.locator('#tab-refurbished').focus();await page.keyboard.press('Home');assert.equal(await page.locator('#tab-spares').getAttribute('aria-selected'),'true');
 await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tab-refurbished').getAttribute('aria-selected'),'true');
 const savedItems=items;items=[];await page.reload();await page.getByRole('heading',{name:'No new parts available'}).waitFor();assert.equal(await page.locator('.spare-compact-card').count(),0);
 fail=true;await page.reload();await page.getByRole('button',{name:'Retry products'}).waitFor();assert.equal(await page.locator('.spare-compact-card').count(),0);fail=false;items=savedItems;await page.getByRole('button',{name:'Retry products'}).click();await page.getByRole('heading',{name:'New charging cable',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:850});await page.goto(base+'?mode=inventory');await page.getByRole('button',{name:'Refurbished (1)',exact:true}).click();
 assert.equal(await page.getByRole('heading',{name:'New charging cable',exact:true}).count(),0);
 await page.getByRole('button',{name:'Add refurbished product',exact:true}).click();await page.getByText('Refurbished product disclosures',{exact:true}).waitFor();
 for(const [name,value] of Object.entries({name:'Customer tested phone',sku:'MY-REF',category:'smartphones',compatibility:'USB C compatible',price:'1999',on_hand:'3'}))await page.locator(`[name="${name}"]`).fill(value);
 await page.locator('[name="grade"]').selectOption('B');await page.locator('[name="tested_on"]').fill('2026-01-01');
 for(const [key,value] of Object.entries(refurbishment))if(!['grade','tested_on'].includes(key))await page.locator(`[name="${key}"]`).fill(String(value));
 await layout();await accessibility();await page.screenshot({path:'test-results/refurbished-editor-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Save and confirm physical count'}).click();await page.waitForFunction(()=>!document.querySelector('fieldset.inventory-refurb-fields'));assert.equal(writes.length,1);assert.equal(writes[0].condition,'refurbished');assert.deepEqual(writes[0].refurbishment,refurbishment);assert.equal(writes[0].price_paise,199900);assert(!('shop_id' in writes[0]));
 await page.goto(base+'?mode=prime');await page.getByText('Shop ID: ordinary-shop',{exact:true}).waitFor();const pay=page.getByRole('button',{name:'Pay ₹1,499 for one month',exact:true});assert(await pay.isDisabled());
 await page.getByRole('checkbox').check();await pay.click();await page.waitForFunction(()=>window.checkoutConfig);const checkout=await page.evaluate(()=>({amount:window.checkoutConfig.amount,order:window.checkoutConfig.order_id,description:window.checkoutConfig.description}));assert.equal(checkout.amount,149900);assert(checkout.description.includes('ordinary-shop'));
 assert.equal(await page.getByText('Prime active',{exact:true}).count(),0);memberPaid=true;await page.evaluate(()=>window.checkoutConfig.handler({razorpay_payment_id:'pay_test'}));await page.getByText('Prime active',{exact:true}).waitFor();await layout();
 active=false;ready=false;await page.reload();await page.getByRole('checkbox').check();assert(await page.getByRole('button',{name:'Pay ₹1,499 for one month',exact:true}).isDisabled());
 await page.screenshot({path:'test-results/shop-prime-mobile.png',fullPage:true});
 await page.addScriptTag({content:await readFile(require.resolve('axe-core/axe.min.js'),'utf8')});
 const a11y=await page.evaluate(async()=>await axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));assert.deepEqual(a11y.violations.map(v=>[v.id,v.nodes.map(n=>n.target)]),[]);
 assert.deepEqual(errors,[]);console.log('Empty/error catalog, retry, shop payload, payment gating and accessibility passed.');
}finally{await browser.close();}
