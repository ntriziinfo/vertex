import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const src=fs.readFileSync('admin.html','utf8'),fn=name=>src.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0];
test('separate machine cards issue in parallel and responses never replace another customer code',async()=>{
 const elements=new Map(),requests=[];
 const c=vm.createContext({passwordIssues:new Map(['one','two'].map(id=>[id,{loaded:true}])),passwordCurrentRequest:0,machineOperations:new Map(),machineRows:()=>[],renderCurrentPasswordList(){},escapeHtml:String,AbortSignal,adminHeaders:()=>({}),loadPasswords:async()=>{},loadCurrentPasswords:async()=>{},
  $:id=>{if(!elements.has(id))elements.set(id,{value:'',focus(){}});return elements.get(id);},
  fetch:(url,options)=>new Promise(resolve=>requests.push({url,body:JSON.parse(options.body),resolve}))});
 for(const name of ['passwordIssueMarkup','rememberPasswordDraft','setPasswordIssue','issue'])vm.runInContext(fn(name),c);
 c.$('player-name-one').value='Alice';c.$('player-name-two').value='Bob';
 const a=c.issue('one'),b=c.issue('two');await c.issue('one');
 assert.equal(requests.length,2);assert(c.passwordIssues.get('one').busy);assert(c.passwordIssues.get('two').busy);
 assert.deepEqual(requests.map(r=>r.body),[{machineId:'one',playerName:'Alice'},{machineId:'two',playerName:'Bob'}]);
 requests[1].resolve({ok:true,json:async()=>({ok:true,issued:{machineId:'two',playerName:'Bob',status:'issued',password:'BBBBBB'}})});await b;
 assert.equal(c.passwordIssues.get('two').current.password,'BBBBBB');assert.equal(c.passwordIssues.get('one').current,undefined);
 requests[0].resolve({ok:true,json:async()=>({ok:true,issued:{machineId:'one',playerName:'Alice',status:'issued',password:'AAAAAA'}})});await a;
 assert.match(c.$('issue-controls-one').outerHTML,/Alice/);assert.match(c.$('issue-controls-one').outerHTML,/AAAAAA/);assert.doesNotMatch(c.$('issue-controls-one').outerHTML,/<input/);
 assert.equal(c.passwordIssues.get('two').current.playerName,'Bob');await c.issue('one');assert.equal(requests.length,2);
});
test('uncertain issue blocks retries until a server refresh and preserves the entered name',async()=>{
 const elements=new Map();const c=vm.createContext({passwordIssues:new Map([['one',{loaded:true}]]),passwordCurrentRequest:0,machineOperations:new Map(),machineRows:()=>[],renderCurrentPasswordList(){},escapeHtml:String,AbortSignal,adminHeaders:()=>({}),loadPasswords:async()=>{},loadCurrentPasswords:async()=>{},
  $:id=>{if(!elements.has(id))elements.set(id,{value:'Alice',focus(){}});return elements.get(id);},fetch:async()=>{throw new TypeError('network');}});
 for(const name of ['passwordIssueMarkup','rememberPasswordDraft','setPasswordIssue','issue'])vm.runInContext(fn(name),c);
 await c.issue('one');assert.equal(c.passwordIssues.get('one').loaded,false);assert.equal(c.passwordIssues.get('one').playerName,'Alice');assert.match(c.$('issue-controls-one').outerHTML,/disabled/);
});
test('global completion change excludes unsupported machines and sends no setting numbers',async()=>{
 const machines=[{machineId:'one',capabilities:{completeLimit:true},settings:{setting:6}},{machineId:'two',capabilities:{completeLimit:true},settings:{setting:3}},{machineId:'jack',capabilities:{completeLimit:false}}],calls=[];
 const c=vm.createContext({liveMachines:()=>machines,bulkCompleteDirty:true,fmt:String,confirm:()=>true,
  $:()=>({value:'22000',reportValidity:()=>true}),syncCompleteLimitControl(){},submitMachineUpdate:async(id,action,body)=>calls.push({id,action,body:JSON.parse(JSON.stringify(body))}),
  runBulkOperation:async(label,op,targets)=>{await Promise.all(targets.map(op));return true;}});
 for(const name of ['completeLimitTargets','applyBulkCompleteLimit'])vm.runInContext(fn(name),c);
 await c.applyBulkCompleteLimit();assert.deepEqual(calls,[{id:'one',action:'setting',body:{completeLimitPt:22000}},{id:'two',action:'setting',body:{completeLimitPt:22000}}]);assert.equal(c.bulkCompleteDirty,false);
});
test('polling adopts other administrators, releases ended passwords and rejects stale responses',async()=>{
 const requests=[],elements=new Map(),states=new Map([['one',{loaded:true,current:{machineId:'one',password:'OLD',playerName:'A',status:'issued'}}],['two',{loaded:true,playerName:'Draft'}]]);
 const c=vm.createContext({passwordIssues:states,passwordCurrentRequest:0,passwordCurrentLoading:false,adminSecret:'qa',AbortSignal,
  machineOperations:new Map(),machineRows:()=>[],liveMachines:()=>[{machineId:'one'},{machineId:'two'}],escapeHtml:String,renderCurrentPasswordList(){},adminHeaders:()=>({}),
  $:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},fetch:()=>new Promise(resolve=>requests.push(resolve))});
 for(const name of ['passwordIssueMarkup','setPasswordIssue','clearPasswordIssue','loadCurrentPasswords'])vm.runInContext(fn(name),c);
 const old=c.loadCurrentPasswords();c.clearPasswordIssue('one');c.setPasswordIssue('one',{current:{machineId:'one',password:'NEW',playerName:'B',status:'issued'}});
 requests.shift()({ok:true,json:async()=>[{machineId:'one',password:'OLD',status:'issued'}]});await old;
 assert.equal(states.get('one').current.password,'NEW');
 const update=c.loadCurrentPasswords();requests.shift()({ok:true,json:async()=>[{machineId:'one',password:'LATEST',playerName:'C',status:'used'},{machineId:'two',status:'available'}]});await update;
 assert.equal(states.get('one').current.password,'LATEST');assert.match(c.$('issue-controls-one').outerHTML,/遊技中/);assert.equal(states.get('two').playerName,'Draft');
 const end=c.loadCurrentPasswords();requests.shift()({ok:true,json:async()=>[{machineId:'one',status:'available'},{machineId:'two',status:'available'}]});await end;
 assert.equal(states.get('one').current,null);assert.match(c.$('issue-controls-one').outerHTML,/<input/);assert.doesNotMatch(c.$('issue-controls-one').outerHTML,/LATEST/);
 const fail=c.loadCurrentPasswords();requests.shift()({ok:false,json:async()=>({error:'unavailable'})});await fail;
 assert.equal(states.get('one').loaded,false);assert.match(c.$('issue-controls-one').outerHTML,/disabled/);
});
test('server password lifecycle and simultaneous administrators',()=>{
 const result=spawnSync(process.execPath,['tests/fixtures/password-lifecycle.mjs'],{encoding:'utf8',env:{...process.env,ADMIN_PASSWORD:'qa',SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-key',GOOGLE_SHEETS_WEBHOOK_URL:'',VERTEX_ALLOWED_ORIGINS:'',VERTEX_STORE_ID:'qa-store',VERTEX_DB_SCHEMA:'public',VERTEX_MACHINES_JSON:JSON.stringify(['one','two'].map(machineId=>({machineId,machineType:'nova',gameUrl:'https://game.invalid'})))}});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
