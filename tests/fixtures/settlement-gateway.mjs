import assert from 'node:assert/strict';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url),https=require('node:https');
Object.assign(process.env,{VERTEX_STORE_ID:'store-debug',VERTEX_DB_SCHEMA:'vertex_debug',VERTEX_SETTLEMENT_V2:'1',VERTEX_REQUIRE_SESSION_TOKEN:'1',CUSTOMER_LOGIN_PILOT:'0',ADMIN_PASSWORD:'qa',SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-key',GOOGLE_SHEETS_WEBHOOK_URL:'https://sheets.invalid/exec',VERTEX_ALLOWED_ORIGINS:''});
const zero={totalSpins:0,totalFee:0,totalPaid:0};
const s={session_id:'qa-s',token:'qa-token',machine_id:'nova-01',player_name:'QA',status:'active',reset_serial_at_start:1,start_snapshot:{stats:zero}};
const m={machine_id:'nova-01',machine_type:'nova',current_session_id:s.session_id,current_player_name:'QA',reset_serial:1,assigned_setting:5,last_snapshot:{playSessionId:s.session_id,capturedAt:1,stats:zero,settings:{setting:5,completeLimitPt:10000}}};
let job=null,finalizes=0,sent=0,offline=true;
function db(url,o={},raw){
 const p=new URL(url).pathname.split('/').at(-1),b=raw?JSON.parse(raw):{};
 if(p==='sessions')return [{...s}];if(p==='machine_states')return [structuredClone(m)];
 if(['session_results','super_speed_activity','issued_passwords'].includes(p))return [];
 if(p==='nova_save_snapshot'){m.last_snapshot=b.p_snapshot;return true;}
 if(p==='nova_finalize_session'){
  finalizes++;assert.equal(b.p_record.setting,5);assert.equal(b.p_record.playerProfit,60);
  assert.equal(b.p_snapshot.capturedAt,20,'newest stored state wins over stale end request');
  s.status='ended';s.result_record=b.p_record;s.sheets={ok:false,pending:true};m.current_session_id='';
  m.last_snapshot=b.p_snapshot;m.last_ended_session={sessionId:s.session_id,record:b.p_record,machineTotal:b.p_machine_total};
  job={session_id:s.session_id,record:b.p_record,attempts:0,status:'pending'};
  return {ok:true,record:b.p_record,sheets:s.sheets};
 }
 if(p==='nova_claim_settlement'){if(!job||job.status==='sent'||job.leased)return [];job.leased=b.p_token;job.attempts++;return [structuredClone(job)];}
 if(p==='nova_ack_settlement'){assert.equal(job.leased,b.p_token);job.leased=null;job.status=b.p_ok?'sent':'pending';s.sheets={ok:b.p_ok,pending:!b.p_ok};return true;}
 if(p==='settlement_outbox')return job?.status==='pending'?[structuredClone(job)]:[];
 throw Error('Unexpected DB path '+p);
}
https.request=(url,opts,callback)=>{const req=new EventEmitter();let body='';req.write=x=>body+=x;req.setTimeout=()=>{};req.end=()=>queueMicrotask(()=>{try{const value=db(String(url),opts,body);const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',JSON.stringify(value));res.emit('end');}catch(e){req.emit('error',e);}});return req;};
syncBuiltinESMExports();
globalThis.fetch=async(url,o={})=>{
 if(new URL(url).hostname==='sheets.invalid'){sent++;assert.equal(s.status,'ended','commit end before external request');if(offline)throw Error('offline');return Response.json({ok:true,sessionId:s.session_id});}
 return Response.json(db(String(url),o,o.body));
};
const {default:gateway}=await import('../../api/gateway.mjs');
async function request(path,body={},method='POST',admin=false){
 const req={method,query:{path},body,headers:{host:'qa.test',...(admin?{'x-admin-password':'qa'}:{})}};
 const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},end(v){this.body=JSON.parse(v);}};
 await gateway(req,res);return res;
}
const snapshot={playSessionId:s.session_id,token:s.token,capturedAt:20,playSessionStartStats:zero,stats:{totalSpins:100,totalFee:300,totalPaid:360,profit:60},settings:{setting:6}};
assert.equal((await request('machines/nova-01/state',{...snapshot,stats:{...snapshot.stats,profit:61}})).statusCode,422);
assert.equal((await request('machines/nova-01/state',{...snapshot,token:'bad'})).statusCode,401);
const saved=await request('machines/nova-01/state',snapshot);assert.equal(saved.statusCode,200,JSON.stringify(saved.body));
assert.equal(m.last_snapshot.settings.setting,5);
const end=await request('sessions/end',{sessionId:s.session_id,token:s.token,snapshot:{...snapshot,capturedAt:10,stats:{totalSpins:90,totalFee:270,totalPaid:310,profit:40}}});
assert.equal(end.statusCode,200,JSON.stringify(end.body));assert.equal(end.body.sheets.pending,true);assert.equal(job.status,'pending');
const repeated=await request('sessions/end',{sessionId:s.session_id,token:s.token});assert.equal(repeated.body.alreadyEnded,true);assert.equal(finalizes,1);assert.equal(sent,1);
assert.equal((await request('admin/settlements',{},'GET')).statusCode,401);
offline=false;const retry=await request('admin/settlements/retry',{},'POST',true);assert.equal(retry.statusCode,200,JSON.stringify(retry.body));assert.equal(job.status,'sent');assert.equal(sent,2);
assert.equal((await request('machines/nova-01/state',{...snapshot,capturedAt:30})).statusCode,409);
const {default:cron}=await import('../../api/settlement-retry.mjs');
process.env.CRON_SECRET='qa-cron';process.env.VERTEX_SETTLEMENT_WORKER='1';
for(const [auth,code]of [['Bearer wrong',401],['Bearer qa-cron',200]]){const r={setHeader(){},end(v){this.body=JSON.parse(v);}};await cron({method:'GET',headers:{authorization:auth}},r);assert.equal(r.statusCode,code);}
console.log('V2 gateway: auth, validation, newest snapshot, durable end, receipt retry, stale write, cron verified');
