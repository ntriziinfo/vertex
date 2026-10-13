import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {machineTotalFor}=createRequire(import.meta.url)('../machine-totals.cjs');

test('customer AT totals aggregate player deltas, preserve BB count and ignore prior reset cycles',()=>{
  const stats={totalSpins:1000,bigCount:10,atFirstCount:6,totalFee:3000,totalPaid:2700};
  const machine={machineId:'nova-03',resetSerial:2,currentSessionId:'b',lastSnapshot:{playSessionId:'b',stats:{...stats,totalSpins:1300,bigCount:12,atFirstCount:7},playSessionStartStats:stats}};
  const records=[{machineId:'nova-03',sessionId:'a',resetSerial:2,stats},{machineId:'nova-03',sessionId:'old',resetSerial:1,stats}];
  const total=machineTotalFor(machine,records).stats;
  assert.equal(total.totalSpins,1300);assert.equal(total.bigCount,12);assert.equal(total.atFirstCount,7);assert.equal(total.atFirstCountPartial,false);
});

test('historical snapshots without AT counters are marked partial instead of treating BBs as ATs',()=>{
  const total=machineTotalFor({machineId:'nova-03',lastSnapshot:{stats:{totalSpins:1000,bigCount:10,totalFee:3000,totalPaid:2700}}}).stats;
  assert.equal(total.atFirstCount,0);assert.equal(total.atFirstCountPartial,true);
  const empty=machineTotalFor({machineId:'nova-03'}).stats;
  assert.equal(empty.atFirstCount,0);assert.equal(empty.atFirstCountPartial,false);
});
