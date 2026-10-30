import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {machineTotalFor}=createRequire(import.meta.url)('../machine-totals.cjs');

test('server totals and floor renderer preserve yellow challenge bars across player sessions',()=>{
 const machine={machineId:'nova-01',machineType:'nova',resetSerial:1};
 const records=[1,2].map(i=>({machineId:'nova-01',sessionId:'test-'+i,resetSerial:1,endedAtMs:i,
  stats:{totalSpins:200,totalFee:600,totalPaid:800,atFirstCount:1,dataHitSeq:1,dataInterval:{phase:'art',games:100},dataHits:[{seq:1,spin:100,kind:'ZONE',zone:'supernova_challenge',games:100,phase:'art'}]}}));
 const stats=machineTotalFor(machine,records).stats;
 assert.equal(stats.dataHits.length,2);assert.equal(stats.dataHits[1].spin,300);
 assert.equal(stats.atFirstCount,2);assert.equal(stats.totalSpins,400);assert.equal(stats.profit,400);
 const node=()=>({dataset:{},children:[],setAttribute(){},addEventListener(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;}});
 const bars=node(),root={dataset:{machineCounter:'nova-01'},querySelector:s=>s==='.novaHitBars'?bars:null};
 const c=vm.createContext({document:{createElement:node,querySelectorAll:s=>s==='[data-machine-counter]'?[root]:[]}});
 vm.runInContext(fs.readFileSync('nova-data-counter.js','utf8')+fs.readFileSync('machine-data.js','utf8'),c);
 c.NovaStoreData.renderAll([{...machine,machineTotalStats:stats}]);
 for(const column of bars.children.slice(1)){
  assert.equal(column.dataset.zone,'supernova_challenge');assert.equal(column.title,'スーパーノヴァチャレンジ / 100G');
  assert.equal(column.children[1].textContent,'上');
 }
 assert.match(c.NovaStoreData.markup(machine),/class="challenge">■ スーパーノヴァチャレンジ/);
 assert.match(fs.readFileSync('nova-data-counter.css','utf8'),/\.novaHitColumn\[data-kind=ZONE\]\[data-zone=supernova_challenge\]\{color:#ffd84d;\}/);
});
