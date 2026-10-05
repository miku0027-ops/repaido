import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--disable-dev-shm-usage']});
const base='http://127.0.0.1:5186';
// Test fixtures are supplied only at the network boundary, never in application catalogs.
const listings=[
  {id:'owner-phone',name:'Owner phone listing',product_type:'phone',value_paise:125000,condition:'Used',city:'Test city'},
  {id:'owner-computer',name:'Owner laptop listing',product_type:'computer',value_paise:450000,condition:'Used',city:'Test city'}
];
const products=[
  {id:'shop-phone',name:'Shop refurbished phone',category:'phone',condition:'refurbished',price_paise:199000,stock:2,shop_id:'actual-shop',warranty:'Shop warranty'},
  {id:'shop-computer',name:'Shop refurbished laptop',category:'computer',condition:'refurbished',price_paise:750000,stock:1,shop_id:'actual-shop'},
  {id:'shop-new',name:'New item must be excluded',category:'phone',condition:'new',price_paise:99000,stock:2,shop_id:'actual-shop'},
  {id:'shop-out',name:'Out of stock must be excluded',category:'phone',condition:'refurbished',price_paise:99000,stock:0,shop_id:'actual-shop'}
];
const professionals=[
  {id:'worker-electrical',name:'Electrical professional',categories:['electrician'],home_services:['maid'],skills:['Wiring'],bio:'Electrical work',rating:4.5,review_count:2,completed_tasks:3},
  {id:'worker-cleaning',name:'Cleaning professional',categories:['cleaning'],bio:'Home cleaning',rating:null,review_count:0,completed_tasks:0}
];
const hireCategories=[{id:'electrician',name:'Electrical installation and maintenance'},{id:'cleaning',name:'Home maid and detailed cleaning services'},{id:'carpenter',name:'Carpentry'},{id:'home:maid',name:'Maid & daily home help'}];
const services=[{id:'electrical-live',name:'Live electrical inspection',category:'electrician',description:'Listed inspection scope',price_paise:19900,duration_minutes:45,included:[],excluded:[]},{id:'cleaning-live',name:'Live home cleaning',category:'cleaning',description:'Listed cleaning scope',price_paise:49900,duration_minutes:60,included:[],excluded:[]}];
let failProducts=false;
const errors=[];
try{
  const page=await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1')return route.abort();
    let data;
    if(url.pathname==='/api/operations/market/search')data={items:listings};
    if(url.pathname==='/api/operations/products/catalog'){
      if(failProducts)return route.fulfill({status:503,json:{detail:'Unavailable'}});
      data={items:products,shops:[{id:'actual-shop',name:'Actual shop listing'}]};
    }
    if(url.pathname==='/api/operations/hiring/leaderboard'){
      const body=route.request().postDataJSON();
      assert.equal(body.city,'Test city');
      data={professionals:professionals.filter(p=>!body.category||p.categories.includes(body.category)||(p.home_services||[]).includes(body.category.replace('home:',''))),categories:hireCategories};
    }
    if(url.pathname==='/api/catalog')data={categories:[{id:'electrician',name:'Electrical'},{id:'cleaning',name:'Cleaning'}],services};
    if(url.pathname==='/api/operations/home/catalog')data={services:[{id:'interior-design',name:'Live interior design',category:'interiors',description:'Listed design scope'},{id:'maid',name:'Live home help',category:'cleaning',description:'Listed help scope',recurring:true,requirements:[{label:'Rooms and surfaces'}],offers:[{id:'published-offer',worker_id:'worker-electrical',worker_name:'Electrical professional',service_id:'maid',bps:1500,ends_at:Date.now()/1000+86400,terms:'Professional-funded saving on the first service period. Tax and extras excluded.'}]}]};
    return data?route.fulfill({json:data}):route.continue();
  });
  const open=async id=>{
    await page.locator(`[data-action="${id}"]`).click();
    await page.locator('dialog[open] section[aria-busy="false"]').waitFor();
  };
  const close=async()=>page.getByRole('button',{name:'Close dialog',exact:true}).click();
  const category=async name=>{
    await page.getByRole('navigation',{name:'Categories',exact:true}).getByRole('button',{name,exact:true}).click();
    await page.locator('dialog section[aria-busy="false"]').waitFor();
  };
  const checkLayout=async()=>{
    const problems=await page.locator('dialog[open]').evaluate(dialog=>{
      const failures=[];
      if(dialog.scrollWidth>dialog.clientWidth+1)failures.push('Dialog has horizontal overflow');
      for(const rail of dialog.querySelectorAll('.quick-filter-pills-row,.quick-budget-chips-row')){
        const buttons=[...rail.querySelectorAll('button')];
        buttons.forEach((button,i)=>{
          const rect=button.getBoundingClientRect();
          if(button.scrollWidth>button.clientWidth+1)failures.push('Clipped category label: '+button.textContent);
          if(i&&buttons[i-1].getBoundingClientRect().right>rect.left-4)failures.push('Overlapping category pills');
          if(rect.height<44)failures.push('Category touch target is too short');
        });
      }
      return failures;
    });
    assert.deepEqual(problems,[]);
  };
  await mkdir('test-results',{recursive:true});
  for(const width of [320,360,390,430]){
    await page.setViewportSize({width,height:844});
    await page.goto(base+'/tests/home-quick-actions-preview.html');
    await open('used');await checkLayout();await category('Laptops & computers');
    await page.getByRole('heading',{name:'Owner laptop listing'}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Owner phone listing'}).count(),0);
    await page.getByRole('button',{name:'View listing',exact:true}).click();
    assert.match(await page.getByLabel('Last action').textContent(),/owner-computer/);
    await open('refurbished');await checkLayout();
    assert.equal(await page.locator('.quick-product-card').count(),2);
    await category('Phones & tablets');
    await page.getByRole('button',{name:'Add to cart',exact:true}).click();
    const cart=await page.evaluate(()=>JSON.parse(localStorage.getItem('repaido.customer.cart')));
    assert.equal(cart[0].shop_id,'actual-shop');assert.equal(cart[0].price_paise,199000);assert.equal(cart[0].stock,2);
    await open('hire');await checkLayout();await category('Home maid and detailed cleaning services');
    await page.getByRole('heading',{name:'Cleaning professional'}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Electrical professional'}).count(),0);
    assert.equal(await page.locator('.quick-pro-rating').count(),0);
    await category('Carpentry');await page.getByText('No current listings match this category.').waitFor();
    await page.getByRole('button',{name:'Clear filters'}).click();
    await page.locator('dialog section[aria-busy="false"]').waitFor();
    await checkLayout();
    if(width===390)await page.screenshot({path:'test-results/quick-actions-phone.png'});
    await close();
    await open('repair');await category('Electrical');
    await page.getByRole('heading',{name:'Live electrical inspection'}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Live home cleaning'}).count(),0);
    await page.getByRole('button',{name:'View service',exact:true}).click();
    assert.equal(await page.getByLabel('Last action').textContent(),'service:electrical-live');
    await open('home');await category('Interiors');
    await page.getByRole('heading',{name:'Live interior design'}).waitFor();
    await page.getByRole('button',{name:'View scope & quote',exact:true}).click();
    assert.equal(await page.getByLabel('Last action').textContent(),'home:interior-design');
    console.log('Phone layout and live category filtering passed:',width);
  }
  await page.goto(base+'/tests/home-quick-actions-preview.html?noLocation=1');
  await open('used');await page.getByRole('button',{name:'Choose location'}).click();
  assert.equal(await page.getByLabel('Last action').textContent(),'choose-location');
  failProducts=true;await open('refurbished');await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('.quick-product-card').count(),0);
  failProducts=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByRole('heading',{name:'Shop refurbished phone'}).waitFor();
  await page.addStyleTag({content:'html { font-size: 24px; }'});await checkLayout();
  await close();await page.goto(base+'/tests/home-quick-actions-preview.html');
  await open('hire');await category('Maid & daily home help');
  await page.getByRole('heading',{name:'Electrical professional',exact:true}).waitFor();
  assert.equal(await page.locator('.quick-product-card').count(),1,'Home skills must not be dropped by a second trade-only filter');
  await category('All categories');
  await page.getByRole('searchbox').fill('Electrical professional');
  assert.equal(await page.locator('.quick-product-card').count(),1);
  const cityRequest=page.waitForRequest(r=>r.url().includes('/hiring/leaderboard')&&r.postDataJSON().location===null);
  await page.getByRole('button',{name:'Across Test city',exact:true}).click();await cityRequest;
  await page.locator('dialog[open] section[aria-busy="false"]').waitFor();
  await page.getByRole('searchbox').fill('');await close();
  await open('home');await category('Home Cleaning');
  await page.getByRole('button',{name:'Request with Electrical professional'}).click();
  assert.deepEqual(JSON.parse(await page.getByLabel('Last action').textContent()),{service:'maid',professional:{id:'worker-electrical',name:'Electrical professional'}});
  await open('home');await category('Home Cleaning');
  await page.locator('.quick-scope summary').click();await page.locator('.quick-offer summary').click();
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.quick-product-card').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
    const result=await page.evaluate(async()=>window.axe.run(document.querySelector('dialog[open]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']}}));
    assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],theme+' dialog accessibility');
  }
  await close();
  for(const panel of ['hire','repair','refurbished','used']){
    await open(panel);
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
      const result=await page.evaluate(async()=>window.axe.run(document.querySelector('dialog[open]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag2aaa']}}));
      assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],panel+' '+theme+' accessibility');
    }
    await close();
  }
  await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
  await open('home');await category('Home Cleaning');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/home-premium-redesign.png'});
  assert.deepEqual(errors,[]);
  console.log('Location gate, fetch failure/retry, enlarged text and zero runtime errors passed');
}finally{await browser.close();}
