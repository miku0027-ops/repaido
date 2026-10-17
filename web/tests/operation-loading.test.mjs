import {beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createReadCache} from '../src/services/readCache.mjs';
import {feedbackImports} from './feedback-module.mjs';

let code = feedbackImports(ts.transpileModule(
  await readFile(new URL('../src/services/operations.ts', import.meta.url), 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}},
).outputText);
for (const [name, value] of [
  ['../firebase', 'const auth=globalThis.__operationTest.auth;'],
  ['./api', 'const apiFetch=globalThis.__operationTest.fetch;'],
  ['./loading', 'const beginLoading=globalThis.__operationTest.loading;'],
  ['./readCache.mjs', 'const createReadCache=globalThis.__operationTest.cache;'],
  ['./deviceLocation.mjs', 'const readDeviceLocation=()=>{};'],
]) {
  code = code.replace(new RegExp(`^import .+ from ['"]${name.replaceAll('.', '\\.')}['"];?$`, 'm'), value);
}

let operation, calls, visible, pending, revision = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (body = {jobs: []}, status = 200) => new Response(JSON.stringify(body), {status});
beforeEach(async () => {
  calls = 0; visible = 0; pending = [];
  globalThis.window = new EventTarget();
  globalThis.localStorage = {getItem: () => null};
  globalThis.__operationTest = {
    auth: {authStateReady: async () => {}, currentUser: {uid: 'a', getIdToken: async () => 'a-token'}},
    cache: createReadCache,
    fetch: async () => {calls++; return new Promise(resolve => pending.push(resolve));},
    loading: () => {visible++; return () => visible--;},
  };
  ({operation} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64') + '#' + (++revision)));
});

test('coalesced background and foreground reads settle their own indicators; refresh bypasses a warm cache', async () => {
  const background = operation('/jobs', {}, {background: true});
  const foreground = operation('/jobs', {}, {background: false});
  await tick();
  assert.equal(calls, 1); assert.equal(visible, 1);
  pending.shift()(response());
  await Promise.all([background, foreground]);
  assert.equal(visible, 0);
  await operation('/jobs', {}, {background: false});
  assert.equal(calls, 1); assert.equal(visible, 0);
  const refresh = operation('/jobs', {}, {force: true, background: false});
  await tick(); assert.equal(calls, 2); assert.equal(visible, 1);
  pending.shift()(response()); await refresh; assert.equal(visible, 0);
});

test('account changes reject the old private response and settle both loading indicators', async () => {
  const old = operation('/jobs', {}, {background: false});
  const rejected = assert.rejects(old, /account changed/);
  await tick();
  __operationTest.auth.currentUser = {uid: 'b', getIdToken: async () => 'b-token'};
  const current = operation('/jobs', {}, {background: false});
  await tick(); assert.equal(calls, 2); assert.equal(visible, 2);
  pending.shift()(response({jobs: [{id: 'private-a'}]}));
  pending.shift()(response({jobs: [{id: 'private-b'}]}));
  await rejected;
  assert.deepEqual(await current, {jobs: [{id: 'private-b'}]});
  assert.equal(visible, 0);
});

test('failed responses release every coalesced reader and allow a fresh transport retry', async () => {
  const a = operation('/jobs', {}, {background: false});
  const b = operation('/jobs', {}, {background: false});
  const rejected = [assert.rejects(a, /Retry/), assert.rejects(b, /Retry/)];
  await tick(); assert.equal(calls, 1); assert.equal(visible, 2);
  pending.shift()(response({detail: 'Retry'}, 503));
  await Promise.all(rejected); assert.equal(visible, 0);
  const retry = operation('/jobs', {}, {background: false});
  await tick(); assert.equal(calls, 2);
  pending.shift()(response()); await retry; assert.equal(visible, 0);
});
