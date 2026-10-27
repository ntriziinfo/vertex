import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c=vm.createContext({});vm.runInContext(fs.readFileSync('list-performance.js','utf8'),c);
const row={machineId:'nova-01',updatedAt:1,locked:false,settings:{setting:4},machineTotalStats:{totalSpins:20},machineTotalSlumpHistory:[{spin:20,profit:5}]};
test('heartbeat-only updates preserve cards, but new spins, graphs and occupancy redraw',()=>{
 const next=()=>JSON.parse(JSON.stringify(row));
 const heartbeat=next();heartbeat.updatedAt=2;assert.equal(c.NovaListPerformance.same([row],[heartbeat]),true);
 for(const edit of [r=>r.locked=true,r=>r.settings.setting=5,r=>r.machineTotalStats.totalSpins++,r=>r.machineTotalSlumpHistory[0].profit++,r=>r.currentPlayerName='new']){
  const changed=next();edit(changed);assert.equal(c.NovaListPerformance.same([row],[changed]),false);
 }
 assert.equal(c.NovaListPerformance.same([row],[]),false);
});
