import assert from 'node:assert/strict';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url),https=require('node:https');
const policy=require('../../password-issuance.cjs');
const machines=new Map(['one','two'].map(id=>[id,{machine_id:id,current_session_id:'',current_player_name:'',reset_serial:0}]));
const passwords=new Map(),sessions=new Map(),results=[];
const speedEvents=new Map();
const sheetRecords=[];
const collision=policy.candidate('qa-key','qa-store',{machineId:'one'},null,0);
passwords.set(collision,{password:collision,machine_id:'unrelated',player_name:'Existing',status:'issued',issued_at_ms:1});
let requests=0, holdSnapshotWrite=null, beforeReleaseWrite=null;
function matches(row,query){
 for(const key of ['password','machine_id','session_id','status','activity_date','current_session_id','reset_serial']){
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
 if(u.hostname==='sheets.invalid'){
  assert.equal(method,'POST');const record=JSON.parse(body);
  if(record.forced){
   assert.equal(sessions.get(record.sessionId)?.status,'ended','force-end must revoke play before Sheets export');
   assert.equal(sessions.get(record.sessionId)?.result_record?.sessionId,record.sessionId);
  }
  sheetRecords.push(record);return {status:200,data:{ok:true}};
 }
 if(table==='issue_password_with_speed'){
   const {p_issued:row,p_event:event}=JSON.parse(body);
   if(passwords.has(row.password))return {status:409,data:{code:'23505'}};
   passwords.set(row.password,{...row});
   const machine=machines.get(row.machine_id);machine.capabilities={...machine.capabilities,superSpeedAllowed:row.super_speed_allowed};
   if(event)speedEvents.set(event.id,event);
   return {status:200,data:null};
 }
 if(table==='super_speed_activity'){
   if(method==='POST'){const row=JSON.parse(body);if(!speedEvents.has(row.id))speedEvents.set(row.id,row);}
   return {status:200,data:structuredClone([...speedEvents.values()].filter(row=>matches(row,q)).slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||1000)))};
 }
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
 if(table==='session_results'){
  if(method==='POST')results.push(JSON.parse(body));
  let rows=results.filter(row=>matches(row,q));
  if(q.get('order')==='id.desc')rows=rows.toReversed();
  if(q.has('offset'))rows=rows.slice(Number(q.get('offset')));
  if(q.has('limit'))rows=rows.slice(0,Number(q.get('limit')));
  return {status:200,data:structuredClone(rows)};
 }
 if(table==='machine_commands')return {status:200,data:method==='POST'?[{id:requests,...JSON.parse(body)}]:[]};
 throw Error('Unexpected table '+table);
}
https.request=(url,options,callback)=>{
 const req=new EventEmitter();let body='';req.write=chunk=>body+=chunk;
 req.end=()=>setTimeout(async()=>{
  if(new URL(url).pathname.endsWith('/machine_states')&&options.method!=='GET'&&body){
   const row=JSON.parse(body);
   if(holdSnapshotWrite&&row.last_snapshot?.qaDelayed){const hold=holdSnapshotWrite;holdSnapshotWrite=null;await hold();}
   if(beforeReleaseWrite&&row.current_session_id===''){const before=beforeReleaseWrite;beforeReleaseWrite=null;before();}
  }
  const data=answer(String(url),options,body),res=new EventEmitter();res.statusCode=data.status;callback(res);res.emit('data',JSON.stringify(data.data));res.emit('end');
 },2);return req;
};
syncBuiltinESMExports();
globalThis.fetch=async(url,options={})=>{const out=answer(String(url),options,options.body);return new Response(JSON.stringify(out.data),{status:out.status});};
const {default:gateway}=await import('../../api/gateway.mjs');
async function request(path,body={},method='POST',admin=true){
 const url=new URL('https://qa.test/'+path);
 const req={method,query:{path:url.pathname.slice(1),...Object.fromEntries(url.searchParams)},body,headers:{host:'qa.test',...(admin?{'x-admin-password':'qa'}:{})}};
 const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},end(body){this.body=JSON.parse(body);}};
 await gateway(req,res);return res;
}
const issue=(machineId,playerName)=>request('admin/issue-password',{machineId,playerName});
const current=async()=>{const res=await request('admin/passwords/current',{},'GET');assert.equal(res.statusCode,200);return res.body;};
const begin=async(password)=>{const res=await request('sessions/start',{password});assert.equal(res.statusCode,200,JSON.stringify(res.body));return res.body.session;};
const status=async(session)=>request('sessions/status',{sessionId:session.sessionId,token:session.token},'POST',false);
if(process.env.QA_CREDIT_ASSERT==='1'){
 const cases=[['Alice',500,0,500],['Alice',-100,500,400],['Bob',200,0,200],['Alice',50,0,50],['Alice',-200,50,-150]];
 for(const [name,delta,carry,total] of cases){
  const issued=await issue('one',name);assert.equal(issued.statusCode,200,JSON.stringify(issued.body));
  const started=await request('sessions/start',{password:issued.body.issued.password});
  assert.equal(started.statusCode,200,JSON.stringify(started.body));
  assert.equal(started.body.resumeState.creditCarry,carry);
  const session=started.body.session,base=structuredClone(started.body.resumeState.state?.stats||{totalSpins:0,totalFee:0,totalPaid:0});
  const stats={totalSpins:base.totalSpins+100,totalFee:base.totalFee+300,totalPaid:base.totalPaid+300+delta};
  const snapshot={playSessionId:session.sessionId,playSessionStartStats:base,stats,adminCommandLastId:152,
    normalState:{flow:{phase:'art',remaining:456,stock:2}},runtimeState:{session:{active:true,phase:'a_type_bonus'}},capturedAt:Date.now()};
  const state=await request('machines/one/state',snapshot,'POST',false);assert.equal(state.statusCode,200);
  const reentry=await request('sessions/start',{password:issued.body.issued.password});
  assert.equal(reentry.body.resumeState.creditCarry,carry);assert.equal(reentry.body.resumeState.baseline.totalFee,base.totalFee);
  assert.equal(reentry.body.resumeState.state.normalState.flow.remaining,456);
  assert.equal(reentry.body.resumeState.lastCommandId,152);
  const end=await request('sessions/end',{...session,snapshot});assert.equal(end.statusCode,200);
  assert.equal(end.body.record.playerProfit,delta);assert.equal(end.body.record.playerCreditTotal,total);
  assert.equal(sheetRecords.at(-1).playerProfit,delta);
  const count=sheetRecords.length;await request('sessions/end',session);assert.equal(sheetRecords.length,count);
 }
 await request('admin/machines/one/reset');
 const issued=await issue('one','Alice'),next=await request('sessions/start',{password:issued.body.issued.password});
 assert.equal(next.body.resumeState.creditCarry,0);assert.equal(next.body.resumeState.state.stats,undefined);
 console.log('Customer changes, consecutive signed carry, resume, reset, cabinet state and per-session billing verified.');
 process.exit(0);
}
if(process.env.QA_STALE_SESSION_ASSERT==='1'){
 for(const action of ['end','force-end','reset']){
  const issued=await issue('one','QA'),session=await begin(issued.body.issued.password);
  const beforeRecovery=structuredClone(machines.get('one')),beforeResults=results.length,beforeSheets=sheetRecords.length;
  const activeRecovery=await request('admin/machines/one/force-end',{recoverOnly:true});
  assert.equal(activeRecovery.statusCode,409);assert.deepEqual(machines.get('one'),beforeRecovery);
  assert.equal(results.length,beforeResults);assert.equal(sheetRecords.length,beforeSheets);
  const snapshot={playSessionId:session.sessionId,endPreparedAt:Date.now(),capturedAt:10,stats:{totalSpins:100,totalFee:300,totalPaid:420},state:{flow:{mode:'AT',atRemainingPt:250}}};
  machines.get('one').last_snapshot=structuredClone(snapshot);
  let resume,entered;
  const gate=new Promise(resolve=>resume=resolve),waiting=new Promise(resolve=>entered=resolve);
  holdSnapshotWrite=()=>{entered();return gate;};
  const pending=request('machines/one/state',{...snapshot,qaDelayed:true,capturedAt:11,stats:{...snapshot.stats,totalSpins:101}},'POST',false);
  await waiting;
  const ended=action==='end'?await request('sessions/end',{...session,snapshot}):await request('admin/machines/one/'+action);
  assert.equal(ended.statusCode,200,JSON.stringify(ended.body));
  const saved=structuredClone(machines.get('one'));
  resume();const late=await pending;
  assert.equal(late.body.ignored,true,'state already in flight must be ignored after '+action);
  assert.deepEqual(machines.get('one'),saved,'late state must not resurrect occupancy or overwrite totals');
  assert.equal((await current()).find(row=>row.machineId==='one').status,'available');
 }
 for(const endpoint of ['sessions/end','admin/machines/one/force-end']){
  const issued=await issue('one','Recovery'),session=await begin(issued.body.issued.password);
  const snapshot={playSessionId:session.sessionId,stats:{totalSpins:120,totalFee:360,totalPaid:490},state:{flow:{mode:'AT',atRemainingPt:300}}};
  await request('sessions/end',{...session,snapshot});
  const saved=structuredClone(machines.get('one')),count=results.length,sheetsCount=sheetRecords.length;
  Object.assign(machines.get('one'),{current_session_id:session.sessionId,current_player_name:'Recovery',locked:true});
  const repeated=await request(endpoint,{...session,recoverOnly:true});
  assert.equal(repeated.statusCode,200,JSON.stringify(repeated.body));
  assert.equal(repeated.body.alreadyEnded,true);assert.equal(repeated.body.released,true);
  assert.deepEqual(machines.get('one'),saved,'repair must keep the existing totals, snapshots, setting and checkpoint');
  assert.equal(results.length,count);assert.equal(sheetRecords.length,sheetsCount,'repair must not export a second settlement');
  assert.equal((await current()).find(row=>row.machineId==='one').status,'available');
  // Also repair a session whose final machine checkpoint was never committed.
  Object.assign(machines.get('one'),{current_session_id:session.sessionId,current_player_name:'Recovery',locked:true,last_ended_session:null});
  const checkpointRetry=await request(endpoint,session);
  assert.equal(checkpointRetry.body.released,true);
  assert.deepEqual(machines.get('one').last_snapshot,saved.last_snapshot);
  assert.deepEqual(machines.get('one').last_ended_session.machineTotal.stats,saved.last_ended_session.machineTotal.stats);
  assert.equal(results.length,count);assert.equal(sheetRecords.length,sheetsCount);
  Object.assign(machines.get('one'),saved);
  // A concurrent replacement must not be unlocked by the old end retry.
  Object.assign(machines.get('one'),{current_session_id:session.sessionId,locked:true});
  let replacement;
  beforeReleaseWrite=()=>{Object.assign(machines.get('one'),{current_session_id:'new-session',current_player_name:'New',reset_serial:saved.reset_serial+1});replacement=structuredClone(machines.get('one'));};
  await request(endpoint,session);
  assert.deepEqual(machines.get('one'),replacement);
  Object.assign(machines.get('one'),saved);
 }
 console.log('Delayed state after end/force-end/reset, ended-session repair, preserved totals and concurrent replacement verified.');
 process.exit(0);
}
async function rejectsStaleState(session){
 const before=structuredClone(machines.get(session.machineId));
 const response=await request(`machines/${session.machineId}/state`,{playSessionId:session.sessionId,playSessionToken:session.token,stats:{totalSpins:99999,totalPaid:999999}},'POST',false);
 assert.equal(response.statusCode,409,JSON.stringify(response.body));
 assert.deepEqual(machines.get(session.machineId),before);
}
if(process.env.QA_RESUME_ASSERT==='1'){
 let prior=null;
 for(let i=0;i<3;i++){
  const issued=await issue('one','Player'+i),started=await request('sessions/start',{password:issued.body.issued.password});
  assert.equal(started.statusCode,200,JSON.stringify(started.body));
  const session=started.body.session;
  assert.equal(new URL(started.body.iframeUrl).searchParams.get('resumeFromStore'),'1');
  if(prior){assert.deepEqual(started.body.resumeState.state.runtimeState,prior.runtimeState);assert.equal(started.body.resumeState.baseline,null);}
  const stats={totalSpins:(i+1)*100,totalFee:(i+1)*300,totalPaid:(i+1)*400};
  const snapshot={playSessionId:session.sessionId,capturedAt:1000+i*100,endPreparedAt:1000+i*100,
   playSessionStartStats:prior?.stats||{totalSpins:0,totalFee:0,totalPaid:0},stats,
   settings:{setting:1},resumeSettings:{setting:1,initialSevenVersion:148},
   normalState:{flow:{phase:'art',remaining:800,stock:2}},
   runtimeState:{replayAccountingVersion:2,session:{active:true,phase:'a_type_bonus',paid:72},pendingSpin:{version:1,result:'NEBULA',stopped:[false,false,true]}}};
  const state=await request('machines/one/state',snapshot,'POST',false);assert.equal(state.statusCode,200,JSON.stringify(state.body));
  const late=await request('machines/one/state',{...snapshot,capturedAt:999,normalState:{}},'POST',false);assert.equal(late.body.ignored,true);
  const resumed=await request('sessions/start',{password:issued.body.issued.password});
  assert.deepEqual(resumed.body.resumeState.baseline,snapshot.playSessionStartStats);assert.deepEqual(resumed.body.resumeState.state.runtimeState,snapshot.runtimeState);
  const end=i===1?await request('admin/machines/one/force-end'):await request('sessions/end',{...session,snapshot});
  assert.equal(end.statusCode,200,JSON.stringify(end.body));assert.equal(end.body.record.playerSpins,100);assert.equal(end.body.record.playerProfit,100);
  prior=snapshot;
 }
 await request('admin/machines/one/reset');
 const issued=await issue('one','Reset'),started=await request('sessions/start',{password:issued.body.issued.password});
 assert.equal(started.body.resumeState.state.stats,undefined);
 console.log('Cross-player state, same-player baseline, stale snapshots, normal/forced end and explicit reset verified.');
 process.exit(0);
}
if(process.env.QA_SPEED_ASSERT==='1'){
 let now=Date.parse('2026-10-17T14:59:00Z');Date.now=()=>now;
 const create=(id,name,enabled)=>request('admin/issue-password',{machineId:id,playerName:name,superSpeedAllowed:enabled});
 assert.equal((await create('one','Invalid','true')).statusCode,400);
 const [a,b,other]=await Promise.all([create('one','Alice',true),create('one','Loser',false),create('two','Bob',false)]);
 assert.equal(a.statusCode,200);assert.equal(b.body.issued.password,a.body.issued.password);
 assert.equal(a.body.issued.superSpeedAllowed,true);assert.equal(b.body.issued.playerName,'Alice');
 assert.equal(machines.get('one').capabilities.superSpeedAllowed,true);
 assert.equal(machines.get('two').capabilities.superSpeedAllowed,false);
 const session=await begin(a.body.issued.password),off=await begin(other.body.issued.password);
 const used=s=>request('sessions/super-speed-used',s,'POST',false);
 assert.equal((await used({...session,token:'bad'})).statusCode,403);
 assert.equal((await used(off)).statusCode,403);
 const history=date=>request('admin/super-speed-activity?date='+date,{},'GET');
 assert.equal((await request('admin/super-speed-activity',{},'GET',false)).statusCode,401);
 assert.equal((await history('2026-02-30')).statusCode,400);
 assert.equal((await history('2026-10-17')).body.rows[0].usedAt,0);
 assert.equal((await used(session)).statusCode,200);
 now+=10000;await used(session);
 let rows=(await history('2026-10-17')).body.rows;
 assert.equal(rows.length,1);assert.equal(rows[0].playerName,'Alice');assert.equal(rows[0].usedAt,now-10000);
 assert.equal(speedEvents.size,2,'one allowed and one actual-use event per day');
 now=Date.parse('2026-10-17T15:01:00Z');await used(session);
 assert.equal((await history('2026-10-18')).body.rows.length,1,'JST midnight starts a new usage day');
 assert.equal((await request('admin/machines/one/reset')).statusCode,200);
 assert.equal(machines.get('one').capabilities.superSpeedAllowed,false,'reset revokes the current permission');
 assert.equal((await used(session)).statusCode,409);
 assert.equal((await history('2026-10-17')).body.rows.length,1,'reset preserves audit');
 const next=await create('one','Next',false);
 assert.equal(next.body.issued.superSpeedAllowed,false);assert.equal(machines.get('one').capabilities.superSpeedAllowed,false);
 assert.equal((await history('2026-10-17')).body.rows[0].playerName,'Alice');
 console.log('Atomic issuance, competing admins, authenticated use, deduplication, JST rollover, reset and OFF handover verified.');
 process.exit(0);
}
if(process.env.QA_TOTALS_ASSERT==='1'){
 // More than one API page of legacy players must survive migration.
 for(let i=0;i<501;i++){
  const record={machineId:'one',sessionId:'legacy'+i,resetSerial:0,endedAtMs:i+1,stats:{totalSpins:10,bigCount:1,atFirstCount:1,totalFee:30,totalPaid:20}};
  results.push({machine_id:'one',record});
 }
 machines.get('one').last_ended_session={sessionId:'legacy500',record:results.at(-1).record};
 results.push({machine_id:'one',record:{machineId:'one',sessionId:'old-reset',resetSerial:99,stats:{totalSpins:999999}}});
 for(let i=0;i<3;i++){
  const issued=await issue('one','Player'+i);assert.equal(issued.statusCode,200,JSON.stringify(issued.body));
  const started=await request('sessions/start',{password:issued.body.issued.password});
  assert.equal(started.statusCode,200,JSON.stringify(started.body));
  const session=started.body.session;
  const base=JSON.parse(new URL(started.body.iframeUrl).searchParams.get('machineDisplay'));
  assert.equal(base.totalSpins,5010+i*100);
  assert.equal(base.dataHits.length,0,'full history must not grow the game URL');
  assert.equal(started.body.machineDisplayBaseline.dataHits.length,i*40);
  const snapshot={playSessionId:session.sessionId,playSessionToken:session.token,playSessionStartStats:{totalSpins:0,bigCount:0,atFirstCount:0,totalFee:0,totalPaid:0},
   stats:{totalSpins:100,bigCount:2,atFirstCount:1,totalFee:300,totalPaid:350,dataHitSeq:40,dataHits:Array.from({length:40},(_,j)=>({seq:j+1,spin:(j+1)*2,kind:'BIG',games:2,phase:'normal'}))},normalState:{sinceBonus:5},machineDisplayStats:{sinceBonus:5}};
  const state=await request('machines/one/state',snapshot,'POST',false);assert.equal(state.statusCode,200,JSON.stringify(state.body));
  const resumed=await request('sessions/start',{password:issued.body.issued.password});
  assert.equal(resumed.body.iframeUrl,started.body.iframeUrl,'resuming must not add active counters to baseline');
  assert.deepEqual(resumed.body.machineDisplayBaseline,started.body.machineDisplayBaseline);
  const list=await request('machines',{},'GET');assert.equal(list.statusCode,200,JSON.stringify(list.body));
  assert.equal(list.body.find(m=>m.machineId==='one').machineTotalStats.totalSpins,5110+i*100);
  const end=i===1 ? await request('admin/machines/one/force-end') : await request('sessions/end',{...session,snapshot});
  assert.equal(end.statusCode,200,JSON.stringify(end.body));assert.equal(end.body.record.playerSpins,100);assert.equal(end.body.record.playerProfit,50);
  assert.equal(machines.get('one').last_ended_session.machineTotal.stats.totalSpins,5110+i*100);
 }
 await request('admin/machines/one/reset');
 const issued=await issue('one','After reset');
 const started=await request('sessions/start',{password:issued.body.issued.password});
 assert.equal(JSON.parse(new URL(started.body.iframeUrl).searchParams.get('machineDisplay')).totalSpins,0);
 console.log('Legacy pagination, three successive players, resumed display, raw settlement, forced end and reset totals verified.');
 process.exit(0);
}
if(process.env.QA_SHEETS_ASSERT==='1'){
 const eligible=['store-debug','store-nebula'].includes(process.env.VERTEX_STORE_ID);
 const machineId=process.env.VERTEX_STORE_ID==='store-debug'?'nova-01':'one';
 if(!machines.has(machineId))machines.set(machineId,{machine_id:machineId,current_session_id:'',current_player_name:'',reset_serial:0});
 for(const [index,[delta,forced]] of [[2000,false],[101,true],[0,false],[-201,true]].entries()){
  const issued=await issue(machineId,'QA');assert.equal(issued.statusCode,200,JSON.stringify(issued.body));
  const session=await begin(issued.body.issued.password);
  const baseline={totalSpins:100,totalFee:300,totalPaid:800};
  const snapshot={playSessionId:session.sessionId,playSessionStartStats:baseline,stats:{totalSpins:1100,totalFee:3300,totalPaid:3800+delta}};
  machines.get(machineId).last_snapshot=snapshot;
  const response=forced
   ?await request(`admin/machines/${machineId}/force-end`)
   :await request('sessions/end',{...session,snapshot,storeId:'store-las-vegas',machineType:'jackspot'},'POST',false);
  assert.equal(response.statusCode,200,JSON.stringify(response.body));assert.equal(response.body.sheets.ok,true);
  const sent=sheetRecords.at(-1),saved=results.at(-1).record;
  assert.equal(sheetRecords.length,index+1);
  assert.equal(saved.playerProfit,delta);assert.equal(response.body.record.playerProfit,delta);
  assert.equal(sessions.get(session.sessionId).result_record.playerProfit,delta);
  assert.equal(sent.playerProfit,delta);
  assert.equal(sent.profit,delta+500);assert.deepEqual(sent.stats,snapshot.stats);
  assert.equal(sent.storeId,process.env.VERTEX_STORE_ID);assert.equal(sent.billingBasis,'playerProfit');
  assert.equal(sent.playerTotalFee,3000);assert.equal(sent.playerTotalPaid,3000+delta);
  assert.equal(saved.exchangeGapPt,undefined);
  assert.equal(sent.exchangeGapPt,undefined);
  assert.deepEqual(sent,saved);
  const repeated=await request('sessions/end',session,'POST',false);
  assert.equal(repeated.body.alreadyEnded,true);assert.equal(sheetRecords.length,index+1);
 }
 console.log('Sheets settlement, player baseline, normal/forced end, raw history, other stores and duplicate end verified.');
 process.exit(0);
}
assert.equal((await request('admin/passwords/current',{},'GET',false)).statusCode,401);assert.equal(requests,0);
const [a,a2,b]=await Promise.all([issue('one','Alice'),issue('one','Other admin'),issue('two','Bob')]);
for(const res of [a,a2,b])assert.equal(res.statusCode,200,JSON.stringify(res.body));
assert.equal(a.body.issued.password,a2.body.issued.password);assert.equal(a.body.issued.playerName,a2.body.issued.playerName);
assert.notEqual(a.body.issued.password,b.body.issued.password);assert.notEqual(a.body.issued.password,collision);assert.equal(passwords.size,3);
assert.equal(passwords.get(collision).player_name,'Existing');
assert.equal((await current()).find(row=>row.machineId==='one').password,a.body.issued.password);
const first=await begin(a.body.issued.password);
assert.equal((await status(first)).body.active,true);
assert.equal((await status({...first,token:'wrong'})).statusCode,403);
assert.equal((await status({sessionId:'missing',token:'wrong'})).statusCode,403);
assert.equal((await begin(a.body.issued.password)).sessionId,first.sessionId);
assert.equal((await begin(a.body.issued.password)).token,first.token);
const firstMachine=machines.get('one');
firstMachine.reset_serial++;
assert.equal((await status(first)).body.active,false);
await rejectsStaleState(first);
firstMachine.reset_serial--;
firstMachine.current_session_id='replacement';
assert.equal((await status(first)).body.active,false);
await rejectsStaleState(first);
firstMachine.current_session_id=first.sessionId;
assert.equal((await current()).find(row=>row.machineId==='one').status,'used');
assert.equal((await issue('one','Cannot overwrite')).body.issued.playerName,a.body.issued.playerName);
const ended=await request('sessions/end',first);assert.equal(ended.statusCode,200,JSON.stringify(ended.body));
assert.equal((await status(first)).body.active,false);
await rejectsStaleState(first);
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
const last=await issue('one','Force'), forced=await begin(last.body.issued.password);
assert.equal((await status(forced)).body.active,true);
assert.equal((await request('admin/machines/one/force-end')).statusCode,200);
assert.equal((await status(forced)).body.active,false);
await rejectsStaleState(forced);
const resultCount=results.length;
assert.equal((await request('sessions/end',forced)).body.alreadyEnded,true);
assert.equal((await request('admin/machines/one/force-end')).body.alreadyEnded,true);
assert.equal(results.length,resultCount);
assert.equal((await request('sessions/start',{password:last.body.issued.password})).statusCode,403);
assert.equal((await current()).find(row=>row.machineId==='one').status,'available');
const resetPassword=await issue('one','Reset'),resetSession=await begin(resetPassword.body.issued.password);
assert.equal((await request('admin/machines/one/reset')).statusCode,200);
assert.equal((await status(resetSession)).body.active,false);
await rejectsStaleState(resetSession);
for(let i=0;i<100;i++)passwords.set('old'+i,{password:'old'+i,machine_id:'one',status:'ended',issued_at_ms:Date.now()+i});
assert.equal((await current()).find(row=>row.machineId==='two').password,b.body.issued.password);
console.log('Concurrent issuance, current list, start/end, unused cancellation, reset, force-end and historical passwords verified.');
