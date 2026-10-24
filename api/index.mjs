import machineResume from "../machine-resume.cjs";
import * as https from "node:https";
import * as crypto from "node:crypto";
import machineTotals from "../machine-totals.cjs";
import machineConfig from "../machine-config.cjs";
import adminSettings from "../admin-settings.cjs";
import passwordIssuance from "../password-issuance.cjs";
import speedActivity from "../super-speed-activity.cjs";
import sheetsSettlementPolicy from "../sheets-settlement.cjs";
import {scopeHeaders} from "../supabase-scope.mjs";

const {machineTotalFor,completedMachineTotal,machineDisplayBaseline} = machineTotals;
const {STORE_ID, STORE_NAME, STORE_DIRECTORY, MACHINE_DEFINITIONS, machineDefinition} = machineConfig;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const SHEETS_WEBHOOK_URL = String(process.env.GOOGLE_SHEETS_WEBHOOK_URL || "").trim();
const JACKPOT_CONTRIBUTION_RATE = 0.10;
const JACKPOT_SPIN_COST_PT = 100;
const JACKPOT_CONTRIBUTION_PT = Math.round(JACKPOT_SPIN_COST_PT * JACKPOT_CONTRIBUTION_RATE);
const MAX_JACKPOT_PT = 999999999;

function json(res, status, data){
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Admin-Password");
  res.end(JSON.stringify(data));
}
function adminOk(req){ return !!ADMIN_PASSWORD && ADMIN_PASSWORD.toLowerCase() !== "change-me" && String(req.headers["x-admin-password"] || "") === ADMIN_PASSWORD; }
function requireSupabase(res){
  if(SUPABASE_URL && SUPABASE_KEY) return true;
  json(res, 500, {ok:false, error:"SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"});
  return false;
}
async function readBody(req){
  if(req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve, reject)=>{
    let body = "";
    req.on("data", chunk=>body += chunk);
    req.on("end", ()=>{ try{ resolve(body ? JSON.parse(body) : {}); }catch(e){ reject(e); } });
    req.on("error", reject);
  });
}
function requestJson(urlString, options={}){
  return new Promise((resolve, reject)=>{
    const target = new URL(urlString);
    const body = options.body || "";
    const req = https.request(target, {
      method:options.method || "GET",
      headers:{...(options.headers || {}), ...(body ? {"Content-Length":Buffer.byteLength(body)} : {})}
    }, response=>{
      let text = "";
      response.on("data", chunk=>text += chunk);
      response.on("end", ()=>{
        let data = null;
        try{ data = text ? JSON.parse(text) : null; }catch(e){ data = text; }
        resolve({ok:response.statusCode >= 200 && response.statusCode < 300, status:response.statusCode, data});
      });
    });
    req.on("error", reject);
    if(body) req.write(body);
    req.end();
  });
}
async function sb(path, options={}){
  const result = await requestJson(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers:scopeHeaders({apikey:SUPABASE_KEY, Authorization:"Bearer " + SUPABASE_KEY, "Content-Type":"application/json", ...(options.headers || {})})
  });
  if(!result.ok) throw Object.assign(new Error(typeof result.data === "string" ? result.data : JSON.stringify(result.data)), {code:result.data?.code});
  return result.data;
}
function ms(){ return Date.now(); }
function makeId(prefix){ return prefix + "_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex"); }
function validMachineId(id){ return !!machineDefinition(id); }
function machineLabel(id){ const definition = machineDefinition(id); return definition ? definition.displayName : String(id); }
function jackpotMachineDefinition(id){
  const definition = machineDefinition(id);
  return definition && definition.capabilities && definition.capabilities.jackpot && definition.poolId
    ? definition
    : null;
}
function jackpotPoolDefinition(poolId){
  const normalized = String(poolId || "").trim();
  return MACHINE_DEFINITIONS.find(definition=>
    definition.capabilities && definition.capabilities.jackpot && String(definition.poolId || "") === normalized
  ) || null;
}
function validJackpotAmount(value){
  const amount = Number(value);
  return Number.isFinite(amount) && Number.isInteger(amount) && amount >= 0 && amount <= MAX_JACKPOT_PT
    ? amount
    : null;
}
function validIdempotencyKey(value){
  const key = String(value || "").trim();
  return key.length >= 8 && key.length <= 180 && /^[a-z0-9:_-]+$/i.test(key) ? key : "";
}
function emptyMachine(id){
  const definition = machineDefinition(id) || {};
  return {
    machineId:String(id),
    displayName:definition.displayName || String(id),
    machineType:definition.machineType || "generic",
    gameUrl:definition.gameUrl || "",
    poolId:definition.poolId || "",
    capabilities:definition.capabilities || {completeLimit:false, jackpot:false},
    online:false,
    locked:false,
    resetSerial:0,
    currentSessionId:"",
    currentPlayerName:"",
    lastSnapshot:null,
    lastEndedSession:null,
    updatedAt:0,
    assignedSetting:1
  };
}
function machineFromRow(row){
  if(!row) return null;
  const definition = machineDefinition(row.machine_id) || {};
  const projectedSnapshot = row.snapshot_stats || row.snapshot_settings || row.snapshot_play_session_id || row.snapshot_play_session_start_stats
    ? {stats:row.snapshot_stats || null, settings:row.snapshot_settings || null, playSessionId:row.snapshot_play_session_id || "", playSessionStartStats:row.snapshot_play_session_start_stats || null}
    : null;
  return {
    machineId:String(row.machine_id),
    displayName:definition.displayName || row.display_name || String(row.machine_id),
    machineType:definition.machineType || row.machine_type || "generic",
    gameUrl:definition.gameUrl || row.game_url || "",
    poolId:definition.poolId || row.pool_id || "",
    capabilities:{...(definition.capabilities || row.capabilities || {}),superSpeedAllowed:row.capabilities?.superSpeedAllowed === true},
    online:Date.now() - Number(row.updated_at_ms || 0) < 90000,
    locked:!!row.locked,
    resetSerial:Number(row.reset_serial || 0),
    currentSessionId:row.current_session_id || "",
    currentPlayerName:row.current_player_name || "",
    lastSnapshot:row.last_snapshot || projectedSnapshot,
    lastEndedSession:row.last_ended_session || null,
    updatedAt:Number(row.updated_at_ms || 0),
    assignedSetting:Number(row.assigned_setting || 1)
  };
}
function publicMachine(machine, machineTotal, jackpotPool=null){
  const snapshot = machine.lastSnapshot || null;
  const stats = snapshot && snapshot.stats ? snapshot.stats : null;
  const storedSettings = snapshot && snapshot.settings ? snapshot.settings : {setting:machine.assignedSetting || 1, completeLimitPt:19000};
  const settings = {...storedSettings,...adminSettings.completionSettings(storedSettings,machine.machineType)};
  return {storeId:STORE_ID, machineId:machine.machineId, displayName:machine.displayName || machineLabel(machine.machineId), machineType:machine.machineType || "generic", gameUrl:machine.gameUrl || "", poolId:machine.poolId || "", jackpotPool:jackpotPool || (snapshot && snapshot.jackpotPool) || null, capabilities:machine.capabilities || {completeLimit:false, jackpot:false}, online:!!machine.online, locked:!!machine.locked, currentSessionId:machine.currentSessionId || "", currentPlayerName:machine.currentPlayerName || "", updatedAt:machine.updatedAt || 0, resetSerial:machine.resetSerial || 0, assignedSetting:machine.assignedSetting || (stats && stats.setting) || settings.setting || 1, lastEndedSession:machine.lastEndedSession || null, playSessionId:snapshot && snapshot.playSessionId || "", playSessionStartStats:snapshot && snapshot.playSessionStartStats || null, settings, stats, slumpHistory:stats && Array.isArray(stats.slumpHistory) ? stats.slumpHistory : [{spin:0, profit:0}], machineTotalStats:machineTotal.stats, machineTotalSlumpHistory:machineTotal.history};
}
async function getMachine(id){
  const rows = await sb("machine_states?machine_id=eq." + encodeURIComponent(String(id)) + "&select=*&limit=1");
  return machineFromRow(rows[0]) || emptyMachine(id);
}
async function getAllMachines(){
  const rows = await sb("machine_states?select=*&order=machine_id.asc");
  const byId = new Map(rows.map(row=>[String(row.machine_id), machineFromRow(row)]));
  // 旧管理DBの行は移管後も監査用に残すが、VERTEXでは店舗構成に登録した台だけを扱う。
  return MACHINE_DEFINITIONS.map(definition=>byId.get(definition.machineId) || emptyMachine(definition.machineId));
}
async function upsertMachine(machine, {revokeSuperSpeed = false} = {}){
  const revokePermission = revokeSuperSpeed && machine.machineType === 'nova';
  if(revokePermission) machine.capabilities = {...machine.capabilities, superSpeedAllowed:false};
  const row = {machine_id:String(machine.machineId), store_id:STORE_ID, display_name:machine.displayName || machineLabel(machine.machineId), machine_type:machine.machineType || "generic", game_url:machine.gameUrl || "", pool_id:machine.poolId || "", capabilities:machine.capabilities || {}, locked:!!machine.locked, reset_serial:Number(machine.resetSerial || 0), current_session_id:machine.currentSessionId || "", current_player_name:machine.currentPlayerName || "", last_snapshot:machine.lastSnapshot || null, last_ended_session:machine.lastEndedSession || null, updated_at_ms:Number(machine.updatedAt || 0), assigned_setting:Number(machine.assignedSetting || 1)};
  const options = {method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=representation"}};
  // Only an explicit admin reset/setting change may revoke permission here.
  // Ordinary snapshot/session writes must never restore stale permissions.
  if(!revokePermission) delete row.capabilities;
  try{
    return await sb("machine_states?on_conflict=machine_id", {...options, body:JSON.stringify(row)});
  }catch(error){
    // 旧RISING管理DBから切り替える間だけ、追加列未適用の既存テーブルへも保存できるようにする。
    // 台側の接続先は常にVERTEXのままで、旧管理APIへフォールバックはしない。
    if(!/store_id|machine_type|game_url|pool_id|capabilities/i.test(String(error && error.message || error))) throw error;
    const legacyRow = {
      machine_id:row.machine_id,
      display_name:row.display_name,
      locked:row.locked,
      reset_serial:row.reset_serial,
      current_session_id:row.current_session_id,
      current_player_name:row.current_player_name,
      last_snapshot:row.last_snapshot,
      last_ended_session:row.last_ended_session,
      updated_at_ms:row.updated_at_ms,
      assigned_setting:row.assigned_setting,
      ...(revokePermission ? {capabilities:row.capabilities} : {})
    };
    return sb("machine_states?on_conflict=machine_id", {...options, body:JSON.stringify(legacyRow)});
  }
}
async function getJackpotPool(poolId){
  const rows = await sb(
    "jackpot_pools?store_id=eq." + encodeURIComponent(STORE_ID)
      + "&pool_id=eq." + encodeURIComponent(String(poolId))
      + "&select=current_pt,contribution_rate,version,updated_at&limit=1"
  );
  const row = rows[0] || {};
  return {
    storeId:STORE_ID,
    poolId:String(poolId),
    currentPt:Math.max(0, Number(row.current_pt || 0)),
    contributionRate:Number(row.contribution_rate || JACKPOT_CONTRIBUTION_RATE),
    contributionPt:JACKPOT_CONTRIBUTION_PT,
    version:Math.max(0, Number(row.version || 0)),
    updatedAt:row.updated_at || null
  };
}
async function contributeJackpot(machineId, idempotencyKey){
  const definition = jackpotMachineDefinition(machineId);
  if(!definition) throw new Error("jackpot-enabled machine required");
  const rows = await sb("rpc/jackpot_pool_contribute", {
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      p_store_id:STORE_ID,
      p_pool_id:definition.poolId,
      p_machine_id:String(machineId),
      p_amount_pt:JACKPOT_CONTRIBUTION_PT,
      p_idempotency_key:idempotencyKey
    })
  });
  const row = Array.isArray(rows) ? (rows[0] || {}) : (rows || {});
  return {
    storeId:STORE_ID,
    poolId:definition.poolId,
    currentPt:Math.max(0, Number(row.current_pt || 0)),
    contributionRate:JACKPOT_CONTRIBUTION_RATE,
    contributionPt:JACKPOT_CONTRIBUTION_PT,
    version:Math.max(0, Number(row.version || 0)),
    applied:row.applied !== false
  };
}
async function claimJackpot(machineId, idempotencyKey){
  const definition = jackpotMachineDefinition(machineId);
  if(!definition) throw new Error("jackpot-enabled machine required");
  const rows = await sb("rpc/jackpot_pool_claim", {
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      p_store_id:STORE_ID,
      p_pool_id:definition.poolId,
      p_machine_id:String(machineId),
      p_idempotency_key:idempotencyKey
    })
  });
  const row = Array.isArray(rows) ? (rows[0] || {}) : (rows || {});
  return {
    storeId:STORE_ID,
    poolId:definition.poolId,
    paidPt:Math.max(0, Number(row.paid_pt || 0)),
    currentPt:Math.max(0, Number(row.current_pt || 0)),
    version:Math.max(0, Number(row.version || 0)),
    applied:row.applied !== false
  };
}
async function setJackpotPoolAmount(poolId, currentPt){
  if(!jackpotPoolDefinition(poolId)) throw new Error("jackpot pool not found");
  const rows = await sb("rpc/jackpot_pool_set", {
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      p_store_id:STORE_ID,
      p_pool_id:String(poolId),
      p_machine_id:"admin",
      p_current_pt:currentPt,
      p_idempotency_key:makeId("admin_set")
    })
  });
  const row = Array.isArray(rows) ? (rows[0] || {}) : (rows || {});
  return {
    storeId:STORE_ID,
    poolId:String(poolId),
    currentPt:Math.max(0, Number(row.current_pt || 0)),
    contributionRate:JACKPOT_CONTRIBUTION_RATE,
    contributionPt:JACKPOT_CONTRIBUTION_PT,
    version:Math.max(0, Number(row.version || 0)),
    applied:row.applied !== false,
    updatedAt:new Date().toISOString()
  };
}
function machineGameUrl(machine, adminOrigin, sessionId, displayBaseline){
  if(!machine || !machine.gameUrl) return "";
  const url = new URL(machine.gameUrl, adminOrigin);
  url.searchParams.set("controller", "vertex");
  url.searchParams.set("storeId", STORE_ID);
  url.searchParams.set("machine", machine.machineId);
  url.searchParams.set("server", adminOrigin);
  url.searchParams.set("creditBaseline", "0");
  url.searchParams.set("playSessionId", String(sessionId || ""));
  if(machine.machineType==='nova')url.searchParams.set('resumeFromStore','1');
  if(displayBaseline && machine.machineType==='nova')url.searchParams.set('machineDisplay',JSON.stringify({...displayBaseline,dataHits:[]}));
  return url.toString();
}
async function getIssued(password){
  const rows = await sb("issued_passwords?password=eq." + encodeURIComponent(password) + "&select=*&limit=1");
  return passwordIssuance.fromRow(rows[0]);
}
async function latestIssued(machineId){
  const rows=await sb('issued_passwords?machine_id=eq.'+encodeURIComponent(machineId)+'&select=*&order=issued_at_ms.desc,password.desc&limit=1');
  return passwordIssuance.fromRow(rows[0]);
}
async function currentIssued(machine,previous){
  if(!machine.currentSessionId)return passwordIssuance.current(machine,previous?[previous]:[]);
  const rows=await sb('issued_passwords?session_id=eq.'+encodeURIComponent(machine.currentSessionId)+'&select=*&limit=1');
  return passwordIssuance.current(machine,rows.map(passwordIssuance.fromRow));
}
async function retirePasswords(machineId,status){
  return await sb('issued_passwords?machine_id=eq.'+encodeURIComponent(machineId)+'&status=in.(issued,used)',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status})})||[];
}
async function currentPasswordList(){
  // No game snapshots/history: this small authenticated response is polled by admins.
  const states=await sb('machine_states?select=machine_id,current_session_id,current_player_name,ended_at_ms:last_ended_session->endedAt,reset_serial');
  const machines=MACHINE_DEFINITIONS.map(def=>{
    const row=states.find(row=>row.machine_id===def.machineId);
    return row?machineFromRow({...row,last_ended_session:{endedAt:row.ended_at_ms}}):emptyMachine(def.machineId);
  });
  const sessions=machines.map(machine=>machine.currentSessionId).filter(Boolean);
  const filter=sessions.length?'or=(status.eq.issued,session_id.in.('+sessions.map(encodeURIComponent).join(',')+'))':'status=eq.issued';
  const passwords=[];
  for(let offset=0;;offset+=1000){
    const rows=await sb('issued_passwords?select=*&'+filter+'&order=issued_at_ms.desc,password.desc&limit=1000&offset='+offset);
    passwords.push(...rows.map(passwordIssuance.fromRow));if(rows.length<1000)break;
  }
  return machines.map(machine=>passwordIssuance.current(machine,passwords)||{machineId:machine.machineId,status:'available',password:'',playerName:''});
}
async function saveIssued(issued){
  return sb("issued_passwords?on_conflict=password", {method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=representation"}, body:JSON.stringify({password:issued.password, machine_id:String(issued.machineId), player_name:issued.playerName || "", status:issued.status, issued_at_ms:issued.issuedAt || 0, used_at_ms:issued.usedAt || 0, session_id:issued.sessionId || ""})});
}
async function createIssued(machineId, playerName, superSpeedAllowed){
  const [machine,previous]=await Promise.all([getMachine(machineId),latestIssued(machineId)]);
  const existing=await currentIssued(machine,previous);
  if(existing){
    if(!existing.password)throw Object.assign(new Error('遊技中です。終了後に発行してください。'),{statusCode:409});
    return existing;
  }
  for(let attempt=0; attempt<20; attempt++){
    const issued={password:passwordIssuance.candidate(SUPABASE_KEY,STORE_ID,machine,previous,attempt), machineId, playerName, status:"issued", issuedAt:Math.max(ms(),(previous?.issuedAt||0)+1), usedAt:0, sessionId:""};
    try{
      // Insert only: concurrent issuers must never overwrite an existing code.
      const row={password:issued.password, machine_id:machineId, player_name:playerName, status:"issued", issued_at_ms:issued.issuedAt, used_at_ms:0, session_id:""};
      if(typeof superSpeedAllowed==='boolean'){
        row.super_speed_allowed=superSpeedAllowed;
        const event=superSpeedAllowed?speedActivity.event(issued.password,machineId,playerName,'allowed',issued.issuedAt):null;
        await sb('rpc/issue_password_with_speed',{method:'POST',body:JSON.stringify({p_issued:row,p_event:event})});
      }else await sb('issued_passwords',{method:'POST',body:JSON.stringify(row)});
    }catch(error){
      if(error.code !== '23505')throw error;
      const winner=await currentIssued(await getMachine(machineId),await latestIssued(machineId));
      if(winner?.password)return winner;
      continue;
    }
    const [fresh,saved]=await Promise.all([getMachine(machineId),getIssued(issued.password)]);
    if(fresh.resetSerial!==machine.resetSerial||fresh.lastEndedSession?.sessionId!==machine.lastEndedSession?.sessionId||!['issued','used'].includes(saved?.status)){
      await sb('issued_passwords?password=eq.'+issued.password+'&status=eq.issued',{method:'PATCH',body:JSON.stringify({status:'cancelled'})});
      throw Object.assign(new Error('台の終了・リセットと重なりました。最新状態を確認して再発行してください。'),{statusCode:409});
    }
    return saved;
  }
  throw new Error("パスワードを発行できませんでした。もう一度お試しください。");
}
function sessionFromRow(row){ return row ? {sessionId:row.session_id, token:row.token, password:row.password, machineId:String(row.machine_id), playerName:row.player_name || "", status:row.status, startedAt:Number(row.started_at_ms || 0), endedAt:Number(row.ended_at_ms || 0), resetSerialAtStart:Number(row.reset_serial_at_start || 0), startSnapshot:row.start_snapshot || null, resultRecord:row.result_record || null, sheets:row.sheets || null} : null; }
async function getSession(id){
  const rows = await sb("sessions?session_id=eq." + encodeURIComponent(String(id)) + "&select=*&limit=1");
  return sessionFromRow(rows[0]);
}
async function saveSession(session){
  return sb("sessions?on_conflict=session_id", {method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=representation"}, body:JSON.stringify({session_id:session.sessionId, token:session.token || "", password:session.password || "", machine_id:String(session.machineId), player_name:session.playerName || "", status:session.status, started_at_ms:session.startedAt || 0, ended_at_ms:session.endedAt || 0, reset_serial_at_start:session.resetSerialAtStart || 0, start_snapshot:session.startSnapshot || null, result_record:session.resultRecord || null, sheets:session.sheets || null})});
}
async function releaseClosedSession(session){
  if(!['ended','cancelled'].includes(session.status))return false;
  const machine=await getMachine(session.machineId);
  if(machine.currentSessionId!==session.sessionId || machine.resetSerial!==session.resetSerialAtStart)return false;
  const patch={locked:false,current_session_id:'',current_player_name:''};
  if(session.status==='ended'&&session.resultRecord&&machine.lastEndedSession?.sessionId!==session.sessionId){
    // The previous end may have saved its result before the final seat write failed.
    // Rebuild its checkpoint from existing records; never bill or append a result again.
    machine.lastEndedSession={sessionId:session.sessionId,playerName:session.playerName,endedAt:session.endedAt,record:session.resultRecord,sheets:session.sheets};
    await hydrateMachineTotal(machine);
    patch.last_ended_session=machine.lastEndedSession;
  }
  const rows=await sb('machine_states?machine_id=eq.'+encodeURIComponent(machine.machineId)+'&current_session_id=eq.'+encodeURIComponent(session.sessionId)+'&reset_serial=eq.'+machine.resetSerial,{
    method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)
  });
  if(!rows.length)return false;
  await sb('issued_passwords?machine_id=eq.'+encodeURIComponent(machine.machineId)+'&session_id=eq.'+encodeURIComponent(session.sessionId)+'&status=in.(issued,used)',{
    method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:session.status})
  });
  return true;
}
async function insertCommand(machineId, command){
  const rows = await sb("machine_commands", {method:"POST", headers:{Prefer:"return=representation"}, body:JSON.stringify({machine_id:String(machineId), command, created_at_ms:ms()})});
  return rows[0];
}
async function appendResult(record){ await sb("session_results", {method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify({ended_at_ms:record.endedAtMs || ms(), machine_id:String(record.machineId || ""), record})}); }
function hasResetSerial(record){
  return record && record.resetSerial !== undefined && record.resetSerial !== null && record.resetSerial !== "";
}
async function restoreResultResetSerials(records){
  const missingSessionIds = [...new Set(records
    .filter(record=>!hasResetSerial(record) && record && record.sessionId)
    .map(record=>String(record.sessionId)))];
  if(!missingSessionIds.length) return records;
  const serialBySession = new Map();
  for(let offset=0;offset<missingSessionIds.length;offset+=50){
    const ids = missingSessionIds.slice(offset, offset + 50);
    const rows = await sb("sessions?select=session_id,reset_serial_at_start&session_id=in.(" + ids.map(encodeURIComponent).join(",") + ")");
    for(const row of rows) serialBySession.set(String(row.session_id), Number(row.reset_serial_at_start || 0));
  }
  return records.map(record=>{
    if(hasResetSerial(record)) return record;
    const sessionId = String(record && record.sessionId || "");
    return serialBySession.has(sessionId) ? {...record, resetSerial:serialBySession.get(sessionId)} : record;
  });
}
async function recentResultRecords(limit=200){
  const rows = await sb("session_results?select=record&order=id.desc&limit=" + Math.max(1, Number(limit) || 200));
  const configuredRecords = rows.map(row=>row.record).filter(record=>record && validMachineId(record.machineId));
  return restoreResultResetSerials(configuredRecords);
}
async function hydrateMachineTotal(machine){
  const ended=machine.lastEndedSession,saved=ended?.machineTotal;
  if(!ended || saved?.sessionId===ended.sessionId && Number(saved.resetSerial)===Number(machine.resetSerial) && saved.stats && Array.isArray(saved.history))return machine;
  // Legacy machines are rebuilt from every completed player, not just the last one.
  // Persist the compact checkpoint on the next session write; normal polling then
  // needs no result-history query. Reads must never overwrite a concurrent reset.
  const records=[];
  for(let offset=0;;offset+=500){
    const rows=await sb('session_results?machine_id=eq.'+encodeURIComponent(machine.machineId)+'&select=record&order=id.asc&limit=500&offset='+offset);
    records.push(...rows.map(row=>row.record).filter(Boolean));
    if(rows.length<500)break;
  }
  const total=machineTotalFor({...machine,currentSessionId:'',lastSnapshot:null},await restoreResultResetSerials(records));
  machine.lastEndedSession={...ended,machineTotal:{...total,resetSerial:machine.resetSerial,sessionId:ended.sessionId}};
  return machine;
}
function postJson(urlString, payload){
  return new Promise((resolve, reject)=>{
    if(!urlString) return resolve({skipped:true});
    const target = new URL(urlString);
    const body = JSON.stringify(payload);
    const req = https.request(target, {method:"POST", headers:{"Content-Type":"application/json", "Content-Length":Buffer.byteLength(body)}}, res=>{
      let text = "";
      res.on("data", chunk=>text += chunk);
      res.on("end", ()=>resolve({status:res.statusCode, body:text}));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
function numberStat(stats, key){ return Number(stats && stats[key] || 0) || 0; }
function sessionStartStats(session, snapshot){
  const clientStartStats = snapshot && snapshot.playSessionStartStats;
  const clientSessionId = String(snapshot && snapshot.playSessionId || "");
  const expectedSessionId = String(session && session.sessionId || "");
  if(clientStartStats && typeof clientStartStats === "object" && clientSessionId && clientSessionId === expectedSessionId){
    return {stats:clientStartStats, source:"client-session-start"};
  }
  return {stats:{}, source:"server-session-zero"};
}
function snapshotForSession(session, machine, submittedSnapshot=null){
  const expectedSessionId = String(session && session.sessionId || "");
  for(const snapshot of [submittedSnapshot, machine && machine.lastSnapshot]){
    if(snapshot && String(snapshot.playSessionId || "") === expectedSessionId) return snapshot;
  }
  return {playSessionId:expectedSessionId, playSessionStartStats:{}, stats:{}};
}
function sessionDelta(session, snapshot){
  const baseline = sessionStartStats(session, snapshot);
  const endStats = snapshot && snapshot.stats ? snapshot.stats : {};
  const countersReset = numberStat(endStats, "totalSpins") < numberStat(baseline.stats, "totalSpins")
    || numberStat(endStats, "totalFee") < numberStat(baseline.stats, "totalFee")
    || numberStat(endStats, "totalPaid") < numberStat(baseline.stats, "totalPaid");
  const startStats = countersReset ? {} : baseline.stats;
  const playerTotalFee = Math.max(0, numberStat(endStats, "totalFee") - numberStat(startStats, "totalFee"));
  const playerTotalPaid = Math.max(0, numberStat(endStats, "totalPaid") - numberStat(startStats, "totalPaid"));
  const playerSpins = Math.max(0, numberStat(endStats, "totalSpins") - numberStat(startStats, "totalSpins"));
  const playerBigCount = Math.max(0, numberStat(endStats, "bigCount") - numberStat(startStats, "bigCount"));
  const playerRegCount = Math.max(0, numberStat(endStats, "midCount") - numberStat(startStats, "midCount"));
  const playerGrapeCount = Math.max(0, numberStat(endStats, "grapeCount") - numberStat(startStats, "grapeCount"));
  const playerProfit = playerTotalPaid - playerTotalFee;
  return {playerTotalFee, playerTotalPaid, playerProfit, playerSpins, playerBigCount, playerRegCount, playerGrapeCount, startStats, baselineSource:countersReset ? baseline.source + "-counter-reset" : baseline.source};
}

async function sendToSheets(record){
  if(!SHEETS_WEBHOOK_URL) return {ok:false, skipped:true, reason:"GOOGLE_SHEETS_WEBHOOK_URL is not set"};
  try{
    const result = await postJson(SHEETS_WEBHOOK_URL, sheetsSettlementPolicy.sheetsSettlement(record));
    const ok = Number(result && result.status) >= 200 && Number(result && result.status) < 300;
    return ok ? {ok:true, result} : {ok:false, error:`Sheets webhook returned ${result && result.status || "unknown"}`};
  }catch(e){ return {ok:false, error:e.message}; }
}
function resultPayload(session, machine, body){
  const snapshot = body.snapshot || machine.lastSnapshot || {};
  const stats = snapshot.stats || {};
  const settings = snapshot.settings || {};
  const delta = sessionDelta(session, snapshot);
  const endedAtMs = ms();
  return {type:"slot-session-ended", storeId:STORE_ID, storeName:STORE_NAME, endedAt:new Date(endedAtMs).toISOString(), endedAtMs, machineId:machine.machineId, machineName:machine.displayName || machineLabel(machine.machineId), machineType:machine.machineType || "generic", playerName:session.playerName || body.playerName || "", ...machineResume.creditFields(machine,session,delta.playerProfit), sessionId:session.sessionId, resetSerial:Number(session.resetSerialAtStart ?? machine.resetSerial) || 0, setting:settings.setting || machine.assignedSetting || "", totalSpins:stats.totalSpins || 0, bigCount:stats.bigCount || 0, regCount:stats.midCount || 0, grapeCount:stats.grapeCount || 0, totalFee:stats.totalFee || 0, totalPaid:stats.totalPaid || 0, profit:Number(stats.profit ?? ((stats.totalPaid || 0) - (stats.totalFee || 0))) || 0, playerSpins:delta.playerSpins, playerBigCount:delta.playerBigCount, playerRegCount:delta.playerRegCount, playerGrapeCount:delta.playerGrapeCount, playerTotalFee:delta.playerTotalFee, playerTotalPaid:delta.playerTotalPaid, playerProfit:delta.playerProfit, billingBasis:"playerProfit", playerBaselineSource:delta.baselineSource, startStats:delta.startStats, currentResultText:snapshot.state ? snapshot.state.resultText || "" : "", stats, settings, normalState:snapshot.normalState || {}, session:snapshot.session || {}};
}

export default async function handler(req, res){
  try{
    if(!req.__vertexGatewayAuthorized) return json(res, 404, {ok:false, error:"not found"});
    if(req.method === "OPTIONS") return json(res, 204, {});
    const rawPath = Array.isArray(req.query.path) ? req.query.path.join("/") : String(req.query.path || "");
    const pathname = "/api/" + rawPath;
    if(pathname === "/api/health") return json(res, 200, {ok:true, storeId:STORE_ID, storeName:STORE_NAME, supabaseUrlSet:!!SUPABASE_URL, supabaseKeySet:!!SUPABASE_KEY});
    if(pathname === "/api/config" && req.method === "GET") return json(res, 200, {ok:true, storeId:STORE_ID, storeName:STORE_NAME, stores:STORE_DIRECTORY, machineCount:MACHINE_DEFINITIONS.length});
    if(pathname === "/api/admin/verify" && req.method === "GET"){
      return adminOk(req)
        ? json(res, 200, {ok:true})
        : json(res, 401, {ok:false, error:"admin password required"});
    }
    if(!requireSupabase(res)) return;
    const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const origin = forwardedProtocol + "://" + req.headers.host;
    if(pathname === "/api/jackpot/pool" && req.method === "GET"){
      const machineId = String(req.query.machineId || "").trim();
      const definition = jackpotMachineDefinition(machineId);
      if(!definition) return json(res, 400, {ok:false, error:"jackpot-enabled machine required"});
      return json(res, 200, {ok:true, pool:await getJackpotPool(definition.poolId)});
    }
    if(pathname === "/api/jackpot/contribute" && req.method === "POST"){
      const body = await readBody(req);
      const machineId = String(body.machineId || "").trim();
      const idempotencyKey = validIdempotencyKey(body.idempotencyKey);
      if(!jackpotMachineDefinition(machineId)) return json(res, 400, {ok:false, error:"jackpot-enabled machine required"});
      if(!idempotencyKey) return json(res, 400, {ok:false, error:"valid idempotencyKey required"});
      return json(res, 200, {ok:true, pool:await contributeJackpot(machineId, idempotencyKey)});
    }
    if(pathname === "/api/jackpot/claim" && req.method === "POST"){
      const body = await readBody(req);
      const machineId = String(body.machineId || "").trim();
      const idempotencyKey = validIdempotencyKey(body.idempotencyKey);
      const qualifyingResult = String(body.qualifyingResult || "").toUpperCase();
      if(!jackpotMachineDefinition(machineId)) return json(res, 400, {ok:false, error:"jackpot-enabled machine required"});
      if(!idempotencyKey) return json(res, 400, {ok:false, error:"valid idempotencyKey required"});
      if(qualifyingResult !== "JP") return json(res, 409, {ok:false, error:"JP outcome required"});
      const machine = await getMachine(machineId);
      const playSessionId = String(body.playSessionId || "");
      if(machine.currentSessionId && playSessionId !== String(machine.currentSessionId)){
        return json(res, 409, {ok:false, error:"machine session mismatch"});
      }
      return json(res, 200, {ok:true, pool:await claimJackpot(machineId, idempotencyKey)});
    }
    const jackpotAmountMatch = pathname.match(/^\/api\/admin\/jackpot\/pools\/([^/]+)\/amount$/);
    if(jackpotAmountMatch && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const poolId = decodeURIComponent(jackpotAmountMatch[1]);
      if(!jackpotPoolDefinition(poolId)) return json(res, 404, {ok:false, error:"jackpot pool not found"});
      const body = await readBody(req);
      const currentPt = validJackpotAmount(body.currentPt);
      if(currentPt === null) return json(res, 400, {ok:false, error:`currentPt must be an integer from 0 to ${MAX_JACKPOT_PT}`});
      return json(res, 200, {ok:true, pool:await setJackpotPoolAmount(poolId, currentPt)});
    }
    if(pathname === "/api/machines" && req.method === "GET"){
      const machines = await getAllMachines();
      const poolIds = [...new Set(machines.map(machine=>machine.poolId).filter(Boolean))];
      const poolEntries = await Promise.all(poolIds.map(async poolId=>{
        try{ return [poolId, await getJackpotPool(poolId)]; }
        catch(e){ return [poolId, null]; }
      }));
      const pools = new Map(poolEntries);
      // Checkpoints keep normal polling independent of completed-session history.
      // Only legacy machines without a checkpoint need a one-time reconstruction.
      await Promise.all(machines.map(hydrateMachineTotal));
      return json(res, 200, machines.map(machine=>publicMachine(machine, machineTotalFor(machine, []), pools.get(machine.poolId) || null)));
    }
    if(pathname === "/api/admin/issue-password" && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const body = await readBody(req);
      if(!validMachineId(body.machineId)) return json(res, 400, {ok:false, error:"invalid machine"});
      const playerName = String(body.playerName || "").trim();
      if(!playerName) return json(res, 400, {ok:false, error:"playerName required"});
      if(body.superSpeedAllowed!==undefined&&(typeof body.superSpeedAllowed!=='boolean'||machineDefinition(body.machineId)?.machineType!=='nova'))return json(res,400,{ok:false,error:'invalid superSpeedAllowed'});
      const issued = await createIssued(String(body.machineId), playerName, body.superSpeedAllowed);
      return json(res, 200, {ok:true, issued});
    }
    if(pathname === '/api/admin/super-speed-activity' && req.method === 'GET'){
      if(!adminOk(req))return json(res,401,{ok:false,error:'admin password required'});
      const date=String(req.query.date||speedActivity.dateJst());
      if(!speedActivity.validDate(date))return json(res,400,{ok:false,error:'invalid date'});
      const events=[];
      for(let offset=0;;offset+=1000){
        const rows=await sb('super_speed_activity?activity_date=eq.'+date+'&select=*&order=occurred_at_ms.asc,id.asc&limit=1000&offset='+offset);
        events.push(...rows.filter(row=>machineDefinition(row.machine_id)?.machineType==='nova'));
        if(rows.length<1000)break;
      }
      return json(res,200,{ok:true,date,rows:speedActivity.summarize(events)});
    }
    if(pathname === '/api/sessions/super-speed-used' && req.method === 'POST'){
      const body=await readBody(req),session=await getSession(String(body.sessionId||''));
      if(!session||session.token!==String(body.token||''))return json(res,403,{ok:false,error:'invalid session'});
      const machine=await getMachine(session.machineId);
      if(session.status!=='active'||machine.currentSessionId!==session.sessionId||machine.resetSerial!==session.resetSerialAtStart)return json(res,409,{ok:false,error:'session is not active'});
      if(machine.machineType!=='nova'||machine.capabilities?.superSpeedAllowed!==true)return json(res,403,{ok:false,error:'super speed is not allowed'});
      const event=speedActivity.event(session.password,session.machineId,session.playerName,'used',ms(),session.sessionId);
      await sb('super_speed_activity?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(event)});
      return json(res,200,{ok:true,date:event.activity_date});
    }
    if(pathname === '/api/admin/passwords/current' && req.method === 'GET'){
      if(!adminOk(req))return json(res,401,{ok:false,error:'admin password required'});
      return json(res,200,await currentPasswordList());
    }
    if(pathname === "/api/admin/passwords" && req.method === "GET"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const rows = await sb("issued_passwords?select=*&order=issued_at_ms.desc&limit=80");
      return json(res, 200, rows
        .filter(row=>validMachineId(row.machine_id))
        .map(row=>({password:row.password, machineId:String(row.machine_id), playerName:row.player_name || "", status:row.status, issuedAt:Number(row.issued_at_ms || 0), usedAt:Number(row.used_at_ms || 0), sessionId:row.session_id || ""})));
    }
    if(pathname === "/api/sessions/start" && req.method === "POST"){
      const body = await readBody(req);
      const password = String(body.password || "").trim().toUpperCase();
      const requestedMachineId = String(body.requestedMachineId || "").trim();
      const issued = await getIssued(password);
      if(!issued) return json(res, 403, {ok:false, error:"password not found"});
      if(!validMachineId(issued.machineId)) return json(res, 403, {ok:false, error:"このパスワードは旧構成用です"});
      if(requestedMachineId && requestedMachineId !== String(issued.machineId)) return json(res, 403, {ok:false, error:"このパスワードは別の台用です"});
      const machine = await hydrateMachineTotal(await getMachine(issued.machineId));
      const existingSession = issued.sessionId ? await getSession(issued.sessionId) : null;
      const displayBaseline=existingSession?.startSnapshot?.machineDisplayBaseline || machineDisplayBaseline({...machine,lastSnapshot:existingSession ? existingSession.startSnapshot : machine.lastSnapshot});
      const iframeUrlFor = sessionId=>machineGameUrl(machine, origin, sessionId,displayBaseline);
      if(!machine.gameUrl) return json(res, 500, {ok:false, error:"この台のゲームURLが設定されていません"});
      if(issued.status === "used" && existingSession && existingSession.status === "active") return json(res, 200, {ok:true, resumed:true, session:{sessionId:existingSession.sessionId, token:existingSession.token, machineId:machine.machineId, playerName:existingSession.playerName}, machineDisplayBaseline:displayBaseline,resumeState:machineResume.forSession(machine,existingSession), iframeUrl:iframeUrlFor(existingSession.sessionId)});
      if(issued.status !== "issued") return json(res, 403, {ok:false, error:"このパスワードは終了済みです"});
      const latest=await latestIssued(machine.machineId);
      if(passwordIssuance.current(machine,latest?[latest]:[])?.password!==password)return json(res,403,{ok:false,error:'このパスワードは現在の発行番号ではありません'});
      if(machine.currentSessionId && machine.currentSessionId !== (existingSession && existingSession.sessionId)) return json(res, 409, {ok:false, error:"machine is busy"});
      const session = {sessionId:makeId("sess"), token:crypto.randomBytes(16).toString("hex"), password, machineId:machine.machineId, playerName:issued.playerName, status:"active", startedAt:ms(), endedAt:0, resetSerialAtStart:machine.resetSerial || 0, startSnapshot:{...machine.lastSnapshot,machineDisplayBaseline:displayBaseline,playerCreditCarry:machineResume.creditCarryFor(machine,issued.playerName)}};
      issued.status = "used"; issued.usedAt = ms(); issued.sessionId = session.sessionId;
      machine.locked = true; machine.currentSessionId = session.sessionId; machine.currentPlayerName = session.playerName;
      await saveIssued(issued); await saveSession(session); await upsertMachine(machine);
      return json(res, 200, {ok:true, session:{sessionId:session.sessionId, token:session.token, machineId:machine.machineId, playerName:session.playerName}, machineDisplayBaseline:displayBaseline,resumeState:machineResume.forSession(machine,session), iframeUrl:iframeUrlFor(session.sessionId)});
    }
    if(pathname === "/api/sessions/end" && req.method === "POST"){
      const body = await readBody(req);
      const session = await getSession(String(body.sessionId || ""));
      if(!session || session.token !== String(body.token || "")) return json(res, 403, {ok:false, error:"invalid session"});
      if(session.status === "ended") return json(res, 200, {ok:true, alreadyEnded:true, released:await releaseClosedSession(session), record:session.resultRecord || null});
      const machine = await getMachine(session.machineId);
      const snapshot = snapshotForSession(session, machine, body.snapshot);
      if(body.snapshot && snapshot === body.snapshot){
        snapshot.settings={...snapshot.settings,...adminSettings.completionSettings(machine.lastSnapshot?.settings,machine.machineType)};
        machine.lastSnapshot = snapshot;
      }
      await hydrateMachineTotal(machine);
      const record = {...resultPayload(session, machine, {...body, snapshot}), forced:!!body.forced};
      const machineTotal=completedMachineTotal(machine,record);
      await appendResult(record);
      const sheets = await sendToSheets(record);
      session.status = "ended"; session.endedAt = ms(); session.resultRecord = record; session.sheets = sheets;
      await retirePasswords(machine.machineId,'ended');
      machine.locked = false; machine.currentSessionId = ""; machine.currentPlayerName = ""; machine.lastEndedSession = {sessionId:session.sessionId, playerName:session.playerName, endedAt:session.endedAt, record, sheets, machineTotal};
      await saveSession(session); await upsertMachine(machine);
      return json(res, 200, {ok:true, record, sheets});
    }
    if(pathname === "/api/sessions/prepare-end" && req.method === "POST"){
      const body = await readBody(req);
      const session = await getSession(String(body.sessionId || ""));
      if(!session || session.token !== String(body.token || "")) return json(res, 403, {ok:false, error:"invalid session"});
      if(session.status !== "active") return json(res, 409, {ok:false, error:"session is not active"});
      const machine = await getMachine(session.machineId);
      if(String(machine.currentSessionId || "") !== String(session.sessionId)) return json(res, 409, {ok:false, error:"machine session mismatch"});
      const row = await insertCommand(machine.machineId, {type:"prepareEnd", sessionId:session.sessionId});
      return json(res, 200, {ok:true, delivered:true, commandId:row.id});
    }
    let m = pathname.match(/^\/api\/machines\/([^/]+)\/state$/);
    if(m && req.method === "POST"){
      const machineId = decodeURIComponent(m[1]);
      if(!validMachineId(machineId)) return json(res, 404, {ok:false, error:"machine not found"});
      const body = await readBody(req);
      const machine = await getMachine(machineId);
      const incomingSessionId = String(body.playSessionId || "");
      if(incomingSessionId && incomingSessionId !== String(machine.currentSessionId || "")){
        return json(res, 200, {ok:true, ignored:true, reason:"stale play session"});
      }
      if(String(machine.lastSnapshot?.playSessionId)===incomingSessionId && Number(body.capturedAt||0)<Number(machine.lastSnapshot?.capturedAt||0))return json(res,200,{ok:true,ignored:true});
      const completion=adminSettings.completionSettings(machine.lastSnapshot?.settings,machine.machineType);
      machine.lastSnapshot = {...body, settings:{...body.settings,...completion},machineId, online:true, updatedAt:ms()};
      machine.updatedAt = ms();
      // A state request may pass authentication, then arrive after end/reset or a
      // new customer. Compare ownership at the write itself and update snapshot
      // fields only: a delayed heartbeat must never restore occupied/ended data.
      const saved=await sb('machine_states?machine_id=eq.'+encodeURIComponent(machineId)+'&current_session_id=eq.'+encodeURIComponent(incomingSessionId)+'&reset_serial=eq.'+machine.resetSerial,{
        method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({last_snapshot:machine.lastSnapshot,updated_at_ms:machine.updatedAt})
      });
      if(!saved.length)return json(res,200,{ok:true,ignored:true,reason:'stale play session'});
      return json(res, 200, {ok:true});
    }
    m = pathname.match(/^\/api\/machines\/([^/]+)\/commands\/poll$/);
    if(m && req.method === "GET"){
      const machineId = decodeURIComponent(m[1]);
      if(!validMachineId(machineId)) return json(res, 404, {ok:false, error:"machine not found"});
      const since = Number(req.query.since || 0) || 0;
      const [machine, rows] = await Promise.all([
        getMachine(machineId),
        sb("machine_commands?machine_id=eq." + encodeURIComponent(machineId) + "&id=gt." + encodeURIComponent(String(since)) + "&select=*&order=id.asc&limit=25")
      ]);
      return json(res, 200, {ok:true, controls:{superSpeedAllowed:machine.machineType==='nova' && machine.capabilities.superSpeedAllowed===true,...adminSettings.completionSettings(machine.lastSnapshot?.settings,machine.machineType)}, commands:rows.map(row=>({id:Number(row.id), machineId:String(row.machine_id), command:row.command || {}, createdAtMs:Number(row.created_at_ms || 0)}))});
    }
    m = pathname.match(/^\/api\/admin\/machines\/([^/]+)\/super-speed$/);
    if(m && req.method === "POST"){
      if(!adminOk(req)) return json(res,401,{ok:false,error:"admin password required"});
      const id=decodeURIComponent(m[1]),definition=machineDefinition(id);
      if(definition?.machineType!=='nova')return json(res,404,{ok:false,error:"NOVA machine not found"});
      const body=await readBody(req);
      if(typeof body.enabled!=='boolean')return json(res,400,{ok:false,error:"enabled must be boolean"});
      const capabilities={...definition.capabilities,superSpeedAllowed:body.enabled};
      await sb('machine_states?on_conflict=machine_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({machine_id:id,store_id:STORE_ID,capabilities})});
      return json(res,200,{ok:true,superSpeedAllowed:body.enabled});
    }
    m = pathname.match(/^\/api\/admin\/machines\/([^/]+)\/setting$/);
    if(m && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const id = decodeURIComponent(m[1]);
      const body = await readBody(req);
      if(!validMachineId(id)) return json(res,404,{ok:false,error:"machine not found"});
      const machine = await getMachine(id);
      let patch;
      try{patch=adminSettings.settingsPatch(body,machine.machineType);}catch(error){return json(res,400,{ok:false,error:error.message});}
      if(body.completeLimitPt !== undefined && !machine.capabilities?.completeLimit) return json(res,400,{ok:false,error:"この台はコンプリート設定の対象外です"});
      const currentSettings = machine.lastSnapshot && machine.lastSnapshot.settings ? machine.lastSnapshot.settings : {};
      const setting = patch.setting ?? machine.assignedSetting ?? currentSettings.setting ?? 1;
      const nextSettings = {...currentSettings,...adminSettings.completionSettings(currentSettings,machine.machineType), setting, ...patch};
      const completeLimitPt = nextSettings.completeLimitPt || 19000;
      machine.assignedSetting = setting;
      machine.lastSnapshot = machine.lastSnapshot || {machineId:machine.machineId, stats:{}, settings:{}, updatedAt:ms()};
      machine.lastSnapshot.settings = nextSettings;
      machine.lastSnapshot.updatedAt = ms();
      await upsertMachine(machine, {revokeSuperSpeed:patch.setting !== undefined});
      const row = await insertCommand(machine.machineId, {type:"applySettings", settings:patch});
      return json(res, 200, {ok:true, setting, completeLimitPt, delivered:true, commandId:row.id, machine:publicMachine(machine, machineTotalFor(machine, []))});
    }
    m = pathname.match(/^\/api\/admin\/machines\/([^/]+)\/reset$/);
    if(m && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const id = decodeURIComponent(m[1]);
      const cached = req.__vertexResetMachine;
      const machine = cached && String(cached.machine_id) === id ? machineFromRow(cached) : await getMachine(id);
      const preservedSettings = machine.lastSnapshot && machine.lastSnapshot.settings
        ? machine.lastSnapshot.settings
        : {setting:machine.assignedSetting || 1, completeLimitPt:19000};
      await retirePasswords(machine.machineId,'cancelled');
      machine.locked = false; machine.currentSessionId = ""; machine.currentPlayerName = ""; machine.lastEndedSession = null; machine.lastSnapshot = {machineId:machine.machineId, stats:null, settings:preservedSettings, updatedAt:ms()}; machine.resetSerial = Number(machine.resetSerial || 0) + 1;
      await upsertMachine(machine, {revokeSuperSpeed:true});
      const row = await insertCommand(machine.machineId, {type:"reset", reason:"admin-reset"});
      return json(res, 200, {ok:true, delivered:true, commandId:row.id, machine:publicMachine(machine, machineTotalFor(machine, []))});
    }
    m = pathname.match(/^\/api\/admin\/machines\/([^/]+)\/force-end$/);
    if(m && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      let machine = await getMachine(decodeURIComponent(m[1]));
      const session = machine.currentSessionId ? await getSession(machine.currentSessionId) : null;
      const body=await readBody(req);
      if(body.recoverOnly && (!session||!['ended','cancelled'].includes(session.status))){
        return json(res,409,{ok:false,error:'終了済みの記録を確認できません。利用状態は変更していません。'});
      }
      if(session && session.status !== "active"){
        const released=await releaseClosedSession(session);
        if(!released)return json(res,409,{ok:false,error:'台の状態が変更されました。更新して再確認してください。'});
        return json(res,200,{ok:true,alreadyEnded:true,released,record:session.resultRecord||null,sheets:session.sheets||null});
      }
      if(session && session.status === "active"){
        if(machine.machineType==='nova'&&!(machine.lastSnapshot?.endPreparedAt&&machine.lastSnapshot.playSessionId===session.sessionId)){
          await insertCommand(machine.machineId,{type:'prepareEnd',sessionId:session.sessionId});
          const deadline=ms()+6500;
          while(ms()<deadline){
            await new Promise(resolve=>setTimeout(resolve,350));
            machine=await getMachine(machine.machineId);
            if(String(machine.currentSessionId)!==String(session.sessionId))return json(res,409,{ok:false,error:'台の状態が変更されました。更新してください'});
            if(machine.lastSnapshot?.endPreparedAt&&machine.lastSnapshot.playSessionId===session.sessionId)break;
          }
        }
        await hydrateMachineTotal(machine);
        const record = {...resultPayload(session, machine, {snapshot:snapshotForSession(session, machine)}), forced:true, forcedBy:"admin"};
        const machineTotal=completedMachineTotal(machine,record);
        await appendResult(record);
        // Revoke play before waiting for the external settlement service.
        session.status = "ended"; session.endedAt = ms(); session.resultRecord = record;
        await saveSession(session);
        const sheets = await sendToSheets(record);
        session.sheets = sheets;
        await retirePasswords(machine.machineId,'ended');
        machine.locked = false; machine.currentSessionId = ""; machine.currentPlayerName = ""; machine.lastEndedSession = {sessionId:session.sessionId, playerName:session.playerName, endedAt:session.endedAt, record, sheets, machineTotal, forced:true};
        await saveSession(session); await upsertMachine(machine);
        return json(res, 200, {ok:true, forced:true, record, sheets});
      }
      const retired=await retirePasswords(machine.machineId,'cancelled');
      if(!machine.currentSessionId&&retired.some(row=>!row.session_id))return json(res,200,{ok:true,released:true});
      if(machine.lastEndedSession){
        machine.locked = false; machine.currentSessionId = ""; machine.currentPlayerName = "";
        await upsertMachine(machine);
        return json(res, 200, {ok:true, released:true, alreadyEnded:true, record:machine.lastEndedSession.record || null, sheets:machine.lastEndedSession.sheets || null});
      }
      if(!machine.lastSnapshot) return json(res, 400, {ok:false, error:"終了できるデータがありません"});
      const forcedSession = {sessionId:makeId("forced"), token:"", password:"", machineId:machine.machineId, playerName:machine.currentPlayerName || "強制終了", status:"active", startedAt:0, endedAt:0, startSnapshot:machine.lastSnapshot || null};
      const record = {...resultPayload(forcedSession, machine, {}), forced:true, forcedBy:"admin"};
      await appendResult(record);
      const sheets = await sendToSheets(record);
      machine.locked = false; machine.currentSessionId = ""; machine.currentPlayerName = ""; machine.lastEndedSession = {sessionId:forcedSession.sessionId, playerName:forcedSession.playerName, endedAt:ms(), record, sheets, forced:true};
      await upsertMachine(machine);
      return json(res, 200, {ok:true, record, sheets});
    }
    m = pathname.match(/^\/api\/machines\/([^/]+)\/command$/);
    if(m && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const machineId = decodeURIComponent(m[1]);
      const command = await readBody(req);
      const row = await insertCommand(machineId, command);
      return json(res, 200, {ok:true, delivered:true, commandId:row.id});
    }
    if(pathname === "/api/command-all" && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const command = await readBody(req);
      const rows = [];
      for(const machine of await getAllMachines()) rows.push(await insertCommand(machine.machineId, command));
      return json(res, 200, {ok:true, delivered:rows.length});
    }
    if(pathname === "/api/results" && req.method === "GET"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      return json(res, 200, await recentResultRecords(200));
    }
    return json(res, 404, {ok:false, error:"not found"});
  }catch(e){
    try{ return json(res, Number(e.statusCode)||500, {ok:false, error:e && e.message ? e.message : String(e)}); }
    catch(finalError){ res.statusCode = 500; return res.end("api error"); }
  }
}
