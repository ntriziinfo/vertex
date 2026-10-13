import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const {machineTotalFor,completedMachineTotal,machineDisplayBaseline}=createRequire(import.meta.url)('../machine-totals.cjs');
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

test('compact checkpoint preserves every player, current play and reset isolation without querying history',()=>{
  const machine={machineId:'nova-03',resetSerial:2};
  for(let i=1;i<=4;i++){
    const record={sessionId:'p'+i,machineId:machine.machineId,resetSerial:2,stats:{totalSpins:100,bigCount:2,atFirstCount:1,totalFee:300,totalPaid:400}};
    const total=completedMachineTotal(machine,record);
    machine.lastEndedSession={sessionId:record.sessionId,record,machineTotal:total};
    assert.equal(machineTotalFor(machine).stats.totalSpins,i*100);
    assert.equal(machineTotalFor(machine,[record]).stats.profit,i*100,'records never duplicate the checkpoint');
    assert.equal(machineDisplayBaseline(machine).bigCount,i*2);
  }
  machine.currentSessionId='p5';
  machine.lastSnapshot={playSessionId:'p4',stats:{totalSpins:100}};
  assert.equal(machineTotalFor(machine).stats.totalSpins,400,'starting next player does not count the previous snapshot twice');
  machine.lastSnapshot={playSessionId:'p5',stats:{totalSpins:25,bigCount:1,atFirstCount:0,totalFee:75,totalPaid:0}};
  assert.equal(machineTotalFor(machine).stats.totalSpins,425);assert.equal(machineTotalFor(machine).stats.profit,325);
  assert.equal(machineDisplayBaseline(machine).totalSpins,400,'resume baseline excludes the active player');
  machine.resetSerial++;machine.currentSessionId='';machine.lastSnapshot=null;
  assert.equal(machineTotalFor(machine).stats.totalSpins,0);
});

test('normal small-role counters persist across player deltas, checkpoints and reloads until an admin reset',()=>{
  const machine={machineId:'nova-03',resetSerial:3};
  const record={sessionId:'first',machineId:machine.machineId,resetSerial:3,stats:{totalSpins:2000,normalRoleGames:1000,normalRoleSuikaCount:20,normalRoleNaviBellCount:5}};
  const saved=completedMachineTotal(machine,record);
  machine.lastEndedSession={sessionId:record.sessionId,record,machineTotal:saved};
  const baseline=machineDisplayBaseline(machine);
  assert.equal(baseline.normalRoleGames,1000);assert.equal(baseline.normalRoleSuikaCount,20);
  machine.currentSessionId='second';
  machine.lastSnapshot={playSessionId:'second',playSessionStartStats:record.stats,stats:{...record.stats,totalSpins:2200,normalRoleGames:1100,normalRoleSuikaCount:22,normalRoleNaviBellCount:6}};
  const total=machineTotalFor(machine).stats;
  assert.equal(total.normalRoleGames,1100);assert.equal(total.normalRoleSuikaCount,22);assert.equal(total.normalRoleNaviBellCount,6);
  assert.equal(machineDisplayBaseline(machine).normalRoleGames,1000,'active player is excluded from the launch baseline');
  assert.deepEqual(machineTotalFor(JSON.parse(JSON.stringify(machine))).stats,total);
  machine.resetSerial++;machine.currentSessionId='';machine.lastSnapshot=null;
  assert.equal(machineTotalFor(machine).stats.normalRoleGames,0);
  assert.equal(machineDisplayBaseline(machine).normalRoleSuikaCount,0);
});
