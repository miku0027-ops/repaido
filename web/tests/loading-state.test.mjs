import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/services/loading.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {loadingState,beginLoading}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
test('overlapping requests remain visible until both settle; cleanup is idempotent',()=>{let notices=0;const off=loadingState.subscribe(()=>notices++);const a=beginLoading('/jobs'),b=beginLoading('/market');assert.equal(loadingState.getSnapshot().length,2);a();a();assert.equal(loadingState.getSnapshot().length,1);b();assert.equal(loadingState.getSnapshot().length,0);assert.equal(notices,4);off();});
