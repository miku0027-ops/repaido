import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/opt/codex/runtimes/cua/lib/node_modules/playwright');
const origin = process.env.RETAIL_TEST_ORIGIN || 'http://127.0.0.1:5192';
const out = '/tmp/repaido-retail-resolution-browser';
await mkdir(out, {recursive: true});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6n7sAAAAASUVORK5CYII=', 'base64');
const authFixture = `const mode=new URLSearchParams(location.search).get('mode');let user={uid:mode==='shop'?'seller':mode==='admin'?'operator':'buyer',getIdToken:async()=>user.uid};const listeners=new Set();export const auth={currentUser:user,authStateReady:async()=>{},onIdTokenChanged(next){const fn=typeof next==='function'?next:next.next.bind(next);listeners.add(fn);queueMicrotask(()=>fn(user));return()=>listeners.delete(fn);}};window.__setRetailActor=uid=>{user=uid?{uid,getIdToken:async()=>uid}:null;auth.currentUser=user;for(const listener of listeners)listener(user);};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
const calls = [], errors = [], checks = [];
let row = null, uploadCount = 0, createCalls = 0, refundCalls = 0, providerSubmissions = 0;
let delayReorder = false, releaseReorder;
const now = () => Date.now() / 1000;
function event(role, action, text, document_ids = []) {row.events.push({id: String(row.events.length + 1), role, action, text, document_ids, at: now()}); row.version++; row.updated_at = now();}
function view(role) {
  if (!row) return null;
  const actions = [];
  if (role !== 'operator') {
    if (!['resolved', 'rejected'].includes(row.state)) actions.push('reply');
    if (role === 'shop' && ['open', 'merchant_replied', 'appealed'].includes(row.state)) actions.push('authorize_return');
    if (role === 'customer' && row.state === 'return_authorized') actions.push('return_sent');
    if (role === 'shop' && ['return_authorized', 'return_sent'].includes(row.state)) actions.push('return_received');
    if (role === 'customer' && ['resolved', 'rejected'].includes(row.state) && !row.appeal_reason && row.refund_status !== 'processed') actions.push('appeal');
  }
  const decisions = role === 'operator' && !['resolved', 'rejected', 'refund_pending'].includes(row.state) ? [...(row.kind !== 'return' || row.return_receipt_at ? ['approve_refund'] : []), 'reject', 'resolve'] : [];
  return {...row, viewer_role: role, allowed_actions: actions, allowed_decisions: decisions, can_refund: role === 'operator' && ['refund_approved', 'refund_pending', 'resolved'].includes(row.state) && !!row.refund_amount_paise && row.refund_status !== 'failed'};
}
let page;
const browser = await chromium.launch({executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
try {
  const context = await browser.newContext({viewport: {width: 467, height: 900}, reducedMotion: 'reduce'});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/src/firebase.ts') return route.fulfill({contentType: 'text/javascript', body: authFixture});
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let payload; try {payload = request.postDataJSON();} catch {}
    const path = url.pathname.replace('/api/operations', ''), method = request.method(), uid = request.headers().authorization?.replace('Bearer ', '');
    const role = uid === 'operator' ? 'operator' : uid === 'seller' ? 'shop' : 'customer';
    calls.push({path, method, payload, uid});
    let result;
    if (path === '/local-business/documents' && method === 'POST') {uploadCount++; result = {id: `evidence-${uploadCount}`};}
    else if (path.endsWith('/evidence/evidence-1') || path.endsWith('/evidence/evidence-2')) return route.fulfill({contentType: 'image/png', body: png});
    else if (path === '/retail/orders' && uid !== 'buyer') result = {orders: []};
    else if (path === '/retail/orders/order-one/reorder') {if (delayReorder) await new Promise(resolve => {releaseReorder = resolve;}); result = {items: [{id: 'product-one', title: 'Refurbished mixer grinder', price_paise: 12345, quantity: 2, shop_id: 'shop-one', shop_name: 'Station Road Appliances', condition: 'refurbished', stock: 7}], unavailable: []};}
    else if (path === '/retail/quote') result = {subtotal_paise: 24690, discount_paise: 0, eligible_base_paise: 24690, total_paise: 24690};
    else if (path === '/retail/orders') result = {orders: [{id: 'order-one', state: 'refunded', received_at: now() - 1000, subtotal_paise: 100000, discount_paise: 0, eligible_base_paise: 100000, total_paise: 100000, delivery_address: '27 Station Road, Balasore', items: [{product_id: 'product-one', name: 'Refurbished mixer grinder', quantity: 2, total_paise: 100000, discount_paise: 0}]}]};
    else if (path === '/retail/orders/order-one/resolutions' && method === 'GET') result = {cases: row && uid === 'buyer' ? [view('customer')] : []};
    else if (path === '/retail/orders/order-one/resolutions' && method === 'POST') {
      createCalls++;
      if (!row) {row = {id: 'case-one', order_id: 'order-one', product_id: payload.product_id, shop_id: 'shop-one', version: 0, state: 'open', kind: payload.kind, quantity: payload.quantity, item: {name: 'Refurbished mixer grinder', quantity: 2, return_policy: {version: 1, return_days: 7, return_terms: 'Return defective goods within seven days after receipt for individual review.', warranty_days: 30, warranty_terms: 'Seller repair warranty for manufacturing defects.', source: 'seller_disclosure_at_checkout'}}, reason: payload.reason, max_refund_paise: 50000, policy_window: {deadline_at: now() + 5 * 86400, status: 'within_window'}, response_target_at: now() + 86400, resolution_target_at: now() + 3 * 86400, target_note: 'Service targets, not guaranteed deadlines.', events: [], created_at: now(), updated_at: now()}; event('customer', 'opened', payload.reason, payload.document_ids);}
      if (createCalls === 1) return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({detail: 'The first response was interrupted.'})});
      result = view('customer');
    }
    else if (path === '/retail/resolutions/shop') result = {cases: row ? [view('shop')] : [], shops: [{id: 'shop-one', name: 'Station Road Appliances'}], selected_shop_id: 'shop-one', next_cursor: null};
    else if (path === '/retail/admin/resolutions') result = {cases: row && row.state === (url.searchParams.get('state') || 'open') ? [view('operator')] : [], next_cursor: null};
    else if (path === '/retail/resolutions/case-one' || path === '/retail/admin/resolutions/case-one') result = view(role);
    else if (path === '/retail/resolutions/case-one/actions') {
      if (payload.action === 'authorize_return') {row.state = 'return_authorized'; row.return_by = payload.return_by;}
      if (payload.action === 'return_sent') row.state = 'return_sent';
      if (payload.action === 'return_received') {row.state = 'return_received'; row.return_receipt_at = now();}
      if (payload.action === 'appeal') {row.state = 'appealed'; row.appeal_reason = payload.note;}
      event(role, payload.action, payload.note, payload.document_ids); result = view(role);
    }
    else if (path === '/retail/admin/resolutions/case-one/decision') {row.state = payload.decision === 'approve_refund' ? 'refund_approved' : payload.decision === 'reject' ? 'rejected' : 'resolved'; row.decision_note = payload.note; if (payload.decision === 'approve_refund') {row.refund_amount_paise = payload.refund_amount_paise; row.refund_status = 'approved';} event('operator', payload.decision, payload.note); result = view('operator');}
    else if (path === '/retail/admin/resolutions/case-one/refund') {
      refundCalls++;
      if (refundCalls === 1) {providerSubmissions++; row.state = 'refund_pending'; row.refund_status = 'submitting'; event('operator', 'refund_submitted', 'Provider confirmation is pending.'); return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({detail: 'The provider outcome is unknown; reconcile this case.'})});}
      if (refundCalls === 2) {row.state = 'refund_pending'; row.refund_status = 'pending';}
      else {row.state = 'resolved'; row.refund_status = 'processed'; event('operator', 'refund_processed', 'The provider confirmed the refund.');}
      result = view('operator');
    }
    else return route.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({detail: `Unexpected browser-test route ${method} ${path}`})});
    return route.fulfill({contentType: 'application/json', body: JSON.stringify(result)});
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const open = async mode => {await page.goto(`${origin}/tests/retail-resolutions-preview.html?mode=${mode}`); await page.getByRole('button', {name: 'Refresh cases', exact: true}).waitFor();};
  await open('customer');
  await page.getByRole('button', {name: 'Raise an item issue', exact: true}).click();
  await page.getByLabel('Quantity affected').fill('1');
  await page.getByLabel('Describe the issue').fill('The mixer motor stops immediately and has a burning smell. Please review a return.');
  await page.getByLabel('Evidence photos (optional)').setInputFiles({name: 'motor-photo.png', mimeType: 'image/png', buffer: png});
  await page.getByRole('button', {name: 'Submit issue for review', exact: true}).click();
  await page.getByRole('button', {name: 'Retry original request', exact: true}).waitFor();
  assert(await page.getByLabel('Describe the issue').isDisabled());
  assert(await page.getByRole('button', {name: 'Refresh cases', exact: true}).isDisabled());
  await page.getByRole('button', {name: 'Retry original request', exact: true}).click();
  await page.getByRole('heading', {name: 'Refurbished mixer grinder', exact: true}).waitFor();
  const opens = calls.filter(call => call.path === '/retail/orders/order-one/resolutions' && call.method === 'POST');
  assert.equal(opens.length, 2); assert.deepEqual(opens[0].payload, opens[1].payload); assert.equal(uploadCount, 1);
  assert(await page.getByRole('button', {name: 'Raise an item issue', exact: true}).isDisabled());
  checks.push('Customer evidence is uploaded once; an uncertain case submission retries the identical request key/body and blocks duplicate item cases');
  await page.getByText('Return defective goods within seven days after receipt for individual review.', {exact: true}).waitFor();
  await page.getByText('Service targets, not guaranteed deadlines.', {exact: true}).waitFor();
  await page.locator('summary').filter({hasText: 'Case history & evidence'}).click();
  await page.getByRole('button', {name: 'Customer evidence photo 1', exact: true}).click();
  const photo = page.getByRole('dialog', {name: 'Customer evidence photo 1'}); await photo.waitFor();
  await photo.getByRole('button', {name: 'Close dialog'}).click();
  checks.push('Saved seller terms, warranty and target caveats are shown; private evidence loads through the authenticated case route');
  for (const width of [320, 467, 1280]) {await page.setViewportSize({width, height: 900}); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({path: `${out}/customer-${width}.png`, fullPage: true});}
  checks.push('Customer case/history layout fits 320px, 467px and desktop widths');
  await open('shop');
  await page.getByRole('button', {name: 'Authorise a return', exact: true}).click();
  await page.getByLabel('Return instructions & conditions').fill('Pack the item securely and return it to the shop counter with the purchase receipt.');
  const deadline = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
  await page.getByLabel('Return deadline (your local time)').fill(deadline);
  await page.getByRole('button', {name: 'Authorise a return', exact: true}).click();
  await page.getByText('Return authorized', {exact: true}).waitFor();
  assert(calls.some(call => call.payload?.action === 'authorize_return' && call.payload.return_by > now() && call.payload.expected_version === 1));
  await open('customer');
  await page.getByRole('button', {name: 'Record return sent', exact: true}).click();
  await page.getByLabel('Return dispatch or handover details').fill('Handed to the seller counter against return slip RET-2026-123.');
  await page.getByRole('button', {name: 'Record return sent', exact: true}).click();
  await page.getByText('Return sent', {exact: true}).waitFor();
  await open('shop');
  await page.getByRole('button', {name: 'Confirm return received', exact: true}).click();
  await page.getByLabel('Received goods & condition').fill('Received one mixer with the reported motor fault and its power cable.');
  const beforeReceipt = calls.filter(call => call.payload?.action === 'return_received').length;
  await page.getByRole('button', {name: 'Confirm return received', exact: true}).click();
  await page.getByText('Add one to three receipt photos before confirming returned goods.', {exact: true}).waitFor();
  assert.equal(calls.filter(call => call.payload?.action === 'return_received').length, beforeReceipt);
  await page.getByLabel('Receipt evidence photos (required)').setInputFiles({name: 'receipt-photo.png', mimeType: 'image/png', buffer: png});
  await page.getByRole('button', {name: 'Confirm return received', exact: true}).click();
  await page.getByText('Return received', {exact: true}).waitFor();
  checks.push('Seller return authorisation records instructions/deadline; customer dispatch and seller receipt require distinct versioned actions and receipt evidence');
  await open('admin');
  await page.getByLabel('Case state').selectOption('return_received');
  await page.getByRole('button', {name: 'Review & decide', exact: true}).click();
  await page.getByLabel('Decision', {exact: true}).selectOption('approve_refund');
  await page.getByLabel('Approved refund amount (₹)', {exact: false}).fill('200.25');
  await page.getByLabel('Review reason').fill('Reviewed receipt evidence and the recorded seller terms; partial refund approved.');
  await page.getByLabel('Evidence or investigation reference').fill('CASE-REVIEW-12345');
  await page.getByRole('button', {name: 'Save review decision', exact: true}).click();
  await page.getByRole('button', {name: 'Submit approved refund', exact: true}).waitFor();
  assert.equal(refundCalls, 0); assert(await page.getByRole('button', {name: 'Submit approved refund', exact: true}).isDisabled());
  assert.equal(await page.getByLabel('Case state').inputValue(), 'refund_approved');
  assert(calls.some(call => call.payload?.decision === 'approve_refund' && call.payload.refund_amount_paise === 20025 && call.payload.evidence_reference === 'CASE-REVIEW-12345'));
  await page.getByLabel('I checked the approved amount and authorise this refund submission.').check();
  await page.getByRole('button', {name: 'Submit approved refund', exact: true}).click();
  await page.getByRole('button', {name: 'Check existing refund with provider', exact: true}).waitFor();
  assert(await page.getByLabel('Case state').isDisabled());
  await page.getByRole('button', {name: 'Check existing refund with provider', exact: true}).click();
  await page.locator('.rr-card .rr-badge').getByText('Refund pending', {exact: true}).waitFor();
  assert.equal(await page.getByRole('heading', {name: 'Refund confirmed by payment provider'}).count(), 0);
  await page.getByRole('button', {name: 'Check existing refund with provider', exact: true}).click();
  await page.getByRole('heading', {name: 'Refund confirmed by payment provider'}).waitFor();
  assert.equal(providerSubmissions, 1); assert.equal(refundCalls, 3);
  checks.push('Operator approval does not send money; explicit confirmation submits once, uncertain retries reconcile, and success appears only after provider processing');
  row.refund_status = 'failed'; row.state = 'refund_approved'; row.item.return_policy = null; row.policy_window = {deadline_at: null, status: 'manual_review'};
  await page.getByLabel('Case state').selectOption('refund_approved');
  await page.getByRole('heading', {name: 'Refund failed · another review is required'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Submit approved refund', exact: true}).count(), 0);
  assert.equal(await page.getByRole('button', {name: 'Check existing refund with provider', exact: true}).count(), 0);
  await page.getByText('Saved return terms or a reliable delivery date are unavailable. Repaido must review this case individually.', {exact: true}).waitFor();
  checks.push('A failed provider attempt requires renewed review; historical missing terms are displayed as manual review');
  row.state = 'rejected'; row.refund_status = undefined; row.refund_amount_paise = undefined; row.decision_note = 'Original evidence needs independent reconsideration.';
  await open('customer');
  await page.getByRole('button', {name: 'Appeal the decision', exact: true}).click();
  await page.getByLabel('Reason for appeal').fill('Please review the seller receipt again; it confirms the reported motor fault.');
  await page.getByRole('button', {name: 'Appeal the decision', exact: true}).click();
  await page.getByText('Appealed', {exact: true}).waitFor();
  checks.push('Customer can submit a versioned appeal of a rejected decision');
  await page.addScriptTag({path: new URL('../node_modules/axe-core/axe.min.js', import.meta.url).pathname});
  const accessibility = await page.evaluate(async () => (await axe.run(document.querySelector('.retail-resolutions'), {runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa']})).violations.map(item => ({id: item.id, impact: item.impact, nodes: item.nodes.length})));
  assert.deepEqual(accessibility, []);
  await open('cart');
  const drawer = page.getByRole('dialog', {name: 'Your cart & orders'}); await drawer.waitFor();
  const order = drawer.locator('details[data-order-id="order-one"]');
  assert.equal(await order.getAttribute('open'), '');
  await order.getByRole('heading', {name: 'Returns, refunds & order help', exact: true}).waitFor();
  assert.equal(await order.getByRole('button', {name: 'Check payment / resume', exact: true}).count(), 0);
  checks.push('Integrated cart focuses the requested refunded order, mounts case support and offers no resume-payment action');
  delayReorder = true;
  const delayedRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/retail/orders/order-one/reorder'));
  const delayedResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/retail/orders/order-one/reorder'));
  await order.getByRole('button', {name: 'Add available items to cart again', exact: true}).click();
  await delayedRequest;
  await page.evaluate(() => window.__setRetailActor('another-account'));
  await page.waitForFunction(() => !document.querySelector('details[data-order-id="order-one"]'));
  releaseReorder();
  await (await delayedResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(async () => (await import('/src/services/cartService.ts')).cartService.getItems()), []);
  checks.push('A delayed reorder response after an account switch cannot add the previous customer’s items to the cart');
  delayReorder = false;
  await page.evaluate(() => window.__setRetailActor('buyer'));
  await order.waitFor();
  await order.evaluate(element => {element.open = true;});
  const reorder = order.getByRole('button', {name: 'Add available items to cart again', exact: true});
  const beforeReorder = calls.filter(call => call.path.endsWith('/reorder')).length;
  await reorder.evaluate(button => {button.click(); button.click();});
  await page.waitForFunction(async () => (await import('/src/services/cartService.ts')).cartService.getItemCount() === 2);
  const cart = await page.evaluate(async () => (await import('/src/services/cartService.ts')).cartService.getItems());
  assert.equal(calls.filter(call => call.path.endsWith('/reorder')).length, beforeReorder + 1);
  assert.equal(cart.length, 1); assert.equal(cart[0].quantity, 2); assert.equal(cart[0].price_paise, 12345);
  checks.push('Two reorder clicks in the same tick send one request and add the server’s current price and quantity once');
  await page.evaluate(async () => (await import('/src/services/cartService.ts')).cartService.clearCart());
  await page.evaluate(() => {localStorage.setItem('repaido.token', 'stale-test-token'); window.__setRetailActor(null);});
  await drawer.getByText('Sign in to check current prices, offers and orders.', {exact: false}).waitFor();
  assert.equal(await page.getByRole('heading', {name: 'Refurbished mixer grinder', exact: true}).count(), 0);
  checks.push('Sign-out clears private order/case content despite a stale legacy token');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({checks, errors, accessibility, providerSubmissions, note: 'Browser fixtures validate UI behavior; separate backend tests validate authorization and provider reconciliation.'}, null, 2));
  console.log(JSON.stringify({out, checks}, null, 2));
} catch (error) {await page?.screenshot({path: `${out}/failure.png`, fullPage: true}); console.error(JSON.stringify({errors, lastCalls: calls.slice(-10), text: await page?.locator('body').innerText()}, null, 2)); throw error;} finally {await browser.close();}
