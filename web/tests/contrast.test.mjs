import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const luminance=hex=>{const rgb=hex.match(/[a-f\d]{2}/gi).map(h=>parseInt(h,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('All approved text pairs exceed AAA 7:1, including disabled and tinted surfaces',()=>{
 for(const fg of ['0B132B','414B60','003BB5'])for(const bg of ['FFFFFF','F8F9FA','E2E8F0','EEF2FF'])assert.ok(ratio(fg,bg)>=7,`${fg} on ${bg}`);
 for(const bg of ['003BB5','002D8F','0B132B','17285C','344577'])assert.ok(ratio('FFFFFF',bg)>=7);
 for(const bg of ['FFFFFF','F8F9FA','DFE1E3'])for(const fg of ['0B132B','334155','123A84'])assert.ok(ratio(fg,bg)>=7,`${fg} on ${bg}`);
 for(const bg of ['FFFFFF','F8F9FA'])assert.ok(ratio('3E4C63',bg)>=7);
 assert.ok(ratio('991B1B','FFFFFF')>=7);
});
test('Control boundaries meet 3:1 non-text contrast',()=>{
 for(const bg of ['FFFFFF','F8F9FA'])assert.ok(ratio('65748B',bg)>=3);
});
test('Promotion carousel text and icons retain contrast on all campaign themes',()=>{
 for(const bg of ['EEF3FF','EDF8F1','FFF3E8'])for(const fg of ['0B132B','3E4C63'])assert.ok(ratio(fg,bg)>=7,`${fg} on ${bg}`);
 assert.ok(ratio('142A64','FFFFFF')>=3);
 for(const fg of ['E8EEFF','BFCADD'])assert.ok(ratio(fg,'1D2B43')>=7);
});
test('Task stages use AAA text and visible controls in both shared token palettes',()=>{
 const css=readFileSync(new URL('../src/design-system.css',import.meta.url),'utf8');
 const palettes=[css.match(/:root\s*\{([^}]+)\}/)[1],css.match(/\[data-theme=dark\]\s*\{([^}]+)\}/)[1]];
 for(const block of palettes){
  const tokens=Object.fromEntries([...block.matchAll(/--ui-([\w-]+):\s*#([a-f\d]{6})/gi)].map(m=>[m[1],m[2]]));
  for(const background of ['surface','subtle']){
   for(const text of ['ink','muted','link'])assert.ok(ratio(tokens[text],tokens[background])>=7,`${text} on ${background}`);
   assert.ok(ratio(tokens.control,tokens[background])>=3,'control boundary');
  }
  for(const status of ['success','warning','danger']){
   assert.ok(ratio(tokens[status],tokens[`${status}-surface`])>=7,`${status} text`);
   assert.ok(ratio(tokens[`${status}-line`],tokens[`${status}-surface`])>=3,`${status} boundary`);
   assert.ok(ratio(tokens[status],tokens.surface)>=7,`${status} on page`);
  }
  assert.ok(ratio('ffffff',tokens.primary)>=7,'selected blue step / primary CTA');
 }
});
