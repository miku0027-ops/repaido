import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

// Use Vite's CSS parser so whitespace, comments and grouped selectors do not
// change these style contracts. Actual computed layout is browser-tested.
const {parse}=createRequire(import.meta.resolve('vite'))('postcss');
const css=name=>parse(readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8'));
const compact=css('compact-market.css'),refurb=css('refurbished-market.css'),b2b=css('b2b-marketplace.css'),hiring=css('hiring.css'),opportunity=css('opportunity-carousel.css');
function declarations(sheet,selector){
 const values={};let matches=0;
 sheet.walkRules(rule=>{if(rule.selectors.includes(selector)){matches++;rule.walkDecls(decl=>{values[decl.prop]=decl.value;});}});
 assert(matches>0,'Missing style rule for '+selector);return values;
}

test('market category rails retain readable pill controls and the wholesale touch target',()=>{
 for(const [sheet,selector] of [[refurb,'.spare-category-rail-btn'],[b2b,'.b2b-category-rail button'],[hiring,'.hire-category-rail button'],[compact,'html:not(.large-text) #root .rentals .rental-rail button']]){
  const rule=declarations(sheet,selector);
  assert(Number.parseFloat(rule['min-height'])>=32,selector+' minimum target');
  assert(Number.parseFloat(rule['border-radius'])>=999,selector+' pill shape');
 }
 assert.equal(declarations(b2b,'.b2b-category-rail button')['min-height'],'44px');
});

test('selected wholesale and hiring categories inherit theme colors',()=>{
 for(const [sheet,selector] of [[b2b,'.b2b-category-rail button[aria-pressed=true]'],[hiring,'.hire-category-rail [aria-pressed=true]']]){
  const rule=declarations(sheet,selector);assert.match(rule.background,/var\(--ui-primary(?:,|\))/);assert(['#fff','white'].includes(rule.color));
 }
 const selected=declarations(refurb,'.spare-category-rail-btn.is-selected');
 assert.equal(selected.background,'#142858');assert.equal(selected.color,'#ffffff');
});

test('refurbished highlights and grade filters retain compact single-line pills',()=>{
 for(const [selector,height] of [['.refurb-season-card','34px'],['.refurb-grade-chip','28px']]){
  const rule=declarations(refurb,selector);assert.equal(rule.height,height);assert.equal(rule['white-space'],'nowrap');assert(Number.parseFloat(rule['border-radius'])>=999);
 }
});

test('the marketplace opportunity ticker retains its compact preview height',()=>{
 assert.equal(declarations(opportunity,'.opportunity-carousel.opportunity-market').height,'38px');
});

test('marketplace destination navigation can grow with its labels and keeps a 48px target',()=>{
 const destinations=declarations(compact,'#root .market-experience .stores-nav-pill');
 assert.equal(destinations['min-height'],'48px');assert.equal(destinations.height,'auto');
 const primary=declarations(compact,'#root .market-primary-switch button');assert.equal(primary['min-height'],'32px');
});
