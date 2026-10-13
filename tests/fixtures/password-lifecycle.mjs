import assert from 'node:assert/strict';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url),https=require('node:https');
const policy=require('../../password-issuance.cjs');
const machines=new Map(['one','two'].map(id=>[id,{machine_id:id,current_session_id:'',current_player_name:'',reset_serial:0}]));
const passwords=new Map(),sessions=new Map(),results=[];
const collision=policy.candidate('qa-key','qa-store',{machineId:'one'},null,0);
passwords.set(collision,{password:collision,machine_id:'unrelated',player_name:'Existing',status:'issued',issued_at_ms:1});
let requests=0;
function matches(row,query){
 for(const key of ['password','machine_id','session_id','status']){
  const filter=query.get(key);if(!filter)continue;
  if(filter.startsWith('eq.')&&String(row[key]??'')!==filter.slice(3))return false;
  if(filter.startsWith('in.')&&!filter.slice(4,-1).split(',').includes(String(row[key])))return false;
 }
 const or=query.get('or');
 if(or){const ids=or.match(/session_id\.in\.\(([^)]*)\)/)?.[1]?.split(',')||[];if(row.status!=='issued'&&!ids.includes(row.session_id))return false;}
 return true;
}
function answer(url,options={},body){
 requests++;const u=new URL(url),table=u.pathname.split('/').at(-1),q=u.searchParams,method=options.method||'GET';
 const map={machine_states:machines,issued_passwords:passwords,sessions}[table];
 if(map){
  const key={machine_states:'machine_id',issued_passwords:'password',sessions:'session_id'}[table];
  let rows=[...map.values()].filter(row=>matches(row,q));
  if(method==='POST'){
   const row=JSON.parse(body),old=map.get(row[key]);
   if(old&&!q.has('on_conflict'))return {status:409,data:{code:'23505'}};
   map.set(row[key],{...old,...row});rows=[map.get(row[key])];
  }else if(method==='PATCH'){const patch=JSON.parse(body);for(const row of rows)Object.assign(row,patch);}
  else if(q.get('order')?.includes('issued_at_ms'))rows.sort((a,b)=>b.issued_at_ms-a.issued_at_ms||b.password.localeCompare(a.password));
  if(q.has('offset'))rows=rows.slice(Number(q.get('offset')));
  if(q.has('limit'))rows=rows.slice(0,Number(q.get('limit')));
  return {status:200,data:structuredClone(rows.map(row=>table==='machine_states'?{...row,ended_at_ms:row.last_ended_session?.endedAt}:row))};
 }
 if(table==='session_results'){if(method==='POST')results.push(JSON.parse(body));return {status:200,data:results};}
 if(table==='machine_commands')return {status:200,data:method==='POST'?[{id:requests,...JSON.parse(body)}]:[]};
 throw Error('Unexpected table '+table);
}
https.request=(url,options,callback)=>{
 const req=new EventEmitter();let body='';req.write=chunk=>body+=chunk;
 req.end=()=>setTimeout(()=>{const data=answer(String(url),options,body),res=new EventEmitter();res.statusCode=data.status;callback(res);res.emit('data',JSON.stringify(data.data));res.emit('end');},2);return req;
};
syncBuiltinESMExports();
globalThis.fetch=async(url,options={})=>{const out=answer(String(url),options,options.body);return new Response(JSON.stringify(out.data),{status:out.status});};
const {default:gateway}=await import('../../api/gateway.mjs');
async function request(path,body={},method='POST',admin=true){
 const req={method,query:{path},body,headers:{host:'qa.test',...(admin?{'x-admin-password':'qa'}:{})}};
 const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},end(body){this.body=JSON.parse(body);}};
 await gateway(req,res);return res;
}
const issue=(machineId,playerName)=>request('admin/issue-password',{machineId,playerName});
const current=async()=>{const res=await request('admin/passwords/current',{},'GET');assert.equal(res.statusCode,200);return res.body;};
const begin=async(password)=>{const res=await request('sessions/start',{password});assert.equal(res.statusCode,200,JSON.stringify(res.body));return res.body.session;};
assert.equal((await request('admin/passwords/current',{},'GET',false)).statusCode,401);assert.equal(requests,0);
const [a,a2,b]=await Promise.all([issue('one','Alice'),issue('one','Other admin'),issue('two','Bob')]);
for(const res of [a,a2,b])assert.equal(res.statusCode,200,JSON.stringify(res.body));
assert.equal(a.body.issued.password,a2.body.issued.password);assert.equal(a.body.issued.playerName,a2.body.issued.playerName);
assert.notEqual(a.body.issued.password,b.body.issued.password);assert.notEqual(a.body.issued.password,collision);assert.equal(passwords.size,3);
assert.equal(passwords.get(collision).player_name,'Existing');
assert.equal((await current()).find(row=>row.machineId==='one').password,a.body.issued.password);
const first=await begin(a.body.issued.password);
assert.equal((await current()).find(row=>row.machineId==='one').status,'used');
assert.equal((await issue('one','Cannot overwrite')).body.issued.playerName,a.body.issued.playerName);
const ended=await request('sessions/end',first);assert.equal(ended.statusCode,200,JSON.stringify(ended.body));
assert.equal((await current()).find(row=>row.machineId==='one').status,'available');
const again=await issue('one','Next');assert.notEqual(again.body.issued.password,a.body.issued.password);
assert.equal((await request('sessions/start',{password:a.body.issued.password})).statusCode,403);
assert.equal((await request('admin/machines/one/reset')).statusCode,200);
assert.equal((await current()).find(row=>row.machineId==='one').status,'available');
assert.equal((await request('sessions/start',{password:again.body.issued.password})).statusCode,403);
const unused=await issue('one','Unused');
assert.equal((await request('admin/machines/one/force-end')).body.released,true);
assert.equal((await current()).find(row=>row.machineId==='one').status,'available');
assert.equal((await request('sessions/start',{password:unused.body.issued.password})).statusCode,403);
const last=await issue('one','Force');await begin(last.body.issued.password);
assert.equal((await request('admin/machines/one/force-end')).statusCode,200);
assert.equal((await current()).find(row=>row.machineId==='one').status,'available');
for(let i=0;i<100;i++)passwords.set('old'+i,{password:'old'+i,machine_id:'one',status:'ended',issued_at_ms:Date.now()+i});
assert.equal((await current()).find(row=>row.machineId==='two').password,b.body.issued.password);
console.log('Concurrent issuance, current list, start/end, unused cancellation, reset, force-end and historical passwords verified.');
