import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createCustomerAuth} from '../customer-auth.mjs';

test('sheet sync saves A-column name, preserves omitted names and permits clearing',async()=>{
 let account={password_hash:'unchanged',display_name:'旧名'};
 const auth=createCustomerAuth({env:{VERTEX_STORE_ID:'store-debug',CUSTOMER_LOGIN_PILOT:'1',CUSTOMER_SYNC_SECRET:'x'.repeat(32)},repo:{find:async()=>account,save:async a=>{account=a;}}});
 for(const [extra,expected]of [[{displayName:' 任意名 '},'任意名'],[{},'任意名'],[{displayName:''},'']]){
  await auth.sync({userId:'user001',status:'有効',...extra},'x'.repeat(32));
  assert.equal(account.display_name,expected);assert.equal(account.password_hash,'unchanged');
 }
});
test('settlement resolves names through server session association without changing ID or amounts',async()=>{
 const source=fs.readFileSync('api/index.mjs','utf8');
 let enabled=true,linked=true,name='任意名';const calls=[];
 const c=vm.createContext({customerLoginEnabled:()=>enabled,sb:async path=>{
  calls.push(path);return path.startsWith('customer_sessions?')?(linked?[{user_id:'user001'}]:[]):[{display_name:name}];
 }});
 vm.runInContext(source.match(/async function customerSettlementRecord\(record\)\{[^]*?\n}/)[0],c);
 const record={storeId:'store-debug',sessionId:'session001',playerName:'client-spoof',playerProfit:2345,totalSpins:4567};
 const before=JSON.stringify(record);
 for(const value of ['任意名','変更後の名前','']){
  name=value;const result=await c.customerSettlementRecord(record);
  assert.equal(result.playerName,value||'user001');assert.equal(result.customerUserId,'user001');
  assert.equal(result.playerProfit,2345);assert.equal(result.totalSpins,4567);
 }
 assert.equal(JSON.stringify(record),before);
 linked=false;assert.equal(await c.customerSettlementRecord(record),record);
 enabled=false;const n=calls.length;assert.equal(await c.customerSettlementRecord(record),record);assert.equal(calls.length,n);
 enabled=true;const other={...record,storeId:'store-las-vegas'};assert.equal(await c.customerSettlementRecord(other),other);assert.equal(calls.length,n);
 assert.equal((source.match(/const record = await customerSettlementRecord\(/g)||[]).length,3);
});
