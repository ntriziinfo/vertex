import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('floor data matches cabinet rendering using cumulative data, including minimum 0G AT bars',()=>{
 const make=()=>({dataset:{},children:[],setAttribute(){},addEventListener(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;}});
 function root(){const values=new Map(),bars=make();return {dataset:{machineCounter:'nova-01'},bars,values,querySelector:s=>s==='.novaHitBars'?bars:(values.has(s)||values.set(s,{}),values.get(s))};}
 const floor=root(),cabinet=root();
 const c=vm.createContext({document:{createElement:make,querySelectorAll:()=>[floor]}});
 vm.runInContext(fs.readFileSync('nova-data-counter.js','utf8')+fs.readFileSync('machine-data.js','utf8'),c);
 const stats={totalSpins:1200,bigCount:4,atFirstCount:2,dataNormalGames:700,dataAtGames:500,dataHitSeq:2,dataInterval:{phase:'normal',games:20},dataHits:[{seq:1,spin:1000,kind:'BIG',games:400,phase:'normal'},{seq:2,spin:1000,kind:'AT',games:0,phase:'normal'}]};
 const machine={machineId:'nova-01',machineType:'nova',stats:{totalSpins:10},machineTotalStats:stats};
 c.NovaStoreData.renderAll([machine]);c.NovaDataCounter.render(cabinet,c.NovaDataCounter.display(stats),stats);
 assert.deepEqual(floor.values,cabinet.values);assert.equal(floor.values.get('[data-counter="total"]').textContent,'1,200');
 assert.equal(floor.values.get('[data-counter="current"]').textContent,'20');
 assert.equal(floor.bars.children[1].title,'AT / 0G');assert.equal(floor.bars.children[1].children[0].children.filter(i=>i.className==='lit').length,1);
 delete stats.dataInterval;c.NovaStoreData.renderAll([machine]);assert.equal(floor.values.get('[data-counter="current"]').textContent,'—');
 assert.equal(c.NovaStoreData.markup({machineType:'generic'}),'');
 assert.match(c.NovaStoreData.markup({...machine,machineId:'"<x>'}),/&quot;&lt;x&gt;/);
});
