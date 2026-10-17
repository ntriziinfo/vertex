import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
test('real gateway records speed use separately from issued permission, with daily retained history',()=>{
 const result=spawnSync(process.execPath,['tests/fixtures/password-lifecycle.mjs'],{encoding:'utf8',timeout:30000,env:{...process.env,QA_SPEED_ASSERT:'1',ADMIN_PASSWORD:'qa',SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-key',GOOGLE_SHEETS_WEBHOOK_URL:'',VERTEX_ALLOWED_ORIGINS:'',VERTEX_STORE_ID:'qa-store',VERTEX_DB_SCHEMA:'public',VERTEX_MACHINES_JSON:JSON.stringify(['one','two'].map(machineId=>({machineId,machineType:'nova',gameUrl:'https://game.invalid'})))}});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
test('entry page coalesces usage messages, retries failures, and records new sessions and days',async()=>{
 const src=fs.readFileSync('play.html','utf8'),fn=src.match(/async function recordSuperSpeedUsage\([^]*?\n}/)[0];
 let now=Date.parse('2026-10-17T14:59:00Z'),calls=0,fail=true,resolve;
 class Clock extends Date{static now(){return now;}}
 const c=vm.createContext({Date:Clock,active:{sessionId:'one',token:'secret'},endingSession:false,speedUsageRecorded:new Set(),speedUsagePending:new Set(),speedUsageRetry:new Map(),AbortSignal,
   fetch:async()=>{calls++;await new Promise(r=>resolve=r);return {ok:!fail,json:async()=>({ok:!fail})};}});
 vm.runInContext(fn,c);
 const pending=c.recordSuperSpeedUsage();await c.recordSuperSpeedUsage();assert.equal(calls,1);resolve();await pending;
 await c.recordSuperSpeedUsage();assert.equal(calls,1);
 now+=10001;fail=false;let work=c.recordSuperSpeedUsage();resolve();await work;
 await c.recordSuperSpeedUsage();assert.equal(calls,2);
 now+=60000;work=c.recordSuperSpeedUsage();resolve();await work;assert.equal(calls,3);
 c.active={sessionId:'two',token:'new'};work=c.recordSuperSpeedUsage();resolve();await work;assert.equal(calls,4);
 c.endingSession=true;await c.recordSuperSpeedUsage();assert.equal(calls,4);
});
