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
let confirm, requests, options, action, reloads, revision = 0;
const order = {payment_order_id: 'saved-booking-order', razorpay_order_id: 'order_serverOwned', key_id: 'test_public_key', amount_paise: 15000, currency: 'INR'};
const draft = {items: [{service: {id: 'ac-service'}}], city: 'Balasore', address: {name: 'Test Customer', phone: '9876543210', street: 'Fixture street', area: 'Test area', pincode: '756001'}, date: '2099-12-01', time: '10:00'};
beforeEach(async () => {
  requests = []; options = undefined; reloads = 0; action = 'complete';
  globalThis.__bookingGateway = {
    token: 'synthetic-local-session',
    setSheet: () => {throw new Error('Unexpected sign-in flow');},
    api: async (path, init) => {
      requests.push({path, body: JSON.parse(init.body)});
      if (path === '/checkout/booking/order') return order;
      assert.equal(path, '/checkout/booking/verify');
      return {id: 'confirmed-booking'};
    },
    loadBookings: async () => {reloads++;},
    document: {
      createElement: () => ({}),
      body: {appendChild: script => {assert.equal(script.src, 'https://checkout.razorpay.com/v1/checkout.js'); action === 'load-failure' ? script.onerror() : script.onload();}},
    },
    window: {Razorpay: class {
      constructor(config) {options = config;}
      open() {
        if (action === 'cancel') options.modal.ondismiss();
        else options.handler({razorpay_order_id: order.razorpay_order_id, razorpay_payment_id: 'pay_synthetic', razorpay_signature: 'synthetic-signature', amount: 1});
      }
    }},
  };
  const globals = 'const {token,setSheet,api,loadBookings,document,window}=globalThis.__bookingGateway;\n';
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
