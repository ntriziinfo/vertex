import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import resume from '../machine-resume.cjs';
const machine={machineId:'one',machineType:'nova',resetSerial:5,lastEndedSession:{playerName:'改',record:{machineId:'one',resetSerial:5,playerProfit:184}}};
test('display carry belongs only to the immediately preceding customer on this cabinet and reset cycle',()=>{
  assert.equal(resume.creditCarryFor(machine,'改'),184);
  assert.equal(resume.creditCarryFor(machine,' 改 '),184);
  for(const name of ['他のお客様','','かい'])assert.equal(resume.creditCarryFor(machine,name),0);
  assert.equal(resume.creditCarryFor({...machine,resetSerial:6},'改'),0);
  assert.equal(resume.creditCarryFor({...machine,machineId:'two'},'改'),0);
  assert.equal(resume.creditCarryFor({...machine,lastEndedSession:null},'改'),0);
  assert.equal(resume.creditCarryFor({...machine,machineType:'jackspot'},'改'),0);
  const continued={...machine,lastEndedSession:{playerName:'改',record:{...machine.lastEndedSession.record,playerProfit:-200,playerCreditTotal:2480}}};
  assert.equal(resume.creditCarryFor(continued,'改'),2480);
});
test('resume metadata preserves per-entry carry and command boundary without leaking identity',()=>{
  const saved={stats:{totalFee:2697,totalPaid:2881},playSessionId:'current',adminCommandLastId:152,playSessionStartStats:{totalFee:0,totalPaid:0}};
  const session={sessionId:'current',startedAt:1234,startSnapshot:{playerCreditCarry:-100}};
  const result=resume.forSession({...machine,lastSnapshot:saved},session);
  assert.equal(result.creditCarry,-100);assert.equal(result.commandsAfter,1234);assert.equal(result.lastCommandId,152);
  assert.equal(result.baseline.totalPaid,0);
  assert.deepEqual(resume.creditFields(machine,session,184),{playerCreditCarry:-100,playerCreditTotal:84});
  assert.doesNotMatch(JSON.stringify(result),/改/);
  assert.equal(resume.forSession({...machine,lastSnapshot:null},session).creditCarry,-100);
});
test('gateway consecutive entries preserve only display credit and export each session delta once',()=>{
  const result=spawnSync(process.execPath,['tests/fixtures/password-lifecycle.mjs'],{encoding:'utf8',timeout:30000,env:{...process.env,
    QA_CREDIT_ASSERT:'1',ADMIN_PASSWORD:'qa',SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-key',
    GOOGLE_SHEETS_WEBHOOK_URL:'https://sheets.invalid',VERTEX_ALLOWED_ORIGINS:'',VERTEX_STORE_ID:'store-debug',VERTEX_DB_SCHEMA:'public',VERTEX_ALLOW_DEBUG_MACHINE_OVERRIDE:'1',
    VERTEX_MACHINES_JSON:JSON.stringify(['one','two'].map(machineId=>({machineId,machineType:'nova',gameUrl:'https://game.invalid'})))}});
  assert.equal(result.status,0,result.stdout+result.stderr);
});
