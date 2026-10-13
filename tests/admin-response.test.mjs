import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';

const source=fs.readFileSync('admin.html','utf8');
const fn=name=>source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0];
function ui(){
  const requests=[], elements=new Map(), notices=[];
  const c=vm.createContext({machines:[{machineId:'one',settings:{setting:1}}],machineOperations:new Map(),machineDrafts:new Map(),passwordIssues:new Map([['one',{loaded:true}]]),
    machineListRevision:0,machineListRequest:0,bulkOperationBusy:false,AbortSignal,clearPasswordIssue:id=>{c.clearedPassword=id;},
    $:id=>{if(!elements.has(id))elements.set(id,{value:id.startsWith('setting-')?'4':'19000'});return elements.get(id);},
    document:{querySelectorAll:()=>[]},adminHeaders:()=>({'X-Admin-Password':'qa'}),machineRows:()=>c.machines,
    machineLabelById:id=>id,confirm:()=>true,renderMachines(){c.renders=(c.renders||0)+1;},
    commandWakeChannel:{postMessage:data=>notices.push(data)},
    fetch(url,options){return new Promise(resolve=>requests.push({url,options,resolve}));}
  });
  for(const name of ['setMachineOperation','rememberMachineDraft','submitMachineUpdate','applySetting','resetMachine','loadMachines'])vm.runInContext(fn(name),c);
  return {c,requests,elements,notices,reply(i,body,status=200){requests[i].resolve({ok:status<400,json:async()=>body});}};
}
test('setting reports progress immediately, coalesces double-click, uses one request and preserves other drafts',async()=>{
  const h=ui();h.c.machineDrafts.set('two',{setting:6});
  const p=h.c.applySetting('one');assert.equal(h.c.$('controls-one').disabled,true);
  assert.match(h.c.$('operation-one').textContent,/送信中/);
  await h.c.applySetting('one');assert.equal(h.requests.length,1);
  h.reply(0,{ok:true,setting:4,machine:{machineId:'one',assignedSetting:4,settings:{setting:4}}});await p;
  assert.equal(h.requests.length,1);assert.equal(h.c.$('controls-one').disabled,false);
  assert.equal(h.c.machines[0].settings.setting,4);assert.equal(h.c.machineDrafts.get('two').setting,6);
  assert.equal(h.notices.length,1);assert.equal(h.notices[0].machineId,'one');
});
test('old list responses cannot overwrite an operation that just completed',async()=>{
  const h=ui(), list=h.c.loadMachines(), update=h.c.applySetting('one');
  h.reply(1,{ok:true,setting:4,machine:{machineId:'one',settings:{setting:4}}});await update;
  h.reply(0,[{machineId:'one',settings:{setting:1}}]);assert.equal(await list,false);
  assert.equal(h.c.machines[0].settings.setting,4);
});
test('HTTP failure clears busy state, preserves draft and does not claim success or notify games',async()=>{
  const h=ui(), p=h.c.applySetting('one');h.reply(0,{ok:false,error:'test failure'},503);await p;
  assert.equal(h.c.$('controls-one').disabled,false);assert.equal(h.c.$('operation-one').textContent,'test failure');
  assert.equal(h.c.machines[0].settings.setting,1);assert(h.c.machineDrafts.has('one'));assert.equal(h.notices.length,0);
});
test('reset updates just the returned machine without rereading historical results',async()=>{
  const h=ui(), p=h.c.resetMachine('one');h.reply(0,{ok:true,machine:{machineId:'one',resetSerial:1,stats:null,currentSessionId:''}});await p;
  assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/\/reset$/);assert.equal(h.c.machines[0].resetSerial,1);
  assert.equal(h.c.clearedPassword,'one');assert.match(h.c.$('operation-one').textContent,/保存・台へ送信/);
});

