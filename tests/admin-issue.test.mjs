import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const src=fs.readFileSync('admin.html','utf8'),fn=name=>src.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0];
test('separate machine cards issue in parallel and responses never replace another customer code',async()=>{
 const elements=new Map(),requests=[];
 const c=vm.createContext({passwordIssues:new Map(),AbortSignal,adminHeaders:()=>({}),loadPasswords:async()=>{},
  $:id=>{if(!elements.has(id))elements.set(id,{value:'',focus(){}});return elements.get(id);},
  fetch:(url,options)=>new Promise(resolve=>requests.push({url,body:JSON.parse(options.body),resolve}))});
 for(const name of ['rememberPasswordDraft','setPasswordIssue','issue'])vm.runInContext(fn(name),c);
 c.$('player-name-one').value='Alice';c.$('player-name-two').value='Bob';
 const a=c.issue('one'),b=c.issue('two');await c.issue('one');
 assert.equal(requests.length,2);assert(c.$('issue-controls-one').disabled);assert(c.$('issue-controls-two').disabled);
 assert.deepEqual(requests.map(r=>r.body),[{machineId:'one',playerName:'Alice'},{machineId:'two',playerName:'Bob'}]);
 requests[1].resolve({ok:true,json:async()=>({ok:true,issued:{password:'BBBBBB'}})});await b;
 assert.equal(c.$('issue-code-two').textContent,'BBBBBB');assert.equal(c.$('issue-code-one').textContent,'');
 requests[0].resolve({ok:true,json:async()=>({ok:true,issued:{password:'AAAAAA'}})});await a;
 assert.equal(c.$('issue-code-one').textContent,'AAAAAA');assert.match(c.$('issue-status-one').textContent,/Alice/);
 assert.equal(c.passwordIssues.get('two').playerName,'Bob');assert.equal(c.passwordIssues.get('two').password,'BBBBBB');
});
test('failed issue unlocks only that card and preserves the entered name',async()=>{
 const elements=new Map();const c=vm.createContext({passwordIssues:new Map(),AbortSignal,adminHeaders:()=>({}),loadPasswords:async()=>{},
  $:id=>{if(!elements.has(id))elements.set(id,{value:'Alice',focus(){}});return elements.get(id);},fetch:async()=>{throw new TypeError('network');}});
 for(const name of ['rememberPasswordDraft','setPasswordIssue','issue'])vm.runInContext(fn(name),c);
 await c.issue('one');assert.equal(c.$('issue-controls-one').disabled,false);assert.equal(c.passwordIssues.get('one').playerName,'Alice');assert.match(c.$('issue-status-one').textContent,/発行済み一覧/);
});
test('global completion change excludes unsupported machines and sends no setting numbers',async()=>{
 const machines=[{machineId:'one',capabilities:{completeLimit:true},settings:{setting:6}},{machineId:'two',capabilities:{completeLimit:true},settings:{setting:3}},{machineId:'jack',capabilities:{completeLimit:false}}],calls=[];
 const c=vm.createContext({liveMachines:()=>machines,bulkCompleteDirty:true,fmt:String,confirm:()=>true,
  $:()=>({value:'22000',reportValidity:()=>true}),syncCompleteLimitControl(){},submitMachineUpdate:async(id,action,body)=>calls.push({id,action,body:JSON.parse(JSON.stringify(body))}),
  runBulkOperation:async(label,op,targets)=>{await Promise.all(targets.map(op));return true;}});
 for(const name of ['completeLimitTargets','applyBulkCompleteLimit'])vm.runInContext(fn(name),c);
 await c.applyBulkCompleteLimit();assert.deepEqual(calls,[{id:'one',action:'setting',body:{completeLimitPt:22000}},{id:'two',action:'setting',body:{completeLimitPt:22000}}]);assert.equal(c.bulkCompleteDirty,false);
});
test('concurrent server issuance retries code collisions without overwriting existing passwords',()=>{
 const probe=String.raw`
 import assert from 'node:assert/strict';import {createRequire,syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';
 const require=createRequire(import.meta.url),https=require('node:https'),crypto=require('node:crypto');
 let randomCalls=0;crypto.randomInt=()=>{const group=Math.floor(randomCalls++/6);return group<2?0:group;};
 const rows=new Map([['AAAAAA',{password:'AAAAAA',player_name:'Existing',machine_id:'one'}]]);let requests=0;
 https.request=(url,options,callback)=>{
  const req=new EventEmitter();let body='';req.write=c=>body+=c;req.end=()=>setTimeout(()=>{
   assert.equal(new URL(url).pathname,'/rest/v1/issued_passwords');assert.equal(new URL(url).search,'');assert.equal(options.method,'POST');requests++;
   const row=JSON.parse(body),res=new EventEmitter(),collision=rows.has(row.password);res.statusCode=collision?409:201;
   if(!collision)rows.set(row.password,row);callback(res);res.emit('data',JSON.stringify(collision?{code:'23505'}:[row]));res.emit('end');
  },10);return req;
 };syncBuiltinESMExports();
 const {default:gateway}=await import('./api/gateway.mjs');
 async function issue(machineId,playerName,admin=true){const req={method:'POST',query:{path:'admin/issue-password'},body:{machineId,playerName},headers:{host:'qa.test',...(admin?{'x-admin-password':'qa'}:{})}};const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},end(body){this.body=JSON.parse(body);}};await gateway(req,res);return res;}
 assert.equal((await issue('one','Bad',false)).statusCode,401);assert.equal(requests,0);
 const issued=await Promise.all([issue('one','Alice'),issue('two','Bob')]);assert(issued.every(r=>r.statusCode===200));
 assert.notEqual(issued[0].body.issued.password,issued[1].body.issued.password);assert.equal(rows.size,3);assert.equal(rows.get('AAAAAA').player_name,'Existing');
 assert.equal(rows.get(issued[0].body.issued.password).player_name,'Alice');assert.equal(rows.get(issued[1].body.issued.password).machine_id,'two');assert.equal(requests,4);
 `;
 const result=spawnSync(process.execPath,['--input-type=module','-e',probe],{encoding:'utf8',env:{...process.env,ADMIN_PASSWORD:'qa',SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-key',VERTEX_STORE_ID:'qa-store',VERTEX_DB_SCHEMA:'public',VERTEX_MACHINES_JSON:JSON.stringify(['one','two'].map(machineId=>({machineId,machineType:'nova',gameUrl:'https://game.invalid'})))}});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
