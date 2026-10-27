import test from 'node:test';
import assert from 'node:assert/strict';
import {password,createCustomerAuth} from '../customer-auth.mjs';

test('customer passwords accept 4..128 characters and reject shorter/longer values',()=>{
 for(const value of ['1234','abcd','abc1234','Existing-pass123','x'.repeat(128)])assert.equal(password(value),value);
 for(const value of ['', '123', 'x'.repeat(129),null,1234])assert.throws(()=>password(value),/4〜128/);
});

test('sheet registration and login support four characters, retain existing longer passwords',async()=>{
 const accounts=new Map();let claims=0;
 const auth=createCustomerAuth({env:{VERTEX_STORE_ID:'store-debug',CUSTOMER_LOGIN_PILOT:'1',CUSTOMER_SYNC_SECRET:'s'.repeat(32)},repo:{
  consume:async()=>true,find:async id=>accounts.get(id),
  save:async row=>accounts.set(row.user_id,row),
  claim:async()=>{claims++;return {ok:true};}
 }});
 for(const [userId,pass] of [['four','1234'],['existing','Existing-pass123']]){
  await auth.sync({userId,password:pass,status:'有効',displayName:'テスト'},'s'.repeat(32));
  assert.notEqual(accounts.get(userId).password_hash,pass);
  assert.equal((await auth.start({userId,password:pass,requestedMachineId:'nova-01'})).ok,true);
 }
 await assert.rejects(auth.start({userId:'four',password:'4321',requestedMachineId:'nova-01'}),/確認/);
 await assert.rejects(auth.sync({userId:'short',password:'123',status:'有効'},'s'.repeat(32)),/4〜128/);
 assert.equal(accounts.has('short'),false);
 assert.equal(claims,2);
});
