import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const {machineTotalFor}=createRequire(import.meta.url)('../machine-totals.cjs');
const {completionSettings,settingsPatch}=createRequire(import.meta.url)('../admin-settings.cjs');

test('customer AT totals aggregate player deltas, preserve BB count and ignore prior reset cycles',()=>{
  const stats={totalSpins:1000,bigCount:10,atFirstCount:6,totalFee:3000,totalPaid:2700};
  const machine={machineId:'nova-03',resetSerial:2,currentSessionId:'b',lastSnapshot:{playSessionId:'b',stats:{...stats,totalSpins:1300,bigCount:12,atFirstCount:7},playSessionStartStats:stats}};
  const records=[{machineId:'nova-03',sessionId:'a',resetSerial:2,stats},{machineId:'nova-03',sessionId:'old',resetSerial:1,stats}];
  const total=machineTotalFor(machine,records).stats;
  assert.equal(total.totalSpins,1300);assert.equal(total.bigCount,12);assert.equal(total.atFirstCount,7);assert.equal(total.atFirstCountPartial,false);
});

test('customer AT initial probability uses accumulated games and first entries, with unknown history suppressed',()=>{
 for(const file of ['machines.html','nebula-machines.html']){
  const source=fs.readFileSync(file,'utf8'),c=vm.createContext({});
  vm.runInContext(source.match(/function atFirstRate\([^]*?\n}/)[0],c);
  assert.equal(c.atFirstRate({totalSpins:1000,atFirstCount:2}),'1/500.0');
  assert.equal(c.atFirstRate({totalSpins:0,atFirstCount:0}),'—');
  assert.equal(c.atFirstRate({totalSpins:1000,atFirstCount:0}),'—');
  assert.equal(c.atFirstRate({totalSpins:1000,atFirstCount:2,atFirstCountPartial:true}),'—');
  assert.match(source,/AT初当たり確率/);assert.doesNotMatch(source,/AT初当たり回数/);
 }
});

test('store limits use zero-based net and preserve existing threshold values through MY migration',()=>{
 assert.deepEqual(completionSettings({completeLimitPt:0,completeMyLimitPt:22000},'nova'),{completeBasis:'net',completeLimitPt:22000,completeMyLimitPt:0});
 assert.deepEqual(settingsPatch({completeLimitPt:10000},'nova'),{completeBasis:'net',completeLimitPt:10000,completeMyLimitPt:0});
 assert.equal(completionSettings({},'nova').completeLimitPt,19000);
 assert.deepEqual(settingsPatch({setting:4},'nova'),{setting:4});
 assert.deepEqual(completionSettings({completeMyLimitPt:10000},'jackspot'),{});
});

test('historical snapshots without AT counters are marked partial instead of treating BBs as ATs',()=>{
  const total=machineTotalFor({machineId:'nova-03',lastSnapshot:{stats:{totalSpins:1000,bigCount:10,totalFee:3000,totalPaid:2700}}}).stats;
  assert.equal(total.atFirstCount,0);assert.equal(total.atFirstCountPartial,true);
  const empty=machineTotalFor({machineId:'nova-03'}).stats;
  assert.equal(empty.atFirstCount,0);assert.equal(empty.atFirstCountPartial,false);
});
