import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {deliver,createDeliveryWorker} from '../settlement-delivery.mjs';
import {verifySnapshot} from '../snapshot-integrity.mjs';
test('Sheets follows only ContentService with GET and requires matching receipt',async()=>{
 const calls=[];const fetchImpl=async(u,o)=>{calls.push([u,o]);return calls.length===1?new Response('',{status:302,headers:{location:'https://script.googleusercontent.com/macros/echo?receipt=x'}}):Response.json({ok:true,sessionId:'s'});};
 assert.equal((await deliver('https://script.google.com/macros/s/x/exec',{sessionId:'s'},{fetchImpl})).ok,true);
 assert.equal(calls[1][1].method,'GET');assert.equal(calls[1][1].body,undefined);assert.equal(calls[1][1].headers,undefined);
 assert.equal((await deliver('https://script.google.com/macros/s/x/exec',{sessionId:'s'},{fetchImpl:async()=>Response.json({ok:true,sessionId:'other'})})).ok,false);
 assert.equal((await deliver('https://script.google.com/macros/s/x/exec',{sessionId:'s'},{fetchImpl:async()=>new Response('',{status:302,headers:{location:'https://other.invalid/x'}})})).ok,false);
});
test('delivery claim is acknowledged with same lease, errors remain pending',async()=>{
 const calls=[];let claimed=false;
 const worker=createDeliveryWorker({sb:async(p,o)=>{const b=JSON.parse(o.body);calls.push([p,b]);if(p.endsWith('nova_claim_settlement')){if(claimed)return [];claimed=true;return [{session_id:'s',record:{sessionId:'s'},attempts:1}];}return true;},send:async()=>{throw Error('offline');}});
 const r=await worker.drain();assert.equal(r.length,1);assert.equal(r[0].pending,true);assert.equal(calls[0][1].p_token,calls[1][1].p_token);assert.equal(calls[1][1].p_ok,false);
});
test('snapshot arithmetic, malformed values and future timestamps cannot be accepted',()=>{
 const good={playSessionId:'s',capturedAt:100,stats:{totalSpins:100,totalFee:300,totalPaid:350,profit:50}};
 assert.equal(verifySnapshot(good,{now:100}).ok,true);
 for(const stats of [{totalPaid:-1},{totalSpins:1.5},{totalFee:NaN},{profit:55}])assert.equal(verifySnapshot({...good,stats:{...good.stats,...stats}}).ok,false);
 assert.equal(verifySnapshot({...good,capturedAt:300101},{now:100}).ok,false);
 assert.equal(verifySnapshot(good,{previous:{...good,capturedAt:101}}).stale,true);
 assert.equal(verifySnapshot({...good,playSessionStartStats:{totalPaid:400}}).ok,false);
});
function sheetMock(){
 const cells=new Map(),writes=[];let crashColumn=0;
 const key=(r,c)=>r+':'+c;
 return {cells,writes,set crashColumn(c){crashColumn=c;},getLastRow(){return Math.max(3,...[...cells.keys()].map(k=>Number(k.split(':')[0])));},getRange(r,c,h=1,w=1){return {
 getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>cells.get(key(r+i,c+j))??'')),
 getDisplayValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>String(cells.get(key(r+i,c+j))??''))),
 getValue:()=>cells.get(key(r,c))??'',setValue(v){cells.set(key(r,c),v);writes.push({r,c,w:1});if(crashColumn===c){crashColumn=0;throw Error('injected crash');}},
 setValues(a){for(let i=0;i<h;i++)for(let j=0;j<w;j++)cells.set(key(r+i,c+j),a[i][j]);writes.push({r,c,w});if(crashColumn===c){crashColumn=0;throw Error('injected crash');}}
 };}};
}
test('Apps Script resumes reserved row after failure and never duplicates result or cash fee',()=>{
 const sheet=sheetMock(),cash=sheetMock();let locked=false;
 const ctx=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>n==='results'?sheet:cash}),flush(){}},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true;},releaseLock(){locked=false;}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}});
 vm.runInContext(fs.readFileSync('sheets-webhook.gs','utf8'),ctx);
 const data={sessionId:'qa-s',storeId:'store-debug',machineType:'nova',endedAt:'2026-11-04',playerName:'QA',superSpeedUsage:[{businessDate:'2026/11/04',usedAt:'12:00'}]};
 const call=()=>ctx.doPost({postData:{contents:JSON.stringify(data)}});
 sheet.crashColumn=22;assert.throws(call,/injected/);assert.equal(locked,false);
 sheet.crashColumn=1;assert.throws(call,/injected/);assert.equal(locked,false);
 assert.equal(call().duplicate,true);assert.equal(call().duplicate,true);
 assert.equal(sheet.getLastRow(),4);assert.equal(cash.getLastRow(),5);
 assert.ok(sheet.writes.every(x=>x.c===22||x.c===1&&x.w===17),'formula columns untouched');
 assert.equal(cash.getRange(5,3).getValue(),1000000);
});
