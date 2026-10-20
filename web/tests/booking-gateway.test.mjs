import {beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Execute the real App callback with only its browser/provider boundaries faked.
const source = ts.createSourceFile('App.tsx', await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'liveConfirmBooking') callback = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, 'The mounted catalogue checkout callback must exist');
const compiled = ts.transpileModule('export const confirm = ' + callback, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
const checkoutSource=await readFile(new URL('../src/services/legacyBooking.ts',import.meta.url),'utf8');
const checkoutCompiled=ts.transpileModule(checkoutSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let confirm, requests, options, action, reloads, revision = 0, storage, actor, paymentState, failVerification, failOrder;
const order = {payment_order_id: 'saved-booking-order', razorpay_order_id: 'order_serverOwned', key_id: 'test_public_key', amount_paise: 15000, currency: 'INR'};
const draft = {items: [{service: {id: 'ac-service'},quantity:1}], city: 'Balasore', address: {name: 'Test Customer', phone: '9876543210', street: 'Fixture street', area: 'Test area', pincode: '756001'}, date: '2099-12-01', time: '10:00'};
beforeEach(async () => {
  requests = []; options = undefined; reloads = 0; action = 'complete';
  storage=new Map();actor='customer';paymentState='checking_payment';failVerification=false;failOrder=false;
  globalThis.__bookingGateway = {
    token: 'synthetic-local-session',
    auth:{get currentUser(){return actor?{uid:actor}:null;}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setSheet: () => {throw new Error('Unexpected sign-in flow');},
    api: async (path, init) => {
      requests.push({path, body: init.body?JSON.parse(init.body):undefined});
      if(path.endsWith('/check'))return {state:paymentState,booking_id:'confirmed-booking'};
      if (path === '/checkout/booking/order'){if(failOrder)throw Error('Order response lost');return order;}
      assert.equal(path, '/checkout/booking/verify');
      paymentState='fulfilled';if(failVerification)throw Error('Verification response lost');
      return {id: 'confirmed-booking'};
    },
    loadBookings: async () => {reloads++;},
    document: {
      createElement: () => ({remove(){}}),
      body: {appendChild: script => {assert.equal(script.src, 'https://checkout.razorpay.com/v1/checkout.js'); action === 'load-failure' ? script.onerror() : script.onload();}},
    },
    window: {Razorpay: class {
      constructor(config) {options = config;}
      open() {
        if (action === 'cancel') options.modal.ondismiss();
        else{if(action==='switch-account')actor='stranger';options.handler({razorpay_order_id:action==='wrong-order'?'order_unrelated':order.razorpay_order_id, razorpay_payment_id: 'pay_synthetic', razorpay_signature: 'synthetic-signature', amount: 1});}
      }
    }},
  };
  globalThis.document=globalThis.__bookingGateway.document;globalThis.window=globalThis.__bookingGateway.window;
  const {confirmLegacyBooking}=await import('data:text/javascript;base64,'+Buffer.from(checkoutCompiled).toString('base64')+'#'+(++revision));
  globalThis.__bookingGateway.confirmLegacyBooking=confirmLegacyBooking;
  const globals = 'const {token,setSheet,api,loadBookings,auth,localStorage,confirmLegacyBooking}=globalThis.__bookingGateway;\n';
  ({confirm} = await import('data:text/javascript;base64,' + Buffer.from(globals + compiled).toString('base64') + '#' + (++revision)));
});

test('gateway checkout is bound to the server order and verifies its saved identity', async () => {
  assert.deepEqual(await confirm(draft), {reference: 'confirmed-booking', mode: 'live'});
  assert.equal(options.order_id, order.razorpay_order_id);
  assert.equal(options.amount, order.amount_paise);
  assert.equal(options.currency, order.currency);
  assert.deepEqual(requests[1].body, {payment_order_id: order.payment_order_id, razorpay_order_id: order.razorpay_order_id, razorpay_payment_id: 'pay_synthetic', razorpay_signature: 'synthetic-signature'});
  assert.equal(reloads, 1);
});

for (const [failure, message] of [['cancel', /cancelled/], ['load-failure', /failed to load/]]) {
  test('a ' + failure + ' does not verify payment or report a booking', async () => {
    action = failure;
    await assert.rejects(confirm(draft), message);
    assert.equal(requests.length, 1);
    assert.equal(reloads, 0);
  });
}

test('a lost verification response recovers without opening another gateway or creating another order',async()=>{
  failVerification=true;
  await assert.rejects(confirm(draft),/response lost/);
  const saved=JSON.parse([...storage.values()][0]);
  assert.equal(saved.order.payment_order_id,order.payment_order_id);
  assert(!JSON.stringify(saved).includes(draft.address.phone));
  assert(!JSON.stringify(saved).includes('synthetic-signature'));
  options=undefined;
  assert.deepEqual(await confirm(draft),{reference:'confirmed-booking',mode:'live'});
  assert.equal(options,undefined);
  assert.equal(requests.filter(row=>row.path==='/checkout/booking/order').length,1);
  assert.equal(storage.size,0);
});

test('an uncertain order keeps the same request identity on retry',async()=>{
  failOrder=true;await assert.rejects(confirm(draft),/Order response lost/);
  failOrder=false;await confirm(draft);
  const orders=requests.filter(row=>row.path==='/checkout/booking/order');
  assert.equal(orders.length,2);assert.equal(orders[0].body.idempotency_key,orders[1].body.idempotency_key);
});

test('a captured payment needing another slot blocks a second gateway',async()=>{
  action='cancel';await assert.rejects(confirm(draft));
  action='complete';paymentState='action_required';options=undefined;
  await assert.rejects(confirm(draft),/Do not pay again/);
  assert.equal(options,undefined);assert.equal(requests.filter(row=>row.path==='/checkout/booking/order').length,1);
});

for(const [mode,message] of [['switch-account',/account changed/],['wrong-order',/different payment order/]]){
  test('gateway '+mode+' does not verify or expose a booking',async()=>{
    action=mode;await assert.rejects(confirm(draft),message);
    assert.equal(requests.filter(row=>row.path==='/checkout/booking/verify').length,0);assert.equal(reloads,0);
  });
}
