import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
import {createCustomerAuth,enabled,hashPassword,verifyPassword} from '../customer-auth.mjs';
test('pilot is debug-only and default-off; only private 13 is added',()=>{
  for(const store of ['store-debug','store-las-vegas','store-jag-one'])for(const flag of ['0','1']){
    const env={...process.env,VERTEX_STORE_ID:store,CUSTOMER_LOGIN_PILOT:flag};
    assert.equal(enabled(env),store==='store-debug'&&flag==='1');
    const p=spawnSync(process.execPath,['-e','console.log(JSON.stringify(require("./machine-config.cjs").MACHINE_DEFINITIONS))'],{env,cwd:new URL('../',import.meta.url),encoding:'utf8'});
    assert.equal(p.status,0,p.stderr);const ms=JSON.parse(p.stdout);assert.equal(ms.some(m=>m.machineId==='nova-13'),enabled(env));
    if(store==='store-debug')assert.equal(ms.length,enabled(env)?13:12);
  }
});
test('customer floor accepts 13 live debug seats and rejects unknown seats',async()=>{
 const source=fs.readFileSync(new URL('../nebula-machines.html',import.meta.url),'utf8');
 for(const count of [12,13,14]){
  const config={storeId:'store-debug',machineCount:count};
  const rows=Array.from({length:count},(_,i)=>({storeId:'store-debug',machineId:'nova-'+String(i+1).padStart(2,'0'),machineType:'nova'}));
  const elements=new Map();const ctx=vm.createContext({loading:false,machines:[],fresh:false,lastUpdate:0,AbortSignal,Date,render(){},$:(id)=>{if(!elements.has(id))elements.set(id,{setAttribute(){}});return elements.get(id);},fetch:async(url)=>({ok:true,json:async()=>url==='/api/config'?config:rows})});
  vm.runInContext(source.match(/async function load\(\)\{[^]*?\n}/)[0],ctx);await ctx.load();assert.equal(ctx.fresh,count<=13);
 }
});
test('live machine 13 exports settlement with the same positive-profit gap',async()=>{
 const source=fs.readFileSync(new URL('../api/index.mjs',import.meta.url),'utf8');const sent=[];
 const ctx=vm.createContext({SHEETS_WEBHOOK_URL:'https://sheets.invalid',sheetsSettlementPolicy:{sheetsSettlement:r=>({...r,playerProfit:r.playerProfit*0.9})},postJson:async(url,record)=>{sent.push(record);return {status:200};}});
 vm.runInContext(source.match(/async function sendToSheets\(record\)\{[^]*?\n}/)[0],ctx);
 const result=await ctx.sendToSheets({storeId:'store-debug',machineId:'nova-13',machineType:'nova',playerProfit:1000});assert.equal(result.ok,true);assert.equal(sent[0].playerProfit,900);
});
test('credentials are hashed; customer login cannot start existing customer machines',async()=>{
 const hash=await hashPassword('Test-pass123');assert.equal(await verifyPassword('Test-pass123',hash),true);assert.equal(await verifyPassword('WRONG-pass123',hash),false);
 let claims=0;const auth=createCustomerAuth({env:{VERTEX_STORE_ID:'store-debug',CUSTOMER_LOGIN_PILOT:'1'},repo:{consume:async()=>true,find:async()=>({password_hash:hash,enabled:true}),claim:async()=>{claims++;return {ok:true};}}});
 await assert.rejects(auth.start({userId:'testuser',password:'Test-pass123',requestedMachineId:'nova-01'}));assert.equal(claims,0);
 assert.equal((await auth.start({userId:'testuser',password:'Test-pass123',requestedMachineId:'nova-13'})).ok,true);
});
test('customer registration remains admin-only before accessing storage',async()=>{
 const {default:gateway}=await import('../api/gateway.mjs');
 for(const path of ['admin/customer-pilot','admin/customer-pilot/register']){
  const req={method:path.startsWith('admin')?'GET':'POST',query:{path},headers:{},body:{requestedMachineId:'nova-13'}};
  const res={setHeader(){},end(body){this.body=body;}};await gateway(req,res);assert.ok([401,403,503].includes(res.statusCode));
 }
});
