const machineResume = require("./machine-resume.cjs");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const passwordIssuance = require('./password-issuance.cjs');
const speedActivity = require('./super-speed-activity.cjs');
const {sheetsSettlement} = require('./sheets-settlement.cjs');
const { URL } = require("url");
const {machineTotalFor,completedMachineTotal,machineDisplayBaseline} = require("./machine-totals.cjs");
const {settingsPatch,completionSettings} = require("./admin-settings.cjs");
const {
  STORE_ID,
  STORE_NAME,
  STORE_DIRECTORY,
  MACHINE_DEFINITIONS,
  machineDefinition
} = require("./machine-config.cjs");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "admin-state.json");
const RESULTS_FILE = path.join(DATA_DIR, "session-results.jsonl");
const SHEETS_WEBHOOK_URL = String(process.env.GOOGLE_SHEETS_WEBHOOK_URL || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const JACKPOT_CONTRIBUTION_RATE = 0.10;
const JACKPOT_SPIN_COST_PT = 100;
const JACKPOT_CONTRIBUTION_PT = Math.round(JACKPOT_SPIN_COST_PT * JACKPOT_CONTRIBUTION_RATE);
const MAX_JACKPOT_PT = 999999999;
const machines = new Map();
const adminClients = new Set();
const commandClients = new Map();

function machineLabel(id){
  const definition = machineDefinition(id);
  return definition && definition.displayName
    ? definition.displayName
    : String(id);
}
function emptyMachine(id){
  const definition = machineDefinition(id) || {};
  return {
    machineId:String(id),
    displayName:machineLabel(id),
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

let state = {
  version:2,
  storeId:STORE_ID,
  storeName:STORE_NAME,
  machines:{},
  issuedPasswords:{},
  superSpeedActivity:{},
  sessions:{},
  commands:[],
  jackpotPools:{},
  jackpotEvents:{},
  updatedAt:Date.now()
};

function ensureDataDir(){ fs.mkdirSync(DATA_DIR, {recursive:true}); }

function loadState(){
  ensureDataDir();
  try{
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    state = {...state, ...parsed, machines:parsed.machines || {}, issuedPasswords:parsed.issuedPasswords || {}, sessions:parsed.sessions || {}, commands:Array.isArray(parsed.commands) ? parsed.commands : [], jackpotPools:parsed.jackpotPools || {}, jackpotEvents:parsed.jackpotEvents || {}};
  }catch(e){}
  for(const definition of MACHINE_DEFINITIONS){
    const id = definition.machineId;
    const superSpeedAllowed=state.machines[id]?.capabilities?.superSpeedAllowed===true;
    state.machines[id] = {...emptyMachine(id), ...(state.machines[id] || {}), ...definition,
      capabilities:{...definition.capabilities,superSpeedAllowed}};
    machines.set(id, state.machines[id]);
  }
  for(const [id, savedMachine] of Object.entries(state.machines)){
    if(machines.has(id)) continue;
    machines.set(id, {...emptyMachine(id), ...savedMachine});
  }
}

function saveState(){
  ensureDataDir();
  state.updatedAt = Date.now();
  const serializable = {...state, machines:{}};
  for(const [id, machine] of machines.entries()) serializable.machines[id] = machine;
  fs.writeFileSync(STATE_FILE, JSON.stringify(serializable, null, 2));
}

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

function jackpotPoolKey(poolId){ return `${STORE_ID}:${String(poolId)}`; }

function jackpotPoolFor(poolId){
  state.jackpotPools = state.jackpotPools || {};
  const key = jackpotPoolKey(poolId);
  if(!state.jackpotPools[key]){
    state.jackpotPools[key] = {
      storeId:STORE_ID,
      poolId:String(poolId),
      currentPt:0,
      contributionRate:JACKPOT_CONTRIBUTION_RATE,
      contributionPt:JACKPOT_CONTRIBUTION_PT,
      version:0,
      updatedAt:Date.now()
    };
  }
  return state.jackpotPools[key];
}

function publicJackpotPool(pool){
  return {
    storeId:STORE_ID,
    poolId:String(pool.poolId || ""),
    currentPt:Math.max(0, Number(pool.currentPt || 0)),
    contributionRate:JACKPOT_CONTRIBUTION_RATE,
    contributionPt:JACKPOT_CONTRIBUTION_PT,
    version:Math.max(0, Number(pool.version || 0)),
    updatedAt:pool.updatedAt || 0
  };
}

function validIdempotencyKey(value){
  const key = String(value || "").trim();
  return key.length >= 8 && key.length <= 180 && /^[a-z0-9:_-]+$/i.test(key) ? key : "";
}

function contributeJackpot(machineId, idempotencyKey){
  const definition = jackpotMachineDefinition(machineId);
  if(!definition) return null;
  state.jackpotEvents = state.jackpotEvents || {};
  const existing = state.jackpotEvents[idempotencyKey];
  if(existing) return {...publicJackpotPool(jackpotPoolFor(definition.poolId)), applied:false};
  const pool = jackpotPoolFor(definition.poolId);
  pool.currentPt = Math.max(0, Number(pool.currentPt || 0)) + JACKPOT_CONTRIBUTION_PT;
  pool.version = Math.max(0, Number(pool.version || 0)) + 1;
  pool.updatedAt = Date.now();
  state.jackpotEvents[idempotencyKey] = {type:"contribution", machineId:String(machineId), amountPt:JACKPOT_CONTRIBUTION_PT, balanceAfterPt:pool.currentPt, createdAt:Date.now()};
  return {...publicJackpotPool(pool), applied:true};
}

function claimJackpot(machineId, idempotencyKey){
  const definition = jackpotMachineDefinition(machineId);
  if(!definition) return null;
  state.jackpotEvents = state.jackpotEvents || {};
  const existing = state.jackpotEvents[idempotencyKey];
  const pool = jackpotPoolFor(definition.poolId);
  if(existing){
    return {...publicJackpotPool(pool), paidPt:Math.max(0, Number(existing.amountPt || 0)), applied:false};
  }
  const paidPt = Math.max(0, Number(pool.currentPt || 0));
  pool.currentPt = 0;
  pool.version = Math.max(0, Number(pool.version || 0)) + 1;
  pool.updatedAt = Date.now();
  state.jackpotEvents[idempotencyKey] = {type:"payout", machineId:String(machineId), amountPt:paidPt, balanceAfterPt:0, createdAt:Date.now()};
  return {...publicJackpotPool(pool), paidPt, applied:true};
}

function setJackpotPoolAmount(poolId, currentPt){
  if(!jackpotPoolDefinition(poolId)) return null;
  const pool = jackpotPoolFor(poolId);
  const previousPt = Math.max(0, Number(pool.currentPt || 0));
  pool.currentPt = currentPt;
  pool.version = Math.max(0, Number(pool.version || 0)) + 1;
  pool.updatedAt = Date.now();
  const idempotencyKey = makeId("admin_set");
  state.jackpotEvents = state.jackpotEvents || {};
  state.jackpotEvents[idempotencyKey] = {
    type:"adjustment",
    machineId:"admin",
    amountPt:currentPt - previousPt,
    balanceAfterPt:currentPt,
    createdAt:Date.now()
  };
  return {...publicJackpotPool(pool), applied:true};
}

function adminOk(req){
  if(!ADMIN_PASSWORD || ADMIN_PASSWORD.toLowerCase() === "change-me") return false;
  const provided = req.headers["x-admin-password"] || "";
  return String(provided) === ADMIN_PASSWORD;
}

function retireLocalPasswords(machineId,status){
  const rows=Object.values(state.issuedPasswords).filter(row=>String(row.machineId)===String(machineId)&&['issued','used'].includes(row.status));
  for(const row of rows)row.status=status;
  return rows;
}
function sendJson(res, status, data){
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type":"application/json; charset=utf-8",
    "Content-Length":Buffer.byteLength(body),
    "Cache-Control":"no-store",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type,X-Admin-Password"
  });
  res.end(body);
}

function readBody(req){
  return new Promise((resolve, reject)=>{
    let body = "";
    req.on("data", chunk=>{
      body += chunk;
      if(body.length > 1024 * 1024 * 4){
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", ()=>{
      try{ resolve(body ? JSON.parse(body) : {}); }
      catch(e){ reject(e); }
    });
    req.on("error", reject);
  });
}

function sseHeaders(res){
  res.writeHead(200, {
    "Content-Type":"text/event-stream; charset=utf-8",
    "Cache-Control":"no-cache, no-transform",
    "Connection":"keep-alive",
    "Access-Control-Allow-Origin":"*"
  });
  res.write(": connected\n\n");
}

function sseSend(res, event, data){
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function releaseLocalClosedSession(session){
  const machine=machineFor(session.machineId);
  if(!['ended','cancelled'].includes(session.status)||!machine||machine.currentSessionId!==session.sessionId||Number(machine.resetSerial||0)!==Number(session.resetSerialAtStart||0))return false;
  if(session.status==='ended'&&session.resultRecord&&machine.lastEndedSession?.sessionId!==session.sessionId){
    const total=machineTotalFor({...machine,currentSessionId:'',lastSnapshot:null,lastEndedSession:null},readResultRecords(Number.MAX_SAFE_INTEGER));
    machine.lastEndedSession={sessionId:session.sessionId,playerName:session.playerName,endedAt:session.endedAt,record:session.resultRecord,sheets:session.sheets,machineTotal:{...total,resetSerial:machine.resetSerial,sessionId:session.sessionId}};
  }
  for(const issued of Object.values(state.issuedPasswords||{})){
    if(issued.machineId===machine.machineId&&issued.sessionId===session.sessionId&&['issued','used'].includes(issued.status))issued.status=session.status;
  }
  machine.locked=false;machine.currentSessionId='';machine.currentPlayerName='';
  saveState();broadcastMachines();
  return true;
}
function publicMachine(machine, machineTotal, jackpotPool=null){
  const snapshot = machine.lastSnapshot || null;
  const stats = snapshot && snapshot.stats ? snapshot.stats : null;
  const storedSettings = snapshot && snapshot.settings ? snapshot.settings : {setting:machine.assignedSetting || 1, completeLimitPt:19000};
  const settings = {...storedSettings,...completionSettings(storedSettings,machine.machineType)};
  return {
    storeId:STORE_ID,
    machineId:machine.machineId,
    displayName:machine.displayName || machineLabel(machine.machineId),
    machineType:machine.machineType || "generic",
    gameUrl:machine.gameUrl || "",
    poolId:machine.poolId || "",
    jackpotPool:jackpotPool || (snapshot && snapshot.jackpotPool) || null,
    capabilities:machine.capabilities || {completeLimit:false, jackpot:false},
    online:!!machine.online,
    locked:!!machine.locked,
    currentSessionId:machine.currentSessionId || "",
    currentPlayerName:machine.currentPlayerName || "",
    updatedAt:machine.updatedAt || 0,
    resetSerial:machine.resetSerial || 0,
    assignedSetting:machine.assignedSetting || (stats && stats.setting) || settings.setting || 1,
    lastEndedSession:machine.lastEndedSession || null,
    playSessionId:snapshot && snapshot.playSessionId || "",
    playSessionStartStats:snapshot && snapshot.playSessionStartStats || null,
    settings,
    stats,
    slumpHistory:stats && Array.isArray(stats.slumpHistory) ? stats.slumpHistory : [{spin:0, profit:0}],
    machineTotalStats:machineTotal.stats,
    machineTotalSlumpHistory:machineTotal.history
  };
}

function allMachines(){
  const order = new Map(MACHINE_DEFINITIONS.map((machine,index)=>[machine.machineId,index]));
  return [...machines.values()].sort((a,b)=>{
    const aOrder = order.has(String(a.machineId)) ? order.get(String(a.machineId)) : Number.MAX_SAFE_INTEGER;
    const bOrder = order.has(String(b.machineId)) ? order.get(String(b.machineId)) : Number.MAX_SAFE_INTEGER;
    if(aOrder !== bOrder) return aOrder - bOrder;
    return String(a.displayName || a.machineId).localeCompare(String(b.displayName || b.machineId), "ja");
  });
}

function publicMachines(){
  const records = readResultRecords(1000);
  return allMachines().map(machine=>publicMachine(
    machine,
    machineTotalFor(machine, records),
    machine.poolId ? publicJackpotPool(jackpotPoolFor(machine.poolId)) : null
  ));
}

function broadcastMachines(){
  const payload = publicMachines();
  for(const res of adminClients) sseSend(res, "machines", payload);
}

function queueCommand(machineId, command){
  const id = Date.now() * 1000 + crypto.randomInt(0, 1000);
  const row = {id, machineId:String(machineId), command:{...command, id}, createdAtMs:Date.now()};
  state.commands = Array.isArray(state.commands) ? state.commands : [];
  state.commands.push(row);
  state.commands = state.commands.slice(-500);
  return row;
}

function sendCommand(machineId, command){
  const row = queueCommand(machineId, command);
  saveState();
  const clients = commandClients.get(String(machineId));
  if(clients && clients.size){
    for(const res of clients) sseSend(res, "command", row.command);
  }
  return !!(clients && clients.size);
}

function generatePassword(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for(let i=0;i<6;i++) value += alphabet[crypto.randomInt(0, alphabet.length)];
  return value;
}

function makeId(prefix){
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function machineFor(id){
  const machineId = String(id || "");
  if(!machines.has(machineId)) return null;
  return machines.get(machineId);
}

function machineGameUrl(machine, adminOrigin, sessionId="", displayBaseline){
  if(!machine || !machine.gameUrl) return "";
  try{
    const target = new URL(machine.gameUrl, adminOrigin);
    target.searchParams.set("controller", "vertex");
    target.searchParams.set("storeId", STORE_ID);
    target.searchParams.set("machine", machine.machineId);
    target.searchParams.set("server", adminOrigin);
    target.searchParams.set("creditBaseline", "0");
    if(sessionId) target.searchParams.set("playSessionId", String(sessionId));
    if(machine.machineType==='nova')target.searchParams.set('resumeFromStore','1');
    // Full hit history travels in the authenticated bootstrap, never in a growing URL.
    if(displayBaseline && machine.machineType==='nova')target.searchParams.set('machineDisplay',JSON.stringify({...displayBaseline,dataHits:[]}));
    return target.toString();
  }catch(error){
    return "";
  }
}

function appendResult(record){
  ensureDataDir();
  fs.appendFileSync(RESULTS_FILE, JSON.stringify(record) + "\n");
}

function hasResetSerial(record){
  return record && record.resetSerial !== undefined && record.resetSerial !== null && record.resetSerial !== "";
}

function restoreResultResetSerial(record){
  if(hasResetSerial(record)) return record;
  const session = state.sessions[String(record && record.sessionId || "")];
  if(!session || session.resetSerialAtStart === undefined || session.resetSerialAtStart === null) return record;
  return {...record, resetSerial:Number(session.resetSerialAtStart) || 0};
}

function readResultRecords(limit=200){
  let rows = [];
  try{
    rows = fs.readFileSync(RESULTS_FILE, "utf8").split(/\n+/).filter(Boolean).map(line=>JSON.parse(line));
  }catch(e){}
  return rows.slice(-Math.max(1, Number(limit) || 200)).reverse().map(restoreResultResetSerial);
}

function postJson(urlString, payload){
  return new Promise((resolve, reject)=>{
    if(!urlString) return resolve({skipped:true});
    const target = new URL(urlString);
    const body = JSON.stringify(payload);
    const lib = target.protocol === "http:" ? http : https;
    const req = lib.request(target, {
      method:"POST",
      headers:{"Content-Type":"application/json", "Content-Length":Buffer.byteLength(body)}
    }, res=>{
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
    const result = await postJson(SHEETS_WEBHOOK_URL, sheetsSettlement(record));
    return {ok:true, result};
  }catch(e){
    return {ok:false, error:e.message};
  }
}

function resultPayload(session, machine, body){
  const snapshot = body.snapshot || machine.lastSnapshot || {};
  const stats = snapshot.stats || {};
  const settings = snapshot.settings || {};
  const delta = sessionDelta(session, snapshot);
  const now = Date.now();
  return {
    type:"slot-session-ended",
    storeId:STORE_ID,
    storeName:STORE_NAME,
    endedAt:new Date(now).toISOString(),
    endedAtMs:now,
    machineId:machine.machineId,
    machineName:machine.displayName || machineLabel(machine.machineId),
    machineType:machine.machineType || "generic",
    playerName:session.playerName || body.playerName || "",
    sessionId:session.sessionId, resetSerial:Number(session.resetSerialAtStart ?? machine.resetSerial) || 0,
    setting:settings.setting || "",
    totalSpins:stats.totalSpins || 0,
    bigCount:stats.bigCount || 0,
    regCount:stats.midCount || 0,
    grapeCount:stats.grapeCount || 0,
    totalFee:stats.totalFee || 0,
    totalPaid:stats.totalPaid || 0,
    profit:Number(stats.profit ?? ((stats.totalPaid || 0) - (stats.totalFee || 0))) || 0,
    playerSpins:delta.playerSpins,
    playerBigCount:delta.playerBigCount,
    playerRegCount:delta.playerRegCount,
    playerGrapeCount:delta.playerGrapeCount,
    playerTotalFee:delta.playerTotalFee,
    playerTotalPaid:delta.playerTotalPaid,
    playerProfit:delta.playerProfit,
    billingBasis:"playerProfit",
    playerBaselineSource:delta.baselineSource,
    startStats:delta.startStats,
    currentResultText:snapshot.state ? snapshot.state.resultText || "" : "",
    stats,
    settings,
    normalState:snapshot.normalState || {},
    session:snapshot.session || {}
  };
}

function serveFile(res, pathname){
  const clean = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, clean));
  if(!filePath.startsWith(ROOT)){
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data)=>{
    if(err){
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html":"text/html; charset=utf-8",
      ".js":"text/javascript; charset=utf-8",
      ".css":"text/css; charset=utf-8",
      ".svg":"image/svg+xml",
      ".png":"image/png",
      ".webp":"image/webp",
      ".jpg":"image/jpeg",
      ".jpeg":"image/jpeg",
      ".mp3":"audio/mpeg",
      ".wav":"audio/wav",
      ".mp4":"video/mp4"
    };
    res.writeHead(200, {"Content-Type":types[ext] || "application/octet-stream"});
    res.end(data);
  });
}

loadState();

const server = http.createServer(async (req, res)=>{
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if(req.method === "OPTIONS") return sendJson(res, 204, {});

  try{
    if(url.pathname === "/api/admin/verify" && req.method === "GET"){
      return adminOk(req)
        ? sendJson(res, 200, {ok:true})
        : sendJson(res, 401, {ok:false, error:"admin password required"});
    }

    if(url.pathname === "/api/config" && req.method === "GET"){
      return sendJson(res, 200, {ok:true, storeId:STORE_ID, storeName:STORE_NAME, stores:STORE_DIRECTORY, machineCount:MACHINE_DEFINITIONS.length});
    }

    if(url.pathname === "/api/jackpot/pool" && req.method === "GET"){
      const machineId = String(url.searchParams.get("machineId") || "").trim();
      const definition = jackpotMachineDefinition(machineId);
      if(!definition) return sendJson(res, 400, {ok:false, error:"jackpot-enabled machine required"});
      return sendJson(res, 200, {ok:true, pool:publicJackpotPool(jackpotPoolFor(definition.poolId))});
    }

    if(url.pathname === "/api/jackpot/contribute" && req.method === "POST"){
      const body = await readBody(req);
      const machineId = String(body.machineId || "").trim();
      const idempotencyKey = validIdempotencyKey(body.idempotencyKey);
      if(!jackpotMachineDefinition(machineId)) return sendJson(res, 400, {ok:false, error:"jackpot-enabled machine required"});
      if(!idempotencyKey) return sendJson(res, 400, {ok:false, error:"valid idempotencyKey required"});
      const pool = contributeJackpot(machineId, idempotencyKey);
      saveState();
      return sendJson(res, 200, {ok:true, pool});
    }

    if(url.pathname === "/api/jackpot/claim" && req.method === "POST"){
      const body = await readBody(req);
      const machineId = String(body.machineId || "").trim();
      const idempotencyKey = validIdempotencyKey(body.idempotencyKey);
      if(!jackpotMachineDefinition(machineId)) return sendJson(res, 400, {ok:false, error:"jackpot-enabled machine required"});
      if(!idempotencyKey) return sendJson(res, 400, {ok:false, error:"valid idempotencyKey required"});
      if(String(body.qualifyingResult || "").toUpperCase() !== "JP") return sendJson(res, 409, {ok:false, error:"JP outcome required"});
      const machine = machineFor(machineId);
      const playSessionId = String(body.playSessionId || "");
      if(machine && machine.currentSessionId && playSessionId !== String(machine.currentSessionId)){
        return sendJson(res, 409, {ok:false, error:"machine session mismatch"});
      }
      const pool = claimJackpot(machineId, idempotencyKey);
      saveState();
      return sendJson(res, 200, {ok:true, pool});
    }

    const jackpotAmountMatch = url.pathname.match(/^\/api\/admin\/jackpot\/pools\/([^/]+)\/amount$/);
    if(jackpotAmountMatch && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const poolId = decodeURIComponent(jackpotAmountMatch[1]);
      if(!jackpotPoolDefinition(poolId)) return sendJson(res, 404, {ok:false, error:"jackpot pool not found"});
      const body = await readBody(req);
      const currentPt = validJackpotAmount(body.currentPt);
      if(currentPt === null) return sendJson(res, 400, {ok:false, error:`currentPt must be an integer from 0 to ${MAX_JACKPOT_PT}`});
      const pool = setJackpotPoolAmount(poolId, currentPt);
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, pool});
    }

    if(url.pathname === "/api/machines" && req.method === "GET"){
      return sendJson(res, 200, publicMachines());
    }

    if(url.pathname === "/api/events" && req.method === "GET"){
      sseHeaders(res);
      adminClients.add(res);
      sseSend(res, "machines", publicMachines());
      req.on("close", ()=>adminClients.delete(res));
      return;
    }

    if(url.pathname === "/api/admin/issue-password" && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const body = await readBody(req);
      const machine = machineFor(body.machineId);
      if(!machine) return sendJson(res, 400, {ok:false, error:"invalid machine"});
      const playerName = String(body.playerName || "").trim();
      if(!playerName) return sendJson(res, 400, {ok:false, error:"playerName required"});
      if(body.superSpeedAllowed!==undefined&&(typeof body.superSpeedAllowed!=='boolean'||machine.machineType!=='nova'))return sendJson(res,400,{ok:false,error:'invalid superSpeedAllowed'});
      const existing=passwordIssuance.current(machine,Object.values(state.issuedPasswords));
      if(existing)return sendJson(res,existing.password?200:409,existing.password?{ok:true,issued:existing}:{ok:false,error:'遊技中です。終了後に発行してください。'});
      let password;
      for(let attempt=0; attempt<20; attempt++){
        password = generatePassword();
        if(!Object.hasOwn(state.issuedPasswords, password)) break;
        password = null;
      }
      if(!password) return sendJson(res,503,{ok:false,error:"パスワードを発行できませんでした。もう一度お試しください。"});
      const issued = {
        password,
        machineId:machine.machineId,
        playerName,
        status:"issued",
        issuedAt:Date.now(),
        usedAt:0,
        sessionId:""
      };
      state.issuedPasswords[password] = issued;
      if(typeof body.superSpeedAllowed==='boolean'){
        issued.superSpeedAllowed=body.superSpeedAllowed;
        machine.capabilities={...machine.capabilities,superSpeedAllowed:body.superSpeedAllowed};
        if(body.superSpeedAllowed){
          const event=speedActivity.event(password,machine.machineId,playerName,'allowed',issued.issuedAt);
          state.superSpeedActivity[event.id]=event;
        }
      }
      saveState();
      return sendJson(res, 200, {ok:true, issued});
    }

    if(url.pathname === '/api/admin/super-speed-activity' && req.method === 'GET'){
      if(!adminOk(req))return sendJson(res,401,{ok:false,error:'admin password required'});
      const date=url.searchParams.get('date')||speedActivity.dateJst();
      if(!speedActivity.validDate(date))return sendJson(res,400,{ok:false,error:'invalid date'});
      return sendJson(res,200,{ok:true,date,rows:speedActivity.summarize(Object.values(state.superSpeedActivity).filter(row=>row.activity_date===date))});
    }
    if(url.pathname === '/api/sessions/super-speed-used' && req.method === 'POST'){
      const body=await readBody(req),session=state.sessions[String(body.sessionId||'')];
      if(!session||session.token!==String(body.token||''))return sendJson(res,403,{ok:false,error:'invalid session'});
      const machine=machines.get(session.machineId);
      if(session.status!=='active'||machine?.currentSessionId!==session.sessionId||Number(machine.resetSerial||0)!==Number(session.resetSerialAtStart||0))return sendJson(res,409,{ok:false,error:'session is not active'});
      if(machine.machineType!=='nova'||machine.capabilities?.superSpeedAllowed!==true)return sendJson(res,403,{ok:false,error:'super speed is not allowed'});
      const event=speedActivity.event(session.password,session.machineId,session.playerName,'used',Date.now(),session.sessionId);
      if(!state.superSpeedActivity[event.id]){state.superSpeedActivity[event.id]=event;saveState();}
      return sendJson(res,200,{ok:true,date:event.activity_date});
    }
    if(url.pathname === '/api/admin/passwords/current' && req.method === 'GET'){
      if(!adminOk(req))return sendJson(res,401,{ok:false,error:'admin password required'});
      return sendJson(res,200,[...machines.values()].map(machine=>passwordIssuance.current(machine,Object.values(state.issuedPasswords))||{machineId:machine.machineId,status:'available',password:'',playerName:''}));
    }
    if(url.pathname === "/api/admin/passwords" && req.method === "GET"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const items = Object.values(state.issuedPasswords).sort((a,b)=>(b.issuedAt || 0) - (a.issuedAt || 0)).slice(0, 80);
      return sendJson(res, 200, items);
    }

    if(url.pathname === "/api/sessions/start" && req.method === "POST"){
      const body = await readBody(req);
      const password = String(body.password || "").trim().toUpperCase();
      const requestedMachineId = String(body.requestedMachineId || "").trim();
      const issued = state.issuedPasswords[password];
      if(!issued) return sendJson(res, 403, {ok:false, error:"password not found"});
      if(requestedMachineId && requestedMachineId !== String(issued.machineId)){
        return sendJson(res, 403, {ok:false, error:"このパスワードは別の台用です"});
      }
      const machine = machineFor(issued.machineId);
      if(!machine) return sendJson(res, 400, {ok:false, error:"machine not found"});
      const existingSession = issued.sessionId ? state.sessions[issued.sessionId] : null;
      const displayBaseline=existingSession?.startSnapshot?.machineDisplayBaseline || machineDisplayBaseline({...machine,lastSnapshot:existingSession ? existingSession.startSnapshot : machine.lastSnapshot},readResultRecords(Number.MAX_SAFE_INTEGER));
      const iframeUrlFor = sessionId=>machineGameUrl(machine, url.origin, sessionId,displayBaseline);
      if(!iframeUrlFor(existingSession && existingSession.sessionId || "")){
        return sendJson(res, 400, {ok:false, error:"machine game URL is not configured"});
      }
      if(issued.status === "used" && existingSession && existingSession.status === "active"){
        return sendJson(res, 200, {
          ok:true,
          resumed:true,
          session:{sessionId:existingSession.sessionId, token:existingSession.token, machineId:machine.machineId, playerName:existingSession.playerName},
          machineDisplayBaseline:displayBaseline,resumeState:machineResume.forSession(machine,existingSession), iframeUrl:iframeUrlFor(existingSession.sessionId)
        });
      }
      if(issued.status !== "issued") return sendJson(res, 403, {ok:false, error:"このパスワードは終了済みです"});
      if(passwordIssuance.current(machine,Object.values(state.issuedPasswords))?.password!==password)return sendJson(res,403,{ok:false,error:'このパスワードは現在の発行番号ではありません'});
      if(machine.currentSessionId && machine.currentSessionId !== (existingSession && existingSession.sessionId)) return sendJson(res, 409, {ok:false, error:"machine is busy"});
      const sessionId = makeId("sess");
      const token = crypto.randomBytes(16).toString("hex");
      const session = {
        sessionId,
        token,
        password,
        machineId:machine.machineId,
        playerName:issued.playerName,
        status:"active",
        startedAt:Date.now(),
        endedAt:0,
        resetSerialAtStart:machine.resetSerial || 0,
        startSnapshot:{...machine.lastSnapshot,machineDisplayBaseline:displayBaseline}
      };
      issued.status = "used";
      issued.usedAt = Date.now();
      issued.sessionId = sessionId;
      state.sessions[sessionId] = session;
      machine.locked = true;
      machine.currentSessionId = sessionId;
      machine.currentPlayerName = session.playerName;
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, session:{sessionId, token, machineId:machine.machineId, playerName:session.playerName}, machineDisplayBaseline:displayBaseline,resumeState:machineResume.forSession(machine,session), iframeUrl:iframeUrlFor(sessionId)});
    }

    if(url.pathname === "/api/sessions/status" && req.method === "POST"){
      const body = await readBody(req);
      const session = state.sessions[String(body.sessionId || "")];
      if(!session || !session.token || session.token !== String(body.token || "")) return sendJson(res,403,{ok:false,error:'invalid session'});
      const machine = machineFor(session.machineId);
      const active = session.status === 'active' && !!machine && String(machine.currentSessionId || '') === String(session.sessionId)
        && Number(machine.resetSerial || 0) === Number(session.resetSerialAtStart || 0);
      return sendJson(res,200,{ok:true,active});
    }

    if(url.pathname === "/api/sessions/end" && req.method === "POST"){
      const body = await readBody(req);
      const session = state.sessions[String(body.sessionId || "")];
      if(!session || session.token !== String(body.token || "")) return sendJson(res, 403, {ok:false, error:"invalid session"});
      if(session.status === "ended") return sendJson(res, 200, {ok:true, alreadyEnded:true, released:releaseLocalClosedSession(session), record:session.resultRecord || null});
      if(session.status !== 'active')return sendJson(res,409,{ok:false,error:'session is not active'});
      const machine = machineFor(session.machineId);
      if(!machine) return sendJson(res, 400, {ok:false, error:"machine not found"});
      const snapshot = snapshotForSession(session, machine, body.snapshot);
      if(body.snapshot && snapshot === body.snapshot){
        snapshot.settings={...snapshot.settings,...completionSettings(machine.lastSnapshot?.settings,machine.machineType)};
        machine.lastSnapshot = snapshot;
      }
      const record = resultPayload(session, machine, {...body, snapshot});
      const machineTotal=completedMachineTotal(machine,record,readResultRecords(Number.MAX_SAFE_INTEGER));
      appendResult(record);
      const sheets = await sendToSheets(record);
      session.status = "ended";
      session.endedAt = Date.now();
      session.resultRecord = record;
      session.sheets = sheets;
      retireLocalPasswords(machine.machineId,'ended');
      machine.locked = false;
      machine.currentSessionId = "";
      machine.currentPlayerName = "";
      machine.lastEndedSession = {sessionId:session.sessionId, playerName:session.playerName, endedAt:session.endedAt, record, sheets, machineTotal};
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, record, sheets});
    }

    if(url.pathname === "/api/sessions/prepare-end" && req.method === "POST"){
      const body = await readBody(req);
      const session = state.sessions[String(body.sessionId || "")];
      if(!session || session.token !== String(body.token || "")) return sendJson(res, 403, {ok:false, error:"invalid session"});
      if(session.status !== "active") return sendJson(res, 409, {ok:false, error:"session is not active"});
      const machine = machineFor(session.machineId);
      if(!machine || String(machine.currentSessionId || "") !== String(session.sessionId)) return sendJson(res, 409, {ok:false, error:"machine session mismatch"});
      const delivered = sendCommand(machine.machineId, {type:"prepareEnd", sessionId:session.sessionId});
      return sendJson(res, 200, {ok:true, delivered});
    }

    const forceEndMatch = url.pathname.match(/^\/api\/admin\/machines\/([^/]+)\/force-end$/);
    if(forceEndMatch && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const machine = machineFor(decodeURIComponent(forceEndMatch[1]));
      if(!machine) return sendJson(res, 404, {ok:false, error:"machine not found"});
      const session = machine.currentSessionId ? state.sessions[machine.currentSessionId] : null;
      const body=await readBody(req);
      if(body.recoverOnly && (!session||!['ended','cancelled'].includes(session.status))){
        return sendJson(res,409,{ok:false,error:'終了済みの記録を確認できません。利用状態は変更していません。'});
      }
      if(session && session.status !== "active"){
        const released=releaseLocalClosedSession(session);
        if(!released)return sendJson(res,409,{ok:false,error:'台の状態が変更されました。更新して再確認してください。'});
        return sendJson(res,200,{ok:true,alreadyEnded:true,released,record:session.resultRecord||null,sheets:session.sheets||null});
      }
      if(session && session.status === "active"){
        if(machine.machineType==='nova'&&!(machine.lastSnapshot?.endPreparedAt&&machine.lastSnapshot.playSessionId===session.sessionId)){
          sendCommand(machine.machineId,{type:'prepareEnd',sessionId:session.sessionId});
          const deadline=Date.now()+6500;
          while(Date.now()<deadline){
            await new Promise(resolve=>setTimeout(resolve,100));
            if(String(machine.currentSessionId)!==String(session.sessionId))return sendJson(res,409,{ok:false,error:'台の状態が変更されました。更新してください'});
            if(machine.lastSnapshot?.endPreparedAt&&machine.lastSnapshot.playSessionId===session.sessionId)break;
          }
        }
        const record = {...resultPayload(session, machine, {snapshot:snapshotForSession(session, machine)}), forced:true, forcedBy:"admin"};
        const machineTotal=completedMachineTotal(machine,record,readResultRecords(Number.MAX_SAFE_INTEGER));
        appendResult(record);
        session.status = "ended";
        session.endedAt = Date.now();
        session.resultRecord = record;
        saveState();
        const sheets = await sendToSheets(record);
        session.sheets = sheets;
        retireLocalPasswords(machine.machineId,'ended');
        machine.locked = false;
        machine.currentSessionId = "";
        machine.currentPlayerName = "";
        machine.lastEndedSession = {sessionId:session.sessionId, playerName:session.playerName, endedAt:session.endedAt, record, sheets, machineTotal, forced:true};
        saveState();
        broadcastMachines();
        return sendJson(res, 200, {ok:true, forced:true, record, sheets});
      }
      const retired=retireLocalPasswords(machine.machineId,'cancelled');
      if(!machine.currentSessionId&&retired.some(row=>!row.sessionId)){saveState();return sendJson(res,200,{ok:true,released:true});}
      if(machine.lastEndedSession){
        machine.locked = false;
        machine.currentSessionId = "";
        machine.currentPlayerName = "";
        saveState();
        broadcastMachines();
        return sendJson(res, 200, {ok:true, released:true, alreadyEnded:true, record:machine.lastEndedSession.record || null, sheets:machine.lastEndedSession.sheets || null});
      }
      if(!session && !machine.lastSnapshot) return sendJson(res, 400, {ok:false, error:"終了できるデータがありません"});
      const forcedSession = {
        sessionId:makeId("forced"),
        token:"",
        password:"",
        machineId:machine.machineId,
        playerName:machine.currentPlayerName || "強制終了",
        status:"active",
        startedAt:0,
        endedAt:0,
        startSnapshot:machine.lastSnapshot || null
      };
      const record = {...resultPayload(forcedSession, machine, {}), forced:true, forcedBy:"admin"};
      appendResult(record);
      const sheets = await sendToSheets(record);
      machine.locked = false;
      machine.currentSessionId = "";
      machine.currentPlayerName = "";
      machine.lastEndedSession = {sessionId:forcedSession.sessionId, playerName:forcedSession.playerName, endedAt:Date.now(), record, sheets, forced:true};
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, record, sheets});
    }

    const resetMatch = url.pathname.match(/^\/api\/admin\/machines\/([^/]+)\/reset$/);
    if(resetMatch && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const machine = machineFor(decodeURIComponent(resetMatch[1]));
      if(!machine) return sendJson(res, 404, {ok:false, error:"machine not found"});
      const preservedSettings = machine.lastSnapshot && machine.lastSnapshot.settings
        ? machine.lastSnapshot.settings
        : {setting:machine.assignedSetting || 1, completeLimitPt:19000};
      retireLocalPasswords(machine.machineId,'cancelled');
      if(machine.currentSessionId&&state.sessions[machine.currentSessionId])Object.assign(state.sessions[machine.currentSessionId],{status:'cancelled',endedAt:Date.now()});
      machine.locked = false;
      machine.currentSessionId = "";
      machine.currentPlayerName = "";
      machine.lastEndedSession = null;
      machine.lastSnapshot = {machineId:machine.machineId, stats:null, settings:preservedSettings, updatedAt:Date.now()};
      machine.resetSerial = (Number(machine.resetSerial) || 0) + 1;
      if(machine.machineType === 'nova') machine.capabilities = {...machine.capabilities, superSpeedAllowed:false};
      const delivered = sendCommand(machine.machineId, {type:"reset", reason:"admin-reset", id:makeId("cmd")});
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, delivered, machine:publicMachine(machine, machineTotalFor(machine, []))});
    }

    const stateMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/state$/);
    if(stateMatch && req.method === "POST"){
      const machineId = decodeURIComponent(stateMatch[1]);
      const machine = machineFor(machineId);
      if(!machine) return sendJson(res, 404, {ok:false, error:"machine not found"});
      const body = await readBody(req);
      const incomingSessionId = String(body.playSessionId || "");
      const incomingSession = state.sessions[incomingSessionId];
      if(incomingSessionId && (incomingSessionId !== String(machine.currentSessionId || "")
        || incomingSession?.status !== 'active'
        || Number(incomingSession.resetSerialAtStart || 0) !== Number(machine.resetSerial || 0))){
        return sendJson(res, 409, {ok:false, error:"stale play session"});
      }
      if(String(machine.lastSnapshot?.playSessionId)===incomingSessionId && Number(body.capturedAt||0)<Number(machine.lastSnapshot?.capturedAt||0))return sendJson(res,200,{ok:true,ignored:true});
      const snapshot = {...body, machineId, online:true, updatedAt:Date.now()};
      snapshot.settings={...snapshot.settings,...completionSettings(machine.lastSnapshot?.settings,machine.machineType)};
      machine.lastSnapshot = snapshot;
      const definition = machineDefinition(machineId);
      machine.displayName = definition && definition.displayName || machine.displayName || body.name || machineId;
      machine.machineType = definition && definition.machineType || machine.machineType || "generic";
      machine.gameUrl = definition && definition.gameUrl || machine.gameUrl || "";
      machine.poolId = definition && definition.poolId || machine.poolId || "";
      machine.capabilities = {...(definition?.capabilities || machine.capabilities || {}),superSpeedAllowed:machine.capabilities?.superSpeedAllowed===true};
      machine.online = true;
      machine.updatedAt = Date.now();
      machines.set(machineId, machine);
      state.machines[machineId] = machine;
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true});
    }

    const commandPollMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/commands\/poll$/);
    if(commandPollMatch && req.method === "GET"){
      const machineId = decodeURIComponent(commandPollMatch[1]);
      const since = Number(url.searchParams.get("since") || 0) || 0;
      const commands = (Array.isArray(state.commands) ? state.commands : []).filter(row=>String(row.machineId) === String(machineId) && Number(row.id) > since).slice(-25);
      const machine=machineFor(machineId);
      return sendJson(res, 200, {ok:true, controls:{superSpeedAllowed:machine?.machineType==='nova' && machine.capabilities?.superSpeedAllowed===true,...completionSettings(machine?.lastSnapshot?.settings,machine?.machineType)}, commands});
    }

    const superSpeedMatch=url.pathname.match(/^\/api\/admin\/machines\/([^/]+)\/super-speed$/);
    if(superSpeedMatch && req.method==='POST'){
      if(!adminOk(req))return sendJson(res,401,{ok:false,error:'admin password required'});
      const id=decodeURIComponent(superSpeedMatch[1]),definition=machineDefinition(id);
      if(definition?.machineType!=='nova')return sendJson(res,404,{ok:false,error:'NOVA machine not found'});
      const body=await readBody(req);
      if(typeof body.enabled!=='boolean')return sendJson(res,400,{ok:false,error:'enabled must be boolean'});
      const machine=machineFor(id);
      machine.capabilities={...definition.capabilities,superSpeedAllowed:body.enabled};
      state.machines[id]=machine;saveState();broadcastMachines();
      return sendJson(res,200,{ok:true,superSpeedAllowed:body.enabled});
    }

    const commandStreamMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/commands$/);
    if(commandStreamMatch && req.method === "GET"){
      const machineId = decodeURIComponent(commandStreamMatch[1]);
      sseHeaders(res);
      if(!commandClients.has(machineId)) commandClients.set(machineId, new Set());
      commandClients.get(machineId).add(res);
      const connectedMachine = machineFor(machineId);
      if(connectedMachine && connectedMachine.assignedSetting){
        const currentSettings = connectedMachine.lastSnapshot && connectedMachine.lastSnapshot.settings ? connectedMachine.lastSnapshot.settings : {};
        sseSend(res, "command", {type:"applySettings", settings:{...currentSettings, setting:connectedMachine.assignedSetting}, id:makeId("cmd")});
      }
      req.on("close", ()=>{
        const clients = commandClients.get(machineId);
        if(clients) clients.delete(res);
      });
      return;
    }

    const adminSettingMatch = url.pathname.match(/^\/api\/admin\/machines\/([^/]+)\/setting$/);
    if(adminSettingMatch && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const machine = machineFor(decodeURIComponent(adminSettingMatch[1]));
      if(!machine) return sendJson(res, 404, {ok:false, error:"machine not found"});
      const body = await readBody(req);
      let patch;
      try{patch=settingsPatch(body,machine.machineType);}catch(error){return sendJson(res,400,{ok:false,error:error.message});}
      if(body.completeLimitPt !== undefined && !machine.capabilities?.completeLimit) return sendJson(res,400,{ok:false,error:"この台はコンプリート設定の対象外です"});
      const currentSettings = machine.lastSnapshot && machine.lastSnapshot.settings ? machine.lastSnapshot.settings : {};
      const setting = patch.setting ?? machine.assignedSetting ?? currentSettings.setting ?? 1;
      const settings = {...currentSettings, setting, ...patch};
      Object.assign(settings,completionSettings(settings,machine.machineType));
      const completeLimitPt = settings.completeLimitPt || 19000;
      machine.assignedSetting = setting;
      machine.lastSnapshot = machine.lastSnapshot || {machineId:machine.machineId, stats:{}, settings:{}, updatedAt:Date.now()};
      machine.lastSnapshot.settings = settings;
      machine.lastSnapshot.updatedAt = Date.now();
      if(machine.machineType === 'nova' && patch.setting !== undefined) machine.capabilities = {...machine.capabilities, superSpeedAllowed:false};
      const delivered = sendCommand(machine.machineId, {type:"applySettings", settings:patch, id:makeId("cmd")});
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, setting, completeLimitPt, delivered, machine:publicMachine(machine, machineTotalFor(machine, []))});
    }

    const commandMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/command$/);
    if(commandMatch && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const machineId = decodeURIComponent(commandMatch[1]);
      const command = await readBody(req);
      const delivered = sendCommand(machineId, {...command, id:makeId("cmd")});
      return sendJson(res, 200, {ok:true, delivered});
    }

    if(url.pathname === "/api/command-all" && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const command = await readBody(req);
      let delivered = 0;
      for(const machineId of machines.keys()){
        if(sendCommand(machineId, {...command, id:makeId("cmd")})) delivered++;
      }
      return sendJson(res, 200, {ok:true, delivered});
    }

    if(url.pathname === "/api/results" && req.method === "GET"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      return sendJson(res, 200, readResultRecords(200));
    }

    return serveFile(res, url.pathname);
  }catch(e){
    return sendJson(res, 500, {ok:false, error:e.message});
  }
});

setInterval(()=>{
  const now = Date.now();
  let changed = false;
  for(const machine of machines.values()){
    const online = now - (machine.updatedAt || 0) < 90000;
    if(machine.online !== online){
      machine.online = online;
      changed = true;
    }
  }
  if(changed){
    saveState();
    broadcastMachines();
  }
}, 3000);

server.listen(PORT, ()=>{
  console.log(`VERTEX operations server / ${STORE_NAME} (${STORE_ID})`);
  console.log(`Admin:   http://localhost:${PORT}/admin.html`);
  console.log(`Play:    http://localhost:${PORT}/play.html`);
  console.log(`Machines:http://localhost:${PORT}/machines.html`);
});
