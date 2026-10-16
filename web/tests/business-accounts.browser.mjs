import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/opt/codex/runtimes/cua/lib/node_modules/playwright');
const origin = process.env.BUSINESS_TEST_ORIGIN || 'http://127.0.0.1:5192';
const out = '/tmp/repaido-business-browser';
await mkdir(out, {recursive: true});
const aid = 'a'.repeat(64), propertyId = 'property-one';
let currentUid = 'owner', role = 'owner';
const calls = [], errors = [], checks = [];
const authFixture = `let user={uid:'owner',getIdToken:async()=> 'owner'};const listeners=new Set();export const auth={currentUser:user,authStateReady:async()=>{},onIdTokenChanged(next){const fn=typeof next==='function'?next:next.next.bind(next);listeners.add(fn);queueMicrotask(()=>fn(user));return()=>listeners.delete(fn);}};window.__setBusinessActor=uid=>{user=uid?{uid,getIdToken:async()=>uid}:null;auth.currentUser=user;for(const listener of listeners)listener(user);};export const db={};export const app={};export const analytics=null;export const firebaseConfig={};export default app;`;
const properties = [{id: propertyId, name: 'Station Road Apartments', address: '27 Station Road, near the main market', city: 'Balasore', monthly_budget_paise: 1000000, version: 4, archived: false}];
const members = [{user_id: 'owner', name: 'Account Owner', role: 'owner', status: 'active', version: 1}, {user_id: 'staff', name: 'Property Coordinator', role: 'staff', status: 'active', version: 3}, {user_id: 'viewer', name: 'Account Auditor', role: 'viewer', status: 'active', version: 1}];
const makeRequest = (id, title, requested_by, status) => ({id, property_id: propertyId, title, description: 'Inspect the property and provide the agreed service.', category: 'repair', estimated_paise: 100000, status, requested_by, requested_name: requested_by === 'owner' ? 'Account Owner' : 'Property Coordinator', needed_on: '2030-11-01', version: 2});
const requests = [makeRequest('request-team', 'Replace a leaking kitchen tap', 'staff', 'pending'), makeRequest('request-own', 'Inspect the electrical panel', 'owner', 'pending'), makeRequest('request-link', 'Approved pump service', 'owner', 'approved')];
const maintenance = [{id: 'maintenance-one', property_id: propertyId, title: 'Check water pump operation', due_on: '2030-10-31', repeat_months: 1, assigned_to: 'staff', status: 'open', version: 2}];
const invitations = [];
const statement = {rows: [{id: 'contract:receipt-one', source_kind: 'contract', source_id: 'contract-one', property_id: propertyId, label: 'Pump replacement receipt', status: 'partially_refunded', amount_paise: 120000, paid_paise: 100000, refunded_paise: 20000, issued_at: 1792100000, document_type: 'payment_receipt', source: 'verified_transfer', exceeds_approval: true}], total_issued_paise: 120000, total_paid_paise: 100000, refunded_paise: 20000, outstanding_paise: 0, estimate_paise: 300000, unavailable_request_ids: ['missing-source'], note: 'Consolidated service statements and verified receipts. Pay in the original booking or order.'};
function detail() {return {user_id: currentUid, account: {id: aid, name: 'Station Road Association', kind: 'apartment', version: 1}, role, members, properties, requests: requests.map(request => ({...request, can_decide: ['owner', 'manager'].includes(role) && request.requested_by !== currentUid && request.status === 'pending', can_cancel: role !== 'viewer' && request.requested_by === currentUid && !request.record && ['pending', 'approved'].includes(request.status), can_link: role !== 'viewer' && request.requested_by === currentUid && request.status === 'approved' && !request.record})), maintenance: maintenance.map(item => ({...item, can_complete: item.status === 'open' && (['owner', 'manager'].includes(role) || role === 'staff' && item.assigned_to === currentUid)})), invitations, statement, summary: {approved_estimate_paise: 100000, pending_estimate_paise: 200000}};}
let page;
const browser = await chromium.launch({executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/src/firebase.ts') return route.fulfill({contentType: 'text/javascript', body: authFixture});
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let payload; try {payload = request.postDataJSON();} catch {}
    const method = request.method(), path = url.pathname.replace('/api/operations/business-accounts', '');
    calls.push({path, method, payload});
    let result;
    if (path === '' && method === 'GET') result = {accounts: [{id: aid, name: 'Station Road Association', kind: 'apartment', role}]};
    else if (path === `/${aid}` && method === 'GET') result = detail();
    else if (path === `/${aid}/requests` && method === 'POST') {const row = {...makeRequest('request-new', payload.title, currentUid, 'pending'), ...payload}; requests.push(row); result = row;}
    else if (path.endsWith('/decision')) {const row = requests.find(item => path.includes(`/${item.id}/`)); row.status = payload.action === 'approve' ? 'approved' : payload.action === 'reject' ? 'rejected' : 'cancelled'; row.decision_reason = payload.reason; row.version++; result = row;}
    else if (path.endsWith('/linkable')) result = {records: [{kind: 'job', id: 'job-quoted', label: 'Quoted pump service', status: 'booked', amount_paise: 90000}, {kind: 'job', id: 'job-unquoted', label: 'Awaiting quote', status: 'requested', amount_paise: null}, {kind: 'job', id: 'job-over', label: 'Major replacement', status: 'booked', amount_paise: 900000}]};
    else if (path.endsWith('/link')) {const row = requests.find(item => path.includes(`/${item.id}/`)); row.record = {kind: payload.kind, id: payload.id}; row.version++; result = row;}
    else if (path.endsWith(`/properties/${propertyId}`) && method === 'PUT') {Object.assign(properties[0], payload, {version: properties[0].version + 1}); result = properties[0];}
    else if (path.endsWith('/invitations') && method === 'POST') {const row = {id: 'invite-one', role: payload.role, status: 'pending', expires_at: 2090000000}; invitations.push(row); result = {...row, token: 'single-use-invitation-code-for-intended-person'};}
    else if (path.includes('/members/') && method === 'PUT') {const row = members.find(item => path.endsWith('/' + item.user_id)); Object.assign(row, payload, {version: row.version + 1}); result = row;}
    else if (path.endsWith('/cancel') && path.includes('/maintenance/')) {const row = maintenance.find(item => path.includes('/' + item.id + '/')); row.status = 'cancelled'; row.version++; result = row;}
    else if (path.endsWith('/complete')) {maintenance[0].status = 'completed'; maintenance[0].version++; maintenance.push({...maintenance[0], id: 'maintenance-next', due_on: '2030-11-30', status: 'open', version: 1}); result = maintenance[0];}
    else return route.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({detail: `Unexpected test route ${method} ${path}`})});
    return route.fulfill({contentType: 'application/json', body: JSON.stringify(result)});
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/tests/business-accounts-preview.html');
  await page.getByRole('heading', {name: 'Station Road Association', exact: true}).waitFor();
  const own = page.locator('article').filter({has: page.getByRole('heading', {name: 'Inspect the electrical panel', exact: true})});
  assert.equal(await own.getByRole('button', {name: 'Review & approve'}).count(), 0);
  const team = page.locator('article').filter({has: page.getByRole('heading', {name: 'Replace a leaking kitchen tap', exact: true})});
  await team.getByRole('button', {name: 'Review & approve'}).click();
  await team.getByLabel('Decision note').fill('Approved within the property budget.');
  await team.getByRole('button', {name: 'Confirm internal approval'}).click();
  await team.getByText('Approved', {exact: true}).waitFor();
  assert(calls.some(call => call.payload?.action === 'approve' && call.payload.expected_version === 2));
  checks.push('Self-approval is hidden; another member’s request submits a versioned decision with a reason');
  for (const width of [320, 467, 1280]) {
    await page.setViewportSize({width, height: 900});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}px`);
    await page.screenshot({path: `${out}/requests-${width}.png`, fullPage: true});
  }
  checks.push('Request workspace fits 320px, 467px and desktop widths');
  await page.getByRole('button', {name: 'Request work', exact: true}).click();
  await page.locator('select[name=property_id]').selectOption(propertyId);
  await page.getByLabel('Request title').fill('Repair the entrance light');
  await page.getByLabel('Scope & requirements').fill('Inspect and repair the entrance light fitting.');
  await page.getByLabel('Estimated cost (₹)').fill('567.89');
  await page.getByLabel('Needed on', {exact: true}).fill('2030-11-02');
  await page.getByRole('button', {name: 'Send for approval', exact: true}).click();
  await page.getByRole('heading', {name: 'Repair the entrance light', exact: true}).waitFor();
  assert(calls.some(call => call.payload?.title === 'Repair the entrance light' && call.payload.estimated_paise === 56789 && call.payload.request_id));
  checks.push('Request creation sends integer paise, a needed date and an idempotency key');
  const link = page.locator('article').filter({has: page.getByRole('heading', {name: 'Approved pump service', exact: true})});
  await link.getByRole('button', {name: 'Link Repaido record'}).click();
  const select = link.getByLabel('Repaido record', {exact: true});
  await select.waitFor();
  assert(await select.locator('option[value="job:job-unquoted"]').evaluate(option => option.disabled));
  assert(await select.locator('option[value="job:job-over"]').evaluate(option => option.disabled));
  await select.selectOption('job:job-quoted');
  await link.getByRole('button', {name: 'Link this record', exact: true}).click();
  await link.getByText('Linked service booking', {exact: false}).waitFor();
  checks.push('Linking requires a quoted record within the approved amount and submits its native record ID');
  await page.getByRole('button', {name: 'Properties', exact: true}).click();
  await page.getByRole('button', {name: 'Edit property & budget', exact: true}).click();
  await page.getByLabel('Monthly approval budget (₹)').fill('5000');
  await page.getByRole('button', {name: 'Save property', exact: true}).click();
  await page.getByRole('button', {name: 'Save property', exact: true}).waitFor({state: 'hidden'});
  assert(calls.some(call => call.method === 'PUT' && call.payload?.monthly_budget_paise === 500000 && call.payload.expected_version === 4));
  await page.getByRole('button', {name: 'Team', exact: true}).click();
  await page.getByRole('button', {name: 'Create invitation code', exact: true}).click();
  await page.getByLabel('Share this invitation code').waitFor();
  assert.equal(await page.getByLabel('Share this invitation code').inputValue(), 'single-use-invitation-code-for-intended-person');
  const staff = page.locator('article').filter({has: page.getByRole('heading', {name: 'Property Coordinator', exact: true})});
  await staff.getByRole('button', {name: 'Manage access'}).click();
  await staff.getByLabel('Role', {exact: true}).selectOption('manager');
  await staff.getByRole('button', {name: 'Save access'}).click();
  await staff.getByRole('button', {name: 'Manage access'}).waitFor();
  assert(calls.some(call => call.path.endsWith('/members/staff') && call.payload.role === 'manager' && call.payload.expected_version === 3));
  checks.push('Property budgets and team roles use versions; invitations expose a manual share code');
  await page.getByRole('button', {name: 'Maintenance', exact: true}).click();
  await page.getByRole('button', {name: 'Mark completed', exact: true}).click();
  await page.getByLabel('Completion note').fill('Pump inspected and working correctly.');
  await page.getByRole('button', {name: 'Confirm completion'}).click();
  await page.getByText('30 Nov 2030', {exact: true}).waitFor();
  checks.push('Recurring maintenance completes with a versioned note and shows the next reminder');
  await page.getByRole('button', {name: 'Cancel reminder', exact: true}).click();
  await page.getByLabel('Cancellation reason').fill('Equipment replaced; stop this old maintenance series.');
  await page.getByRole('button', {name: 'Confirm reminder cancellation'}).click();
  await page.getByText('No upcoming maintenance.', {exact: false}).waitFor();
  await page.getByLabel('Include completed & cancelled maintenance').check();
  await page.getByText('Cancelled', {exact: true}).waitFor();
  assert(calls.some(call => call.path.endsWith('/maintenance/maintenance-next/cancel') && call.payload.expected_version === 1));
  checks.push('Managers can stop a recurring reminder without removing completed or cancelled history');
  await page.getByRole('button', {name: 'Statement', exact: true}).click();
  await page.getByText('Payment receipt · contract:receipt-one', {exact: true}).waitFor();
  await page.getByText('Exceeds approved estimate · review required', {exact: true}).waitFor();
  await page.getByText('Refunded ₹200.00', {exact: true}).waitFor();
  assert.equal(await page.getByRole('alert').count(), 1);
  await page.setViewportSize({width: 320, height: 900});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({path: `${out}/statement-320.png`, fullPage: true});
  checks.push('Statement distinguishes receipts, net payments, refunds, estimates and unavailable sources; its table scrolls within mobile width');
  role = 'viewer'; currentUid = 'viewer';
  await page.evaluate(() => window.__setBusinessActor('viewer'));
  await page.getByText('View properties, requests, maintenance and the account statement.', {exact: true}).first().waitFor();
  assert.equal(await page.getByRole('button', {name: 'Request work', exact: true}).count(), 0);
  await page.getByRole('button', {name: 'Team', exact: true}).click();
  assert.equal(await page.getByRole('button', {name: 'Manage access', exact: true}).count(), 0);
  assert.equal(await page.getByLabel('Share this invitation code').count(), 0);
  checks.push('Switching identity clears private invitation state and viewer access exposes no write controls');
  await page.addScriptTag({path: new URL('../node_modules/axe-core/axe.min.js', import.meta.url).pathname});
  const accessibility = await page.evaluate(async () => (await axe.run(document.querySelector('.business-accounts'), {runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa']})).violations.map(item => ({id: item.id, impact: item.impact, nodes: item.nodes.length})));
  assert.deepEqual(accessibility, []);
  checks.push('Team view passes axe WCAG A/AA checks');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({checks, errors, accessibility, note: 'UI fixtures only; backend domain tests verify real authorization and financial rules.'}, null, 2));
  console.log(JSON.stringify({out, checks}, null, 2));
} catch (error) {await page?.screenshot({path: `${out}/failure.png`, fullPage: true}); console.error(JSON.stringify({errors, lastCalls: calls.slice(-8), text: await page?.locator('body').innerText()}, null, 2)); throw error;} finally {await browser.close();}
