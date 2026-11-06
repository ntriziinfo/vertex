import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
test('playing filter tracks live sessions, restores all cards and handles empty state',()=>{
 const cards=['active','idle','locked','ended'].map(id=>({dataset:{adminMachine:id},hidden:false}));
 const button={setAttribute(key,value){this[key]=value;}};
 const empty={hidden:true};
 const context=vm.createContext({rows:[{machineId:'active',currentSessionId:'session'},{machineId:'idle'},{machineId:'locked',locked:true},{machineId:'ended',lastEndedSession:{}}],document:{querySelectorAll:()=>cards},$:id=>id==='adminPlayingOnly'?button:empty});
 const source=html.slice(html.indexOf('function toggleAdminPlayingOnly(){'),html.indexOf('function setAdminDataView(view){'));
 vm.runInContext('let adminPlayingOnly=false; function machineRows(){return rows;} function renderAdminSlumpGraphs(){applyAdminPlayingFilter();}\n'+source,context);
 vm.runInContext('toggleAdminPlayingOnly()',context);
 assert.deepEqual(cards.map(c=>c.hidden),[false,true,true,true]);
 assert.equal(button['aria-pressed'],'true');assert.equal(empty.hidden,true);
 context.rows=[];vm.runInContext('applyAdminPlayingFilter()',context);assert.equal(empty.hidden,false);
 vm.runInContext('toggleAdminPlayingOnly()',context);assert.ok(cards.every(c=>!c.hidden));assert.equal(empty.hidden,true);
});
