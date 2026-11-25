import test from 'node:test';
import assert from 'node:assert/strict';
import rate from '../point-rate.cjs';
import {sanitizePublicMachine} from '../api/gateway.mjs';
test('three permitted rates; arbitrary client values are rejected',()=>{
 for(const n of [500,1000,2000])assert.equal(rate.validate(n),n);
 for(const n of [0,1,750,'500',null,NaN])assert.throws(()=>rate.validate(n));
});
test('rate remains locked between customers and unlocks at reset serial change',()=>{
 const m={resetSerial:3,capabilities:{pointRate:500,pointRateResetSerial:3}};
 assert.deepEqual(rate.machineRate(m),{pointRate:500,pointRateLocked:true});
 assert.equal(rate.machineRate({...m,currentSessionId:''}).pointRateLocked,true);
 assert.deepEqual(rate.machineRate({...m,resetSerial:4}),{pointRate:2000,pointRateLocked:false});
});
test('old sessions keep 2000; session rate survives later cabinet reset/change',()=>{
 assert.equal(rate.settlementRate({}),2000);
 for(const n of [500,1000,2000])assert.equal(rate.settlementRate({startSnapshot:{pointRate:n}})*123,123*n);
});
test('customer machine listing exposes the locked rate without exposing session identity',()=>{
 const m=sanitizePublicMachine({machineId:'nova-01',locked:true,currentSessionId:'private',pointRate:1000,pointRateLocked:true});
 assert.equal(m.pointRate,1000);assert.equal(m.pointRateLocked,true);assert.equal(m.currentSessionId,'active');
});
