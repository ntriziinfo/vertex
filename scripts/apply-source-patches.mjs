import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const checkOnly = process.argv.includes("--check");

function load(relative){
  const file = path.join(root, relative);
  if(!fs.existsSync(file)) throw new Error(`Missing source file: ${relative}`);
  return {file, relative, text:fs.readFileSync(file, "utf8")};
}

function replacement(target, before, after, label){
  if(target.text.includes(after)) return;
  if(!target.text.includes(before)) throw new Error(`${target.relative}: patch context not found for ${label}`);
  if(checkOnly) throw new Error(`${target.relative}: security patch not applied: ${label}`);
  target.text = target.text.replace(before, after);
  target.changed = true;
}

function save(target){
  if(target.changed) fs.writeFileSync(target.file, target.text, "utf8");
}

const api = load("api/index.mjs");
replacement(
  api,
  'const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "");',
  'const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");',
  "service-role-only Supabase access"
);
replacement(
  api,
  'function adminOk(req){ return !ADMIN_PASSWORD || String(req.headers["x-admin-password"] || "") === ADMIN_PASSWORD; }',
  'function adminOk(req){ return !!ADMIN_PASSWORD && ADMIN_PASSWORD.toLowerCase() !== "change-me" && String(req.headers["x-admin-password"] || "") === ADMIN_PASSWORD; }',
  "fail-closed admin authentication"
);
replacement(
  api,
  'export default async function handler(req, res){\n  try{\n    if(req.method === "OPTIONS") return json(res, 204, {});',
  'export default async function handler(req, res){\n  try{\n    if(!req.__vertexGatewayAuthorized) return json(res, 404, {ok:false, error:"not found"});\n    if(req.method === "OPTIONS") return json(res, 204, {});',
  "block direct api/index bypass"
);
replacement(
  api,
  'sessionId:session.sessionId, password:session.password, resetSerial:',
  'sessionId:session.sessionId, resetSerial:',
  "remove plaintext password from result records"
);
replacement(
  api,
  'async function sendToSheets(record){\n  if(!SHEETS_WEBHOOK_URL) return {ok:false, skipped:true, reason:"GOOGLE_SHEETS_WEBHOOK_URL is not set"};\n  try{ return {ok:true, result:await postJson(SHEETS_WEBHOOK_URL, record)}; }catch(e){ return {ok:false, error:e.message}; }\n}',
  'async function sendToSheets(record){\n  if(!SHEETS_WEBHOOK_URL) return {ok:false, skipped:true, reason:"GOOGLE_SHEETS_WEBHOOK_URL is not set"};\n  try{\n    const result = await postJson(SHEETS_WEBHOOK_URL, record);\n    const ok = Number(result && result.status) >= 200 && Number(result && result.status) < 300;\n    return ok ? {ok:true, result} : {ok:false, error:`Sheets webhook returned ${result && result.status || "unknown"}`};\n  }catch(e){ return {ok:false, error:e.message}; }\n}',
  "treat non-2xx Sheets responses as failures"
);
save(api);

const play = load("play.html");
replacement(play, 'let active = null;\nlet machineNames = new Map();', 'let active = null;\nlet slotOrigin = "";\nlet machineNames = new Map();', "track the game iframe origin");
replacement(play, "  $('slot').src = data.iframeUrl;\n  $('login').hidden = true;", "  slotOrigin = new URL(data.iframeUrl, location.href).origin;\n  $('slot').src = data.iframeUrl;\n  $('login').hidden = true;", "capture the iframe origin at session start");
replacement(
  play,
  "  const res = await fetch('/api/sessions/end', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...active, snapshot, forced:!!options.forced})});\n  const data = await res.json();\n  clearSlotLocalState();\n  active = null;\n  $('play').hidden = true;\n  $('slot').src = 'about:blank';\n  $('ended').hidden = false;\n  $('sendStatus').textContent = data.sheets && data.sheets.ok ? 'スプレッドシートへ送信済みです。' : 'ローカルに記録しました。スプレッドシート連携URLが未設定の場合はこの表示になります。';",
  "  try{\n    const res = await fetch('/api/sessions/end', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...active, snapshot, forced:!!options.forced})});\n    const data = await res.json().catch(()=>({}));\n    if(!res.ok || !data.ok) throw new Error(data.error || '終了処理に失敗しました');\n    clearSlotLocalState();\n    active = null;\n    slotOrigin = '';\n    $('play').hidden = true;\n    $('slot').src = 'about:blank';\n    $('ended').hidden = false;\n    $('sendStatus').textContent = data.sheets && data.sheets.ok ? 'スプレッドシートへ送信済みです。' : '終了データを保存しました。Sheets未連携または送信失敗時は管理画面で確認してください。';\n  }catch(error){\n    $('endBtn').disabled = false;\n    $('endBtn').textContent = '終了してデータ送信';\n    alert(error.message || '終了処理に失敗しました。画面を閉じずに再実行してください。');\n  }",
  "do not show a false successful end state"
);
replacement(
  play,
  "window.addEventListener('message', event=>{\n  const msg = event.data || {};",
  "window.addEventListener('message', event=>{\n  if(event.source !== $('slot').contentWindow) return;\n  if(slotOrigin && event.origin !== slotOrigin) return;\n  const msg = event.data || {};",
  "validate postMessage source and origin"
);
save(play);

const admin = load("admin.html");
replacement(
  admin,
  "function logoutAdmin(){\n  adminSecret = '';",
  "function logoutAdmin(){\n  fetch('/api/admin/logout', {method:'POST'}).catch(()=>{});\n  adminSecret = '';",
  "clear the HttpOnly admin session cookie on logout"
);
save(admin);

const localServer = load("server.js");
replacement(
  localServer,
  'function adminOk(req){\n  if(!ADMIN_PASSWORD) return true;\n  const provided = req.headers["x-admin-password"] || "";\n  return String(provided) === ADMIN_PASSWORD;\n}',
  'function adminOk(req){\n  if(!ADMIN_PASSWORD || ADMIN_PASSWORD.toLowerCase() === "change-me") return false;\n  const provided = req.headers["x-admin-password"] || "";\n  return String(provided) === ADMIN_PASSWORD;\n}',
  "fail-closed local admin authentication"
);
replacement(
  localServer,
  'sessionId:session.sessionId, password:session.password, resetSerial:',
  'sessionId:session.sessionId, resetSerial:',
  "remove plaintext password from local result records"
);
save(localServer);

if(!checkOnly){
  console.log("Applied Vertex P0 source patches.");
}else{
  console.log("Verified Vertex P0 source patches.");
}
