import * as crypto from "node:crypto";
import machineConfig from "../machine-config.cjs";

const {
  STORE_ID,
  STORE_NAME,
  STORE_DIRECTORY,
  MACHINE_DEFINITIONS,
  CONFIG_SOURCE = "unknown"
} = machineConfig;

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const MAX_BODY_BYTES = Math.max(16_384, Math.min(1_048_576, Number(process.env.VERTEX_MAX_BODY_BYTES || 262_144)));
const SESSION_TOKEN_REQUIRED = /^(1|true|yes)$/i.test(String(process.env.VERTEX_REQUIRE_SESSION_TOKEN || ""));
const ADMIN_COOKIE = "vertex_admin_session";
const ADMIN_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60;
const REQUEST_TIMEOUT_MS = Math.max(1_000, Math.min(30_000, Number(process.env.VERTEX_UPSTREAM_TIMEOUT_MS || 8_000)));

function firstHeader(req, name){
  const value = req && req.headers ? req.headers[String(name).toLowerCase()] : undefined;
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export function constantTimeEqual(left, right){
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if(a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req){
  const raw = firstHeader(req, "cookie");
  const cookies = new Map();
  for(const part of raw.split(";")){
    const index = part.indexOf("=");
    if(index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if(key) cookies.set(key, value);
  }
  return cookies;
}

function adminCookieSignature(expiresAt){
  return crypto
    .createHmac("sha256", ADMIN_PASSWORD)
    .update(`${STORE_ID}:${expiresAt}:vertex-admin`)
    .digest("base64url");
}

function makeAdminCookie(){
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_COOKIE_MAX_AGE_SECONDS;
  const value = `${expiresAt}.${adminCookieSignature(expiresAt)}`;
  return `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${ADMIN_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function clearAdminCookie(){
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function validAdminCookie(req){
  if(!configuredAdminPassword()) return false;
  const raw = parseCookies(req).get(ADMIN_COOKIE) || "";
  const separator = raw.indexOf(".");
  if(separator <= 0) return false;
  const expiresAt = Number(raw.slice(0, separator));
  const signature = raw.slice(separator + 1);
  if(!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  return constantTimeEqual(signature, adminCookieSignature(expiresAt));
}

function configuredAdminPassword(){
  const value = ADMIN_PASSWORD.trim();
  return !!value && value.toLowerCase() !== "change-me";
}

function adminHeaderOk(req){
  return configuredAdminPassword() && constantTimeEqual(firstHeader(req, "x-admin-password"), ADMIN_PASSWORD);
}

function adminRequestOk(req){
  return adminHeaderOk(req) || validAdminCookie(req);
}

export function normalizeApiPath(req){
  const value = req && req.query ? req.query.path : "";
  const raw = Array.isArray(value) ? value.join("/") : String(value || "");
  return `/api/${raw.replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/api";
}

export function isAdminRoute(pathname){
  return pathname.startsWith("/api/admin/")
    || pathname === "/api/results"
    || pathname === "/api/command-all"
    || /^\/api\/machines\/[^/]+\/command$/.test(pathname);
}

function machineOrigins(){
  const origins = new Set();
  for(const machine of MACHINE_DEFINITIONS){
    try{
      if(machine && machine.gameUrl) origins.add(new URL(machine.gameUrl).origin);
    }catch(error){}
  }
  const configured = String(process.env.VERTEX_ALLOWED_ORIGINS || "").trim();
  if(configured){
    let values = configured.split(",");
    try{
      const parsed = JSON.parse(configured);
      if(Array.isArray(parsed)) values = parsed;
    }catch(error){}
    for(const value of values){
      try{ origins.add(new URL(String(value).trim()).origin); }catch(error){}
    }
  }
  return origins;
}

const ALLOWED_ORIGINS = machineOrigins();

function requestOriginAllowed(req){
  const origin = firstHeader(req, "origin").trim();
  if(!origin) return true;
  const host = firstHeader(req, "host").trim();
  const forwardedProto = firstHeader(req, "x-forwarded-proto").split(",")[0].trim() || "https";
  if(host && origin === `${forwardedProto}://${host}`) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function setSecurityHeaders(res, req){
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Vary", "Origin");
  const origin = firstHeader(req, "origin").trim();
  if(origin && requestOriginAllowed(req)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Admin-Password,Authorization,X-Session-Token");
}

function sendJson(res, req, status, data, extraHeaders={}){
  const body = JSON.stringify(data);
  res.statusCode = status;
  setSecurityHeaders(res, req);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for(const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function configuredRuntimeProblems(env=process.env, definitions=MACHINE_DEFINITIONS){
  const problems = [];
  const adminPassword = String(env.ADMIN_PASSWORD || "").trim();
  if(!adminPassword || adminPassword.toLowerCase() === "change-me") problems.push("ADMIN_PASSWORD");
  if(!String(env.SUPABASE_URL || "").trim()) problems.push("SUPABASE_URL");
  if(!String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) problems.push("SUPABASE_SERVICE_ROLE_KEY");
  const storeId = String(env.VERTEX_STORE_ID || STORE_ID || "").trim();
  if(!storeId || storeId === "store-local") problems.push("VERTEX_STORE_ID");
  if(!Array.isArray(definitions) || !definitions.length) problems.push("MACHINE_DEFINITIONS");
  if(String(env.VERCEL_ENV || "") === "production"){
    for(const machine of definitions || []){
      const url = String(machine && machine.gameUrl || "").trim();
      if(!/^https:\/\//i.test(url)){
        problems.push(`HTTPS_GAME_URL:${machine && machine.machineId || "unknown"}`);
        break;
      }
    }
  }
  if(storeId === "store-debug"){
    const novaMachines = (definitions || []).filter(machine=>String(machine.machineType || "").toLowerCase() === "nova");
    if(novaMachines.length !== 12) problems.push("DEBUG_NOVA_MACHINE_COUNT");
  }
  return [...new Set(problems)];
}

export { configuredRuntimeProblems };

async function readLimitedBody(req){
  if(["GET", "HEAD", "OPTIONS"].includes(String(req.method || "GET").toUpperCase())) return {};
  if(req.body !== undefined && req.body !== null){
    const bytes = Buffer.byteLength(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    if(bytes > MAX_BODY_BYTES) throw Object.assign(new Error("request body too large"), {statusCode:413});
    if(typeof req.body === "string"){
      try{ req.body = req.body ? JSON.parse(req.body) : {}; }
      catch(error){ throw Object.assign(new Error("invalid JSON body"), {statusCode:400}); }
    }
    return req.body || {};
  }
  return await new Promise((resolve, reject)=>{
    let size = 0;
    const chunks = [];
    req.on("data", chunk=>{
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if(size > MAX_BODY_BYTES){
        reject(Object.assign(new Error("request body too large"), {statusCode:413}));
        try{ req.destroy(); }catch(error){}
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", ()=>{
      try{
        const text = Buffer.concat(chunks).toString("utf8");
        req.body = text ? JSON.parse(text) : {};
        resolve(req.body);
      }catch(error){
        reject(Object.assign(new Error("invalid JSON body"), {statusCode:400}));
      }
    });
    req.on("error", reject);
  });
}

function captureResponse(){
  const headers = new Map();
  const chunks = [];
  let ended = false;
  return {
    statusCode:200,
    setHeader(name, value){ headers.set(String(name).toLowerCase(), {name:String(name), value}); },
    getHeader(name){ return headers.get(String(name).toLowerCase())?.value; },
    removeHeader(name){ headers.delete(String(name).toLowerCase()); },
    writeHead(status, outgoingHeaders={}){
      this.statusCode = Number(status) || this.statusCode;
      for(const [name, value] of Object.entries(outgoingHeaders || {})) this.setHeader(name, value);
      return this;
    },
    write(chunk){ if(chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk)); return true; },
    end(chunk){
      if(chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk));
      ended = true;
      return this;
    },
    get ended(){ return ended; },
    result(){ return {status:Number(this.statusCode) || 200, headers, body:Buffer.concat(chunks)}; }
  };
}

let legacyHandlerPromise = null;

async function getLegacyHandler(){
  if(!legacyHandlerPromise){
    legacyHandlerPromise = import("./index.mjs").then(module=>module.default);
  }
  return legacyHandlerPromise;
}

async function delegate(req){
  const response = captureResponse();
  const legacyHandler = await getLegacyHandler();
  const previousAuthorization = req.__vertexGatewayAuthorized;
  req.__vertexGatewayAuthorized = true;
  try{
    await legacyHandler(req, response);
  }finally{
    if(previousAuthorization === undefined) delete req.__vertexGatewayAuthorized;
    else req.__vertexGatewayAuthorized = previousAuthorization;
  }
  if(!response.ended) response.end();
  return response.result();
}

function safeJson(buffer, fallback=null){
  try{ return buffer.length ? JSON.parse(buffer.toString("utf8")) : fallback; }
  catch(error){ return fallback; }
}

function stripSecretsDeep(value, seen=new WeakSet()){
  if(value === null || value === undefined) return value;
  if(Array.isArray(value)) return value.map(item=>stripSecretsDeep(item, seen));
  if(typeof value !== "object") return value;
  if(seen.has(value)) return null;
  seen.add(value);
  const output = {};
  for(const [key, item] of Object.entries(value)){
    if(/^(password|token|accessToken|refreshToken|serviceRoleKey)$/i.test(key)) continue;
    output[key] = stripSecretsDeep(item, seen);
  }
  return output;
}

function stripPasswordsDeep(value, seen=new WeakSet()){
  if(value === null || value === undefined) return value;
  if(Array.isArray(value)) return value.map(item=>stripPasswordsDeep(item, seen));
  if(typeof value !== "object") return value;
  if(seen.has(value)) return null;
  seen.add(value);
  const output = {};
  for(const [key, item] of Object.entries(value)){
    if(/^(password|accessToken|refreshToken|serviceRoleKey)$/i.test(key)) continue;
    output[key] = stripPasswordsDeep(item, seen);
  }
  return output;
}

export function sanitizeIssuedPasswordResponse(value){
  const sanitized = stripPasswordsDeep(value);
  const issuedPassword = value && value.issued && typeof value.issued.password === "string"
    ? value.issued.password
    : "";
  if(!issuedPassword || !sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return sanitized;
  if(!sanitized.issued || typeof sanitized.issued !== "object" || Array.isArray(sanitized.issued)) return sanitized;
  return {...sanitized, issued:{...sanitized.issued, password:issuedPassword}};
}

export function sanitizePublicMachine(machine){
  const source = stripSecretsDeep(machine || {});
  return {
    storeId:source.storeId || STORE_ID,
    machineId:String(source.machineId || ""),
    displayName:String(source.displayName || source.machineId || ""),
    machineType:String(source.machineType || "generic"),
    poolId:String(source.poolId || ""),
    capabilities:source.capabilities || {completeLimit:false, jackpot:false},
    online:!!source.online,
    locked:!!source.locked,
    currentSessionId:source.locked ? "active" : "",
    currentPlayerName:source.locked ? "利用中" : "",
    updatedAt:Number(source.updatedAt || 0),
    jackpotPool:source.jackpotPool || null,
    machineTotalStats:source.machineTotalStats || {},
    machineTotalSlumpHistory:Array.isArray(source.machineTotalSlumpHistory) ? source.machineTotalSlumpHistory.slice(-720) : [{spin:0, profit:0}]
  };
}

function sendCaptured(res, req, captured, transformBody=null){
  let status = captured.status;
  let body = captured.body;
  if(typeof transformBody === "function"){
    const transformed = transformBody(safeJson(body, null), status);
    body = Buffer.from(JSON.stringify(transformed));
  }
  if(status >= 500){
    const internal = body.toString("utf8");
    console.error("VERTEX gateway upstream error", {path:normalizeApiPath(req), status, internal:internal.slice(0, 1000)});
    body = Buffer.from(JSON.stringify({ok:false, error:"internal server error"}));
  }
  res.statusCode = status;
  setSecurityHeaders(res, req);
  for(const {name, value} of captured.headers.values()){
    const lower = name.toLowerCase();
    if(lower === "content-length" || lower.startsWith("access-control-") || lower === "cache-control" || lower === "pragma") continue;
    res.setHeader(name, value);
  }
  if(!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", body.length);
  res.end(body);
}

async function supabase(path, options={}){
  if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw Object.assign(new Error("service unavailable"), {statusCode:503});
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers:{
      apikey:SUPABASE_SERVICE_ROLE_KEY,
      Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type":"application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch(error){ data = null; }
  if(!response.ok){
    console.error("VERTEX Supabase request failed", {status:response.status, path:path.split("?")[0]});
    throw Object.assign(new Error("database request failed"), {statusCode:503});
  }
  return data;
}

async function dbSession(sessionId){
  const rows = await supabase(`sessions?session_id=eq.${encodeURIComponent(String(sessionId))}&select=session_id,token,password,machine_id,status,reset_serial_at_start&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function dbMachine(machineId){
  const rows = await supabase(`machine_states?machine_id=eq.${encodeURIComponent(String(machineId))}&select=machine_id,current_session_id,reset_serial,locked,assigned_setting,last_snapshot&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function requestSessionToken(req, body={}){
  const authorization = firstHeader(req, "authorization");
  if(/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, "").trim();
  return firstHeader(req, "x-session-token").trim() || String(body.sessionToken || body.token || "");
}

async function assertActiveSession(req, machineId, body={}){
  const playSessionId = String(body.playSessionId || body.sessionId || "").trim();
  if(!playSessionId) throw Object.assign(new Error("playSessionId required"), {statusCode:401});
  const [session, machine] = await Promise.all([dbSession(playSessionId), dbMachine(machineId)]);
  if(!session || !machine) throw Object.assign(new Error("active session required"), {statusCode:401});
  const valid = session.status === "active"
    && String(session.machine_id) === String(machineId)
    && String(machine.current_session_id || "") === playSessionId
    && Number(session.reset_serial_at_start || 0) === Number(machine.reset_serial || 0);
  if(!valid) throw Object.assign(new Error("stale or mismatched session"), {statusCode:409});
  const suppliedToken = requestSessionToken(req, body);
  if(SESSION_TOKEN_REQUIRED && (!suppliedToken || !constantTimeEqual(suppliedToken, session.token))){
    throw Object.assign(new Error("session token required"), {statusCode:401});
  }
  return {session, machine};
}

async function cancelSession(session, reason="admin-reset"){
  if(!session || !session.session_id) return;
  const now = Date.now();
  await supabase(`sessions?session_id=eq.${encodeURIComponent(session.session_id)}&status=eq.active`, {
    method:"PATCH",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify({status:"cancelled", ended_at_ms:now, result_record:{cancelled:true, reason, endedAtMs:now}})
  });
  if(session.password){
    await supabase(`issued_passwords?password=eq.${encodeURIComponent(session.password)}&session_id=eq.${encodeURIComponent(session.session_id)}`, {
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({status:"cancelled"})
    });
  }
}

async function verifySessionEnd(body){
  const sessionId = String(body.sessionId || "").trim();
  const session = await dbSession(sessionId);
  if(!session) throw Object.assign(new Error("invalid session"), {statusCode:403});
  if(!constantTimeEqual(session.token, String(body.token || ""))) throw Object.assign(new Error("invalid session"), {statusCode:403});
  if(session.status === "ended") return {session, alreadyEnded:true};
  if(session.status !== "active") throw Object.assign(new Error("session is not active"), {statusCode:409});
  const machine = await dbMachine(session.machine_id);
  if(!machine
    || String(machine.current_session_id || "") !== sessionId
    || Number(machine.reset_serial || 0) !== Number(session.reset_serial_at_start || 0)){
    throw Object.assign(new Error("stale session cannot end current machine"), {statusCode:409});
  }
  return {session, machine, alreadyEnded:false};
}

function constrainSnapshot(body, machine){
  const next = stripSecretsDeep(body || {});
  next.playSessionId = String(body.playSessionId || "");
  if(next.settings && typeof next.settings === "object"){
    next.settings.setting = Math.max(1, Math.min(6, Number(machine.assigned_setting || 1)));
  }
  if(next.stats && typeof next.stats === "object"){
    const numericKeys = ["totalSessions","totalFee","totalPaid","totalSpins","normalSpins","highSpins","bigCount","midCount","premiumBigCount","grapeCount","smallCount","bellCount","diagonalBellCount","replayCount","suikaCount","cherryCount","profit"];
    for(const key of numericKeys){
      if(next.stats[key] === undefined) continue;
      const value = Number(next.stats[key]);
      next.stats[key] = Number.isFinite(value) ? Math.max(-1_000_000_000, Math.min(1_000_000_000, value)) : 0;
    }
    if(Array.isArray(next.stats.slumpHistory)) next.stats.slumpHistory = next.stats.slumpHistory.slice(-720);
  }
  return next;
}

async function readiness(){
  const problems = configuredRuntimeProblems();
  if(problems.length) return {ok:false, problems};
  try{
    await supabase("machine_states?select=machine_id&limit=1", {method:"GET"});
    return {ok:true, problems:[]};
  }catch(error){
    return {ok:false, problems:["SUPABASE_CONNECTIVITY"]};
  }
}

export default async function gateway(req, res){
  const pathname = normalizeApiPath(req);
  try{
    if(req.method === "OPTIONS"){
      if(!requestOriginAllowed(req)) return sendJson(res, req, 403, {ok:false, error:"origin not allowed"});
      res.statusCode = 204;
      setSecurityHeaders(res, req);
      return res.end();
    }

    if(pathname === "/api/gateway" || pathname === "/api/index"){
      return sendJson(res, req, 404, {ok:false, error:"not found"});
    }

    if(pathname === "/api/health" || pathname === "/api/ready"){
      const status = await readiness();
      return sendJson(res, req, status.ok ? 200 : 503, {
        ok:status.ok,
        storeId:STORE_ID,
        storeName:STORE_NAME,
        machineCount:MACHINE_DEFINITIONS.length,
        configSource:CONFIG_SOURCE,
        problems:status.problems,
        nodeVersion:process.version,
        gitCommitSha:String(process.env.VERCEL_GIT_COMMIT_SHA || "")
      });
    }

    if(pathname === "/api/config" && req.method === "GET"){
      const upstream = await delegate(req);
      return sendCaptured(res, req, upstream, data=>({
        ...(data && typeof data === "object" ? data : {}),
        configSource:CONFIG_SOURCE,
        gitCommitSha:String(process.env.VERCEL_GIT_COMMIT_SHA || ""),
        readyProblems:configuredRuntimeProblems(),
        machineCount:MACHINE_DEFINITIONS.length,
        stores:STORE_DIRECTORY
      }));
    }

    if(pathname === "/api/admin/verify" && req.method === "GET"){
      if(!configuredAdminPassword()) return sendJson(res, req, 503, {ok:false, error:"admin authentication is not configured"});
      if(!adminHeaderOk(req)) return sendJson(res, req, 401, {ok:false, error:"admin password required"});
      return sendJson(res, req, 200, {ok:true}, {"Set-Cookie":makeAdminCookie()});
    }

    if(pathname === "/api/admin/logout" && req.method === "POST"){
      return sendJson(res, req, 200, {ok:true}, {"Set-Cookie":clearAdminCookie()});
    }

    if(!requestOriginAllowed(req)) return sendJson(res, req, 403, {ok:false, error:"origin not allowed"});

    if(isAdminRoute(pathname)){
      if(!configuredAdminPassword()) return sendJson(res, req, 503, {ok:false, error:"admin authentication is not configured"});
      if(!adminRequestOk(req)) return sendJson(res, req, 401, {ok:false, error:"admin password required"});
    }

    const body = await readLimitedBody(req);

    if(pathname === "/api/sessions/end" && req.method === "POST"){
      await verifySessionEnd(body);
    }

    const stateMatch = pathname.match(/^\/api\/machines\/([^/]+)\/state$/);
    if(stateMatch && req.method === "POST"){
      const machineId = decodeURIComponent(stateMatch[1]);
      const active = await assertActiveSession(req, machineId, body);
      req.body = constrainSnapshot(body, active.machine);
    }

    if((pathname === "/api/jackpot/contribute" || pathname === "/api/jackpot/claim") && req.method === "POST"){
      const machineId = String(body.machineId || "").trim();
      await assertActiveSession(req, machineId, body);
    }

    const resetMatch = pathname.match(/^\/api\/admin\/machines\/([^/]+)\/reset$/);
    if(resetMatch && req.method === "POST"){
      const machine = await dbMachine(decodeURIComponent(resetMatch[1]));
      const activeSession = machine && machine.current_session_id ? await dbSession(machine.current_session_id) : null;
      const upstream = await delegate(req);
      const data = safeJson(upstream.body, {});
      if(upstream.status >= 200 && upstream.status < 300 && data && data.ok && activeSession){
        await cancelSession(activeSession, "admin-reset");
      }
      return sendCaptured(res, req, upstream, value=>stripPasswordsDeep(value));
    }

    if(pathname === "/api/sessions/start" && req.method === "POST"){
      const upstream = await delegate(req);
      const data = safeJson(upstream.body, null);
      if(upstream.status >= 200 && upstream.status < 300 && data && data.ok && data.session){
        const [session, machine] = await Promise.all([dbSession(data.session.sessionId), dbMachine(data.session.machineId)]);
        const current = session && machine
          && session.status === "active"
          && String(machine.current_session_id || "") === String(session.session_id)
          && Number(machine.reset_serial || 0) === Number(session.reset_serial_at_start || 0);
        if(!current){
          if(session) await cancelSession(session, "superseded-session");
          return sendJson(res, req, 409, {ok:false, error:"session was superseded; request a new password"});
        }
      }
      return sendCaptured(res, req, upstream, value=>stripPasswordsDeep(value));
    }

    if(pathname === "/api/admin/issue-password" && req.method === "POST"){
      const upstream = await delegate(req);
      return sendCaptured(res, req, upstream, sanitizeIssuedPasswordResponse);
    }

    if(pathname === "/api/machines" && req.method === "GET"){
      const upstream = await delegate(req);
      return sendCaptured(res, req, upstream, value=>{
        const rows = Array.isArray(value) ? value : [];
        if(adminRequestOk(req)) return rows.map(row=>stripSecretsDeep(row));
        return rows.map(sanitizePublicMachine);
      });
    }

    const upstream = await delegate(req);
    return sendCaptured(res, req, upstream, value=>stripPasswordsDeep(value));
  }catch(error){
    const status = Number(error && error.statusCode) || 500;
    if(status >= 500) console.error("VERTEX gateway failure", {path:pathname, error:error && error.message});
    return sendJson(res, req, status, {ok:false, error:status >= 500 ? "internal server error" : error.message});
  }
}
