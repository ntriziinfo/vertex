import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
const {sheetsSettlement}=createRequire(import.meta.url)('../sheets-settlement.cjs');

test('NEBULA exports full positive player profit without deduction and preserves raw counters',()=>{
 for(const storeId of ['store-debug','store-nebula']){
  for(const [raw,net] of [[1000,1000],[101,101],[10,10],[1,1],[0,0],[-1,-1],[-1000,-1000]]){
   const record=Object.freeze({storeId,machineType:'nova',playerProfit:raw,profit:raw+500,playerTotalFee:3000,playerTotalPaid:3000+raw,billingBasis:'playerProfit',stats:Object.freeze({totalFee:3300,totalPaid:3800+raw})});
   const sent=sheetsSettlement(record);
   assert.equal(sent.playerProfit,net);assert.equal(record.playerProfit,raw);
   assert.equal(sent.profit,raw+500);assert.equal(sent.playerTotalPaid,3000+raw);assert.equal(sent.stats,record.stats);
   assert.equal(sent.rawPlayerProfit,undefined);assert.equal(sent.exchangeGapPt,undefined);assert.equal(sent.exchangeGapRate,undefined);
   assert.equal(sent,record);
   assert.deepEqual(sheetsSettlement(record),sent);
  }
 }
});

test('other stores, non-NOVA machines and invalid profit never receive a deduction',()=>{
 for(const storeId of ['store-jag-one','store-las-vegas','store-local','store-other']){
  for(const machineType of ['nova','rising','jackspot']){
   const record={storeId,machineType,playerProfit:1000};assert.equal(sheetsSettlement(record),record);
  }
 }
 for(const record of [{storeId:'store-debug',machineType:'jackspot',playerProfit:1000},...[undefined,NaN,Infinity].map(playerProfit=>({storeId:'store-debug',machineType:'nova',playerProfit}))])assert.equal(sheetsSettlement(record),record);
});

test('standalone server also adjusts only the outbound Sheets payload',async()=>{
 const source=fs.readFileSync('server.js','utf8'),sent=[];
 const context=vm.createContext({SHEETS_WEBHOOK_URL:'https://sheets.invalid',sheetsSettlement,postJson:async(url,record)=>{sent.push(record);return {status:200};}});
 vm.runInContext(source.match(/async function sendToSheets\([^]*?\n}/)[0],context);
 const record={storeId:'store-debug',machineType:'nova',playerProfit:1000};
 assert.equal((await context.sendToSheets(record)).ok,true);assert.equal(sent[0].playerProfit,1000);assert.equal(record.playerProfit,1000);
});

for(const storeId of ['store-debug','store-nebula','store-jag-one','store-las-vegas']){
 test(`Sheets end-to-end export isolation: ${storeId}`,()=>{
  const result=spawnSync(process.execPath,['tests/fixtures/password-lifecycle.mjs'],{encoding:'utf8',timeout:30000,env:{...process.env,CUSTOMER_LOGIN_PILOT:'0',CUSTOMER_PILOT_DISPLAY:'0',QA_SHEETS_ASSERT:'1',ADMIN_PASSWORD:'qa',SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-key',GOOGLE_SHEETS_WEBHOOK_URL:'https://sheets.invalid/exec',VERTEX_ALLOWED_ORIGINS:'',VERTEX_STORE_ID:storeId,VERTEX_DB_SCHEMA:storeId==='store-nebula'?'vertex_nebula':'public',VERTEX_ALLOW_DEBUG_MACHINE_OVERRIDE:'',VERTEX_MACHINES_JSON:JSON.stringify(['one','two'].map(machineId=>({machineId,machineType:'nova',gameUrl:'https://game.invalid'})))}});
  assert.equal(result.status,0,result.stderr||result.stdout);
 });
}
