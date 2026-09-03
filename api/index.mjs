import * as https from "node:https";
import * as crypto from "node:crypto";
import machineTotals from "../machine-totals.cjs";
import machineConfig from "../machine-config.cjs";

const {machineTotalFor} = machineTotals;
const {STORE_ID, STORE_NAME, MACHINE_DEFINITIONS, machineDefinition} = machineConfig;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "");
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const SHEETS_WEBHOOK_URL = String(process.env.GOOGLE_SHEETS_WEBHOOK_URL || "").trim();

function json(res, status, data){
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Admin-Password");
  res.end(JSON.stringify(data));
}
function adminOk(req){ return !ADMIN_PASSWORD || String(req.headers["x-admin-password"] || "") === ADMIN_PASSWORD; }
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
    headers:{apikey:SUPABASE_KEY, Authorization:"Bearer " + SUPABASE_KEY, "Content-Type":"application/json", ...(options.headers || {})}
  });
  if(!result.ok) throw new Error(typeof result.data === "string" ? result.data : JSON.stringify(result.data));
  return result.data;
}
function ms(){ return Date.now(); }
function makeId(prefix){ return prefix + "_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex"); }
function generatePassword(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for(let i=0;i<6;i++) value += alphabet[crypto.randomInt(0, alphabet.length)];
  return value;
}
function validMachineId(id){ return !!machineDefinition(id); }
function machineLabel(id){ const definition = machineDefinition(id); return definition ? definition.displayName : String(id); }
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
    capabilities:definition.capabilities || row.capabilities || {completeLimit:false, jackpot:false},
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
function publicMachine(machine, machineTotal){
  const snapshot = machine.lastSnapshot || null;
  const stats = snapshot && snapshot.stats ? snapshot.stats : null;
  const settings = snapshot && snapshot.settings ? snapshot.settings : {setting:machine.assignedSetting || 1, completeLimitPt:19000};
  return {storeId:STORE_ID, machineId:machine.machineId, displayName:machine.displayName || machineLabel(machine.machineId), machineType:machine.machineType || "generic", gameUrl:machine.gameUrl || "", poolId:machine.poolId || "", capabilities:machine.capabilities || {completeLimit:false, jackpot:false}, online:!!machine.online, locked:!!machine.locked, currentSessionId:machine.currentSessionId || "", currentPlayerName:machine.currentPlayerName || "", updatedAt:machine.updatedAt || 0, resetSerial:machine.resetSerial || 0, assignedSetting:machine.assignedSetting || (stats && stats.setting) || settings.setting || 1, lastEndedSession:machine.lastEndedSession || null, playSessionId:snapshot && snapshot.playSessionId || "", playSessionStartStats:snapshot && snapshot.playSessionStartStats || null, settings, stats, slumpHistory:stats && Array.isArray(stats.slumpHistory) ? stats.slumpHistory : [{spin:0, profit:0}], machineTotalStats:machineTotal.stats, machineTotalSlumpHistory:machineTotal.history};
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
async function upsertMachine(machine){
  const row = {machine_id:String(machine.machineId), store_id:STORE_ID, display_name:machine.displayName || machineLabel(machine.machineId), machine_type:machine.machineType || "generic", game_url:machine.gameUrl || "", pool_id:machine.poolId || "", capabilities:machine.capabilities || {}, locked:!!machine.locked, reset_serial:Number(machine.resetSerial || 0), current_session_id:machine.currentSessionId || "", current_player_name:machine.currentPlayerName || "", last_snapshot:machine.lastSnapshot || null, last_ended_session:machine.lastEndedSession || null, updated_at_ms:Number(machine.updatedAt || 0), assigned_setting:Number(machine.assignedSetting || 1)};
  const options = {method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=representation"}};
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
      assigned_setting:row.assigned_setting
    };
    return sb("machine_states?on_conflict=machine_id", {...options, body:JSON.stringify(legacyRow)});
  }
}
function machineGameUrl(machine, adminOrigin, sessionId){
  if(!machine || !machine.gameUrl) return "";
  const url = new URL(machine.gameUrl, adminOrigin);
  url.searchParams.set("controller", "vertex");
  url.searchParams.set("storeId", STORE_ID);
  url.searchParams.set("machine", machine.machineId);
  url.searchParams.set("server", adminOrigin);
  url.searchParams.set("creditBaseline", "0");
  url.searchParams.set("playSessionId", String(sessionId || ""));
  return url.toString();
}
async function getIssued(password){
  const rows = await sb("issued_passwords?password=eq." + encodeURIComponent(password) + "&select=*&limit=1");
  const row = rows[0];
  return row ? {password:row.password, machineId:String(row.machine_id), playerName:row.player_name || "", status:row.status, issuedAt:Number(row.issued_at_ms || 0), usedAt:Number(row.used_at_ms || 0), sessionId:row.session_id || ""} : null;
}
async function saveIssued(issued){
  return sb("issued_passwords?on_conflict=password", {method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=representation"}, body:JSON.stringify({password:issued.password, machine_id:String(issued.machineId), player_name:issued.playerName || "", status:issued.status, issued_at_ms:issued.issuedAt || 0, used_at_ms:issued.usedAt || 0, session_id:issued.sessionId || ""})});
}
function sessionFromRow(row){ return row ? {sessionId:row.session_id, token:row.token, password:row.password, machineId:String(row.machine_id), playerName:row.player_name || "", status:row.status, startedAt:Number(row.started_at_ms || 0), endedAt:Number(row.ended_at_ms || 0), resetSerialAtStart:Number(row.reset_serial_at_start || 0), startSnapshot:row.start_snapshot || null, resultRecord:row.result_record || null, sheets:row.sheets || null} : null; }
async function getSession(id){
  const rows = await sb("sessions?session_id=eq." + encodeURIComponent(String(id)) + "&select=*&limit=1");
  return sessionFromRow(rows[0]);
}
async function saveSession(session){
  return sb("sessions?on_conflict=session_id", {method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=representation"}, body:JSON.stringify({session_id:session.sessionId, token:session.token || "", password:session.password || "", machine_id:String(session.machineId), player_name:session.playerName || "", status:session.status, started_at_ms:session.startedAt || 0, ended_at_ms:session.endedAt || 0, reset_serial_at_start:session.resetSerialAtStart || 0, start_snapshot:session.startSnapshot || null, result_record:session.resultRecord || null, sheets:session.sheets || null})});
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
  try{ return {ok:true, result:await postJson(SHEETS_WEBHOOK_URL, record)}; }catch(e){ return {ok:false, error:e.message}; }
}
function resultPayload(session, machine, body){
  const snapshot = body.snapshot || machine.lastSnapshot || {};
  const stats = snapshot.stats || {};
  const settings = snapshot.settings || {};
  const delta = sessionDelta(session, snapshot);
  const endedAtMs = ms();
  return {type:"slot-session-ended", storeId:STORE_ID, storeName:STORE_NAME, endedAt:new Date(endedAtMs).toISOString(), endedAtMs, machineId:machine.machineId, machineName:machine.displayName || machineLabel(machine.machineId), machineType:machine.machineType || "generic", playerName:session.playerName || body.playerName || "", sessionId:session.sessionId, password:session.password, resetSerial:Number(session.resetSerialAtStart ?? machine.resetSerial) || 0, setting:settings.setting || machine.assignedSetting || "", totalSpins:stats.totalSpins || 0, bigCount:stats.bigCount || 0, regCount:stats.midCount || 0, grapeCount:stats.grapeCount || 0, totalFee:stats.totalFee || 0, totalPaid:stats.totalPaid || 0, profit:Number(stats.profit ?? ((stats.totalPaid || 0) - (stats.totalFee || 0))) || 0, playerSpins:delta.playerSpins, playerBigCount:delta.playerBigCount, playerRegCount:delta.playerRegCount, playerGrapeCount:delta.playerGrapeCount, playerTotalFee:delta.playerTotalFee, playerTotalPaid:delta.playerTotalPaid, playerProfit:delta.playerProfit, billingBasis:"playerProfit", playerBaselineSource:delta.baselineSource, startStats:delta.startStats, currentResultText:snapshot.state ? snapshot.state.resultText || "" : "", stats, settings, normalState:snapshot.normalState || {}, session:snapshot.session || {}};
}

export default async function handler(req, res){
  try{
    if(req.method === "OPTIONS") return json(res, 204, {});
    const rawPath = Array.isArray(req.query.path) ? req.query.path.join("/") : String(req.query.path || "");
    const pathname = "/api/" + rawPath;
    if(pathname === "/api/health") return json(res, 200, {ok:true, storeId:STORE_ID, storeName:STORE_NAME, supabaseUrlSet:!!SUPABASE_URL, supabaseKeySet:!!SUPABASE_KEY});
    if(pathname === "/api/config" && req.method === "GET") return json(res, 200, {ok:true, storeId:STORE_ID, storeName:STORE_NAME, machineCount:MACHINE_DEFINITIONS.length});
    if(pathname === "/api/admin/verify" && req.method === "GET"){
      return adminOk(req)
        ? json(res, 200, {ok:true})
        : json(res, 401, {ok:false, error:"admin password required"});
    }
    if(!requireSupabase(res)) return;
    const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const origin = forwardedProtocol + "://" + req.headers.host;
    if(pathname === "/api/machines" && req.method === "GET"){
      const machines = await getAllMachines();
      // Keep the frequently-polled machine list lightweight. Completed-session
      // history is loaded separately by the authenticated admin results route.
      return json(res, 200, machines.map(machine=>publicMachine(machine, machineTotalFor(machine, []))));
    }
    if(pathname === "/api/admin/issue-password" && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const body = await readBody(req);
      if(!validMachineId(body.machineId)) return json(res, 400, {ok:false, error:"invalid machine"});
      const machine = await getMachine(body.machineId);
      const playerName = String(body.playerName || "").trim();
      if(!playerName) return json(res, 400, {ok:false, error:"playerName required"});
      const issued = {password:generatePassword(), machineId:machine.machineId, playerName, status:"issued", issuedAt:ms(), usedAt:0, sessionId:""};
      await saveIssued(issued);
      return json(res, 200, {ok:true, issued});
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
      const machine = await getMachine(issued.machineId);
      const existingSession = issued.sessionId ? await getSession(issued.sessionId) : null;
      const iframeUrlFor = sessionId=>machineGameUrl(machine, origin, sessionId);
      if(!machine.gameUrl) return json(res, 500, {ok:false, error:"この台のゲームURLが設定されていません"});
      if(issued.status === "used" && existingSession && existingSession.status === "active") return json(res, 200, {ok:true, resumed:true, session:{sessionId:existingSession.sessionId, token:existingSession.token, machineId:machine.machineId, playerName:existingSession.playerName}, iframeUrl:iframeUrlFor(existingSession.sessionId)});
      if(issued.status !== "issued") return json(res, 403, {ok:false, error:"このパスワードは終了済みです"});
      if(machine.currentSessionId && machine.currentSessionId !== (existingSession && existingSession.sessionId)) return json(res, 409, {ok:false, error:"machine is busy"});
      const session = {sessionId:makeId("sess"), token:crypto.randomBytes(16).toString("hex"), password, machineId:machine.machineId, playerName:issued.playerName, status:"active", startedAt:ms(), endedAt:0, resetSerialAtStart:machine.resetSerial || 0, startSnapshot:machine.lastSnapshot || null};
      issued.status = "used"; issued.usedAt = ms(); issued.sessionId = session.sessionId;
      machine.locked = true; machine.currentSessionId = session.sessionId; machine.currentPlayerName = session.playerName;
      await saveIssued(issued); await saveSession(session); await upsertMachine(machine);
      return json(res, 200, {ok:true, session:{sessionId:session.sessionId, token:session.token, machineId:machine.machineId, playerName:session.playerName}, iframeUrl:iframeUrlFor(session.sessionId)});
    }
    if(pathname === "/api/sessions/end" && req.method === "POST"){
      const body = await readBody(req);
      const session = await getSession(String(body.sessionId || ""));
      if(!session || session.token !== String(body.token || "")) return json(res, 403, {ok:false, error:"invalid session"});
      if(session.status === "ended") return json(res, 200, {ok:true, alreadyEnded:true, record:session.resultRecord || null});
      const machine = await getMachine(session.machineId);
      const snapshot = snapshotForSession(session, machine, body.snapshot);
      if(body.snapshot && snapshot === body.snapshot) machine.lastSnapshot = snapshot;
      const record = {...resultPayload(session, machine, {...body, snapshot}), forced:!!body.forced};
      await appendResult(record);
      const sheets = await sendToSheets(record);
      session.status = "ended"; session.endedAt = ms(); session.resultRecord = record; session.sheets = sheets;
      machine.locked = false; machine.currentSessionId = ""; machine.currentPlayerName = ""; machine.lastEndedSession = {sessionId:session.sessionId, playerName:session.playerName, endedAt:session.endedAt, record, sheets};
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
      machine.lastSnapshot = {...body, machineId, online:true, updatedAt:ms()};
      const definition = machineDefinition(machineId);
      machine.displayName = definition ? definition.displayName : body.name || machine.displayName || machineId;
      machine.updatedAt = ms();
      if(body.settings && body.settings.setting) machine.assignedSetting = Number(body.settings.setting) || machine.assignedSetting;
      await upsertMachine(machine);
      return json(res, 200, {ok:true});
    }
    m = pathname.match(/^\/api\/machines\/([^/]+)\/commands\/poll$/);
    if(m && req.method === "GET"){
      const machineId = decodeURIComponent(m[1]);
      const since = Number(req.query.since || 0) || 0;
      const rows = await sb("machine_commands?machine_id=eq." + encodeURIComponent(machineId) + "&id=gt." + encodeURIComponent(String(since)) + "&select=*&order=id.asc&limit=25");
      return json(res, 200, {ok:true, commands:rows.map(row=>({id:Number(row.id), machineId:String(row.machine_id), command:row.command || {}, createdAtMs:Number(row.created_at_ms || 0)}))});
    }
    m = pathname.match(/^\/api\/admin\/machines\/([^/]+)\/setting$/);
    if(m && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const id = decodeURIComponent(m[1]);
      const body = await readBody(req);
      const setting = Math.max(1, Math.min(6, Math.round(Number(body.setting) || 1)));
      const completeLimitPt = Math.max(1, Math.min(999999, Math.round(Number(body.completeLimitPt) || 19000)));
      const machine = await getMachine(id);
      const currentSettings = machine.lastSnapshot && machine.lastSnapshot.settings ? machine.lastSnapshot.settings : {};
      machine.assignedSetting = setting;
      machine.lastSnapshot = machine.lastSnapshot || {machineId:machine.machineId, stats:{}, settings:{}, updatedAt:ms()};
      machine.lastSnapshot.settings = {...currentSettings, setting, completeLimitPt};
      machine.lastSnapshot.updatedAt = ms();
      await upsertMachine(machine);
      const row = await insertCommand(machine.machineId, {type:"applySettings", settings:machine.lastSnapshot.settings});
      return json(res, 200, {ok:true, setting, completeLimitPt, delivered:true, commandId:row.id});
    }
    m = pathname.match(/^\/api\/admin\/machines\/([^/]+)\/reset$/);
    if(m && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const machine = await getMachine(decodeURIComponent(m[1]));
      const preservedSettings = machine.lastSnapshot && machine.lastSnapshot.settings
        ? machine.lastSnapshot.settings
        : {setting:machine.assignedSetting || 1, completeLimitPt:19000};
      machine.locked = false; machine.currentSessionId = ""; machine.currentPlayerName = ""; machine.lastEndedSession = null; machine.lastSnapshot = {machineId:machine.machineId, stats:null, settings:preservedSettings, updatedAt:ms()}; machine.resetSerial = Number(machine.resetSerial || 0) + 1;
      await upsertMachine(machine);
      const row = await insertCommand(machine.machineId, {type:"reset", reason:"admin-reset"});
      return json(res, 200, {ok:true, delivered:true, commandId:row.id});
    }
    m = pathname.match(/^\/api\/admin\/machines\/([^/]+)\/force-end$/);
    if(m && req.method === "POST"){
      if(!adminOk(req)) return json(res, 401, {ok:false, error:"admin password required"});
      const machine = await getMachine(decodeURIComponent(m[1]));
      const session = machine.currentSessionId ? await getSession(machine.currentSessionId) : null;
      if(session && session.status === "active"){
        const record = {...resultPayload(session, machine, {snapshot:snapshotForSession(session, machine)}), forced:true, forcedBy:"admin"};
        await appendResult(record);
        const sheets = await sendToSheets(record);
        session.status = "ended"; session.endedAt = ms(); session.resultRecord = record; session.sheets = sheets;
        machine.locked = false; machine.currentSessionId = ""; machine.currentPlayerName = ""; machine.lastEndedSession = {sessionId:session.sessionId, playerName:session.playerName, endedAt:session.endedAt, record, sheets, forced:true};
        await saveSession(session); await upsertMachine(machine);
        return json(res, 200, {ok:true, forced:true, record, sheets});
      }
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
    try{ return json(res, 500, {ok:false, error:e && e.message ? e.message : String(e)}); }
    catch(finalError){ res.statusCode = 500; return res.end("api error"); }
  }
}
