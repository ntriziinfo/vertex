import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
test('credentials are hashed; customer login cannot start existing customer machines',async()=>{
 const hash=await hashPassword('Test-pass123');assert.equal(await verifyPassword('Test-pass123',hash),true);assert.equal(await verifyPassword('WRONG-pass123',hash),false);
 let claims=0;const auth=createCustomerAuth({env:{VERTEX_STORE_ID:'store-debug',CUSTOMER_LOGIN_PILOT:'1'},repo:{consume:async()=>true,find:async()=>({password_hash:hash,enabled:true}),claim:async()=>{claims++;return {ok:true};}}});
 await assert.rejects(auth.start({userId:'testuser',password:'Test-pass123',requestedMachineId:'nova-01'}));assert.equal(claims,0);
 assert.equal((await auth.start({userId:'testuser',password:'Test-pass123',requestedMachineId:'nova-13'})).ok,true);
});
test('private page and private login reject anonymous requests before accessing storage',async()=>{
 const {default:gateway}=await import('../api/gateway.mjs');
 for(const path of ['admin/customer-pilot','sessions/start']){
  const req={method:path.startsWith('admin')?'GET':'POST',query:{path},headers:{},body:{requestedMachineId:'nova-13'}};
  const res={setHeader(){},end(body){this.body=body;}};await gateway(req,res);assert.ok([401,403,503].includes(res.statusCode));
 }
});
