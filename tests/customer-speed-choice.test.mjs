import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomerAuth,hashPassword} from '../customer-auth.mjs';
import activity from '../super-speed-activity.cjs';
test('speed selection is passed only after authentication and only accepts boolean',async()=>{
 const hash=await hashPassword('abcd');let claims=[];
 const auth=createCustomerAuth({env:{VERTEX_STORE_ID:'store-debug',CUSTOMER_LOGIN_PILOT:'1'},repo:{consume:async()=>true,find:async()=>({password_hash:hash,enabled:true}),claim:async x=>{claims.push(x);return {ok:true};}}});
 const body={userId:'testuser',password:'abcd',requestedMachineId:'nova-01'};
 for(const flag of [true,false,undefined])await auth.start({...body,superSpeedAllowed:flag});
 assert.deepEqual(claims.map(x=>x.superSpeedAllowed),[true,false,false]);
 await assert.rejects(auth.start({...body,superSpeedAllowed:'true'}));
 await assert.rejects(auth.start({...body,password:'wrong',superSpeedAllowed:true}));assert.equal(claims.length,3);
});
test('ID login usage events from different sessions do not collide',()=>{
 const a=activity.event('','nova-01','a','used',1793070000000,'session-a');
 const b=activity.event('','nova-02','b','used',1793070000000,'session-b');
 assert.notEqual(a.id,b.id);assert.equal(a.id,activity.event('','nova-01','a','used',1793070000000,'session-a').id);
});
