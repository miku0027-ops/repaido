import test from 'node:test';import assert from 'node:assert/strict';
import {searchCompletions} from '../src/services/searchCompletions.mjs';
const rows=[{label:'AC power service',category:'ac',kind:'Service'},{label:'Refrigerator repair',category:'ac',kind:'Service'},{label:'Plumbing repair',category:'plumbing',kind:'Service'},{label:'Home cleaning',category:'cleaning',kind:'Service'}];
test('completes multiple prefixes and known aliases',()=>{assert.equal(searchCompletions('ac po',rows)[0].label,'AC power service');assert.equal(searchCompletions('fridge',rows)[0].label,'Refrigerator repair');assert.equal(searchCompletions('plumber',rows)[0].label,'Plumbing repair');});
test('handles one-edit typos without inventing results',()=>{assert.equal(searchCompletions('pluming',rows)[0].label,'Plumbing repair');assert.deepEqual(searchCompletions('unknown xyz',rows),[]);assert.deepEqual(searchCompletions('a',rows),[]);});
test('deduplicates and bounds suggestions; interests cannot override relevance',()=>{assert.equal(searchCompletions('repair',[...rows,...rows]).length,2);assert.deepEqual(searchCompletions('ac po',rows,{plumbing:999}).map(r=>r.label),['AC power service']);});