test('real gateway settings/reset return fresh cards, preserve auth, cancel sessions and avoid a second machine read',()=>{
  const probe=String.raw`
    import assert from 'node:assert/strict';
    import {createRequire,syncBuiltinESMExports} from 'node:module';
    import {EventEmitter} from 'node:events';
    const require=createRequire(import.meta.url),https=require('node:https');
    let row={machine_id:'one',current_session_id:'session',current_player_name:'tester',reset_serial:0,locked:true,assigned_setting:1,capabilities:{superSpeedAllowed:true},last_snapshot:{settings:{setting:1},stats:{totalSpins:200,totalPaid:900,totalFee:1000}}};
    const session={session_id:'session',machine_id:'one',password:'QATEST',status:'active',reset_serial_at_start:0};
    const calls=[];let inFlight=0,maxInFlight=0;
    function answer(url,options={},body){
      const table=new URL(url).pathname.split('/').at(-1),method=options.method||'GET';calls.push({table,method});
      if(table==='machine_states'){if(method==='POST')row={...row,...JSON.parse(body)};return [row];}
      if(table==='sessions'){if(method==='PATCH')Object.assign(session,JSON.parse(body));return [session];}
      if(table==='machine_commands')return method==='POST'?[{id:3,...JSON.parse(body)}]:[];
      return [];
    }
    https.request=(url,options,callback)=>{
      const req=new EventEmitter();let body='';req.write=chunk=>body+=chunk;
      req.end=()=>{maxInFlight=Math.max(maxInFlight,++inFlight);setTimeout(()=>{
        const data=answer(String(url),options,body);inFlight--;const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',JSON.stringify(data));res.emit('end');
      },10);};return req;
    };
    syncBuiltinESMExports();globalThis.fetch=async(url,options={})=>new Response(JSON.stringify(answer(String(url),options,options.body)),{status:200});
    const {default:gateway}=await import('./api/gateway.mjs');
    async function request(path,body={},admin=true,method='POST'){
      const req={query:{path},method,body,headers:{host:'qa.test',...(admin?{'x-admin-password':'qa-admin'}:{})}};
      const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},end(body){this.body=JSON.parse(String(body));}};
      await gateway(req,res);assert.equal(req.__vertexResetMachine,undefined);return res;
    }
    assert.equal((await request('admin/machines/one/reset',{},false)).statusCode,401);assert.equal(calls.length,0);
    const setting=await request('admin/machines/one/setting',{setting:5,completeLimitPt:19000});
    assert.equal(setting.statusCode,200);assert.equal(setting.body.machine.settings.setting,5);assert.equal(setting.body.machine.assignedSetting,5);
    const limit=await request('admin/machines/one/setting',{completeLimitPt:22000});
    assert.equal(limit.statusCode,200);assert.equal(limit.body.machine.settings.setting,5);
    assert.equal(limit.body.machine.settings.completeMyLimitPt,22000);assert.equal(limit.body.machine.settings.completeLimitPt,0);
    const settingOnly=await request('admin/machines/one/setting',{setting:5});
    assert.equal(settingOnly.body.machine.settings.completeMyLimitPt,22000);
    assert.equal((await request('admin/machines/one/setting',{completeLimitPt:0})).statusCode,400);
    calls.length=0;const reset=await request('admin/machines/one/reset');
    assert.equal(reset.statusCode,200);assert.equal(reset.body.machine.resetSerial,1);assert.equal(reset.body.machine.stats,null);
    assert.equal(reset.body.machine.settings.setting,5);assert.equal(reset.body.machine.currentSessionId,'');
    assert.equal(reset.body.machine.capabilities.superSpeedAllowed,true);assert.equal(session.status,'cancelled');
    assert.equal(calls.filter(c=>c.table==='machine_states'&&c.method==='GET').length,1);
    assert(calls.some(c=>c.table==='issued_passwords'&&c.method==='PATCH'));
    maxInFlight=0;const poll=await request('machines/one/commands/poll',{},false,'GET');assert.equal(poll.statusCode,200);assert.equal(maxInFlight,2);
    console.log('gateway lifecycle OK');
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',probe],{encoding:'utf8',env:{...process.env,
    ADMIN_PASSWORD:'qa-admin',SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-key',VERTEX_STORE_ID:'qa-store',VERTEX_DB_SCHEMA:'public',VERTEX_REQUIRE_SESSION_TOKEN:'0',
    VERTEX_MACHINES_JSON:JSON.stringify([{machineId:'one',machineType:'nova',gameUrl:'https://game.invalid'}])}});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
