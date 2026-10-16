import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/services/modalScrollLock.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {acquireModalScrollLock}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function documentWith(body='',root=''){return {body:{style:{overflow:body}},documentElement:{style:{overflow:root}}};}
for(const order of [[1,0],[0,1]])test(`nested dialogs restore scrolling when released ${order.join(' then ')}`,()=>{
  const doc=documentWith('auto','scroll'),release=[acquireModalScrollLock(doc),acquireModalScrollLock(doc)];
  release[order[0]]();assert.equal(doc.body.style.overflow,'hidden');assert.equal(doc.documentElement.style.overflow,'hidden');
  release[order[1]]();assert.equal(doc.body.style.overflow,'auto');assert.equal(doc.documentElement.style.overflow,'scroll');
  // React cleanup can run again; it must not release a newer dialog's lock.
  const next=acquireModalScrollLock(doc);release[0]();release[1]();assert.equal(doc.body.style.overflow,'hidden');next();assert.equal(doc.body.style.overflow,'auto');
});
test('locks preserve existing external overlays and remain isolated per document',()=>{
  const blocked=documentWith('hidden','hidden'),other=documentWith(),release=acquireModalScrollLock(blocked),releaseOther=acquireModalScrollLock(other);
  release();assert.equal(blocked.body.style.overflow,'hidden');assert.equal(other.body.style.overflow,'hidden');releaseOther();assert.equal(other.body.style.overflow,'');assert.equal(other.documentElement.style.overflow,'');
});
