import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioCommand} from '../debug-scenario.mjs';
const context={storeId:'store-debug',machine:{machineId:'nova-01',currentSessionId:'current'},uuid:'server-id',sortieG:15};
test('server binds reservation to current machine/session and ignores client identities',()=>{
 const c=scenarioCommand({type:'reserveDebugScenario',zoneG:300,at:true,upper:true,sortie:true,sessionId:'other',id:'spoof'},context);
 assert.equal(c.sessionId,'current');assert.equal(c.id,'server-id');assert.equal(c.sortieG,15);assert.equal(c.upper,true);
});
test('reject non-debug stores, machine 13, empty sessions and invalid zones',()=>{
 const input={type:'reserveDebugScenario',zoneG:300};
 for(const contextPatch of [{storeId:'store-local'},{machine:{machineId:'nova-13',currentSessionId:'x'}},{machine:{machineId:'nova-01'}}])assert.throws(()=>scenarioCommand(input,{...context,...contextPatch}));
 for(const zoneG of [0,99,150,900,'100'])assert.throws(()=>scenarioCommand({...input,zoneG},context));
});
test('cancellation is also session bound',()=>{assert.equal(scenarioCommand({type:'cancelDebugScenario'},context).sessionId,'current');});
