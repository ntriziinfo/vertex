import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

test('local server reload keeps admin permission while refreshing static capabilities',()=>{
 const c=vm.createContext({ensureDataDir(){},STATE_FILE:'qa',state:{},machines:new Map(),emptyMachine:()=>({}),
  fs:{readFileSync:()=>JSON.stringify({machines:{'nova-01':{capabilities:{superSpeedAllowed:true},assignedSetting:4}}})},
  MACHINE_DEFINITIONS:[{machineId:'nova-01',capabilities:{completeLimit:true}}]});
 vm.runInContext(fs.readFileSync('server.js','utf8').match(/function loadState\(\)\{[^]*?\n\}/)[0]+'\nloadState();',c);
 assert.equal(c.machines.get('nova-01').capabilities.superSpeedAllowed,true);
 assert.equal(c.machines.get('nova-01').capabilities.completeLimit,true);
 assert.equal(c.machines.get('nova-01').assignedSetting,4);
});

test('admin-only permission persists independently of stale snapshots and resets; polling always returns it',()=>{
 const probe=String.raw`
 import assert from 'node:assert/strict';
 import {createRequire,syncBuiltinESMExports} from 'node:module';
 import {EventEmitter} from 'node:events';
 const require=createRequire(import.meta.url),https=require('node:https');
 let row={machine_id:'nova-01',capabilities:{},last_snapshot:{stats:{totalSpins:123},settings:{setting:4}},assigned_setting:4};
 const calls=[];
 https.request=(url,options,callback)=>{
   const req=new EventEmitter();let body='';req.write=chunk=>body+=chunk;
   req.end=()=>queueMicrotask(()=>{
     const resource=new URL(url).pathname.split('/').at(-1);let data=[];
     if(resource==='machine_states'){
       if(options.method==='POST'){
         const patch=JSON.parse(body);calls.push(patch);row={...row,...patch};
       }
       data=[row];
     }
     if(resource==='machine_commands'&&options.method==='POST')data=[{id:1,...JSON.parse(body)}];
     const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',JSON.stringify(data));res.emit('end');
   });return req;
 };
 syncBuiltinESMExports();
 const {default:handler}=await import('./api/index.mjs');
 async function request(path,method='GET',body={},admin=true){
   const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
   await handler({__vertexGatewayAuthorized:true,query:{path,since:999},method,body,headers:admin?{'x-admin-password':'qa-admin'}:{}},res);
   return res;
 }
 const admin='admin/machines/nova-01/super-speed',poll='machines/nova-01/commands/poll';
 assert.equal((await request(poll)).body.controls.superSpeedAllowed,false);
 assert.equal((await request(admin,'POST',{enabled:true},false)).statusCode,401);
 assert.equal((await request(admin,'POST',{enabled:'true'})).statusCode,400);
 assert.equal((await request('admin/machines/unknown/super-speed','POST',{enabled:true})).statusCode,404);
 assert.equal((await request(admin,'POST',{enabled:true})).statusCode,200);
 assert.equal(row.last_snapshot.stats.totalSpins,123);assert.equal(row.assigned_setting,4);
 assert.equal((await request(poll)).body.controls.superSpeedAllowed,true);
 await request('machines/nova-01/state','POST',{capabilities:{superSpeedAllowed:false},settings:{superSpeedAllowed:false},stats:{totalSpins:124}});
 assert.equal((await request(poll)).body.controls.superSpeedAllowed,true);
 assert.equal(calls.at(-1).capabilities,undefined,'ordinary snapshot writes cannot overwrite permissions');
 await request('admin/machines/nova-01/reset','POST',{});
 assert.equal((await request(poll)).body.controls.superSpeedAllowed,true);
 await request(admin,'POST',{enabled:false});
 assert.equal((await request(poll)).body.controls.superSpeedAllowed,false);
 console.log('permission lifecycle OK');
 `;
 const result=spawnSync(process.execPath,['--input-type=module','-e',probe],{encoding:'utf8',env:{...process.env,
  ADMIN_PASSWORD:'qa-admin',SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-key',VERTEX_STORE_ID:'qa-store',VERTEX_DB_SCHEMA:'public',
  VERTEX_MACHINES_JSON:JSON.stringify([{machineId:'nova-01',machineType:'nova',gameUrl:'https://qa.invalid/jag.html'}])}});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
