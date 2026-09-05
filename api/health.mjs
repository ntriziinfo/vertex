import machineConfig from "../machine-config.cjs";

const TIMEOUT_MS = 5000;

function runtimeProblems(){
  const problems = [];
  const adminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
  if(!adminPassword || adminPassword.toLowerCase() === "change-me") problems.push("ADMIN_PASSWORD");
  if(!String(process.env.SUPABASE_URL || "").trim()) problems.push("SUPABASE_URL");
  if(!String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) problems.push("SUPABASE_SERVICE_ROLE_KEY");
  if(!String(process.env.VERTEX_STORE_ID || "").trim() || machineConfig.STORE_ID === "store-local") problems.push("VERTEX_STORE_ID");
  if(machineConfig.STORE_ID === "store-debug"){
    const novaCount = machineConfig.MACHINE_DEFINITIONS.filter(machine=>machine.machineType === "nova").length;
    if(novaCount !== 12) problems.push("DEBUG_NOVA_MACHINE_COUNT");
  }
  return [...new Set(problems)];
}

async function checkDatabase(){
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if(!url || !key) return false;
  try{
    const response = await fetch(`${url}/rest/v1/machine_states?select=machine_id&limit=1`, {
      headers:{apikey:key, Authorization:`Bearer ${key}`},
      signal:AbortSignal.timeout(TIMEOUT_MS)
    });
    return response.ok;
  }catch(error){
    return false;
  }
}

export default async function health(req, res){
  const problems = runtimeProblems();
  if(!problems.length && !(await checkDatabase())) problems.push("SUPABASE_CONNECTIVITY");
  const ok = problems.length === 0;
  const body = JSON.stringify({
    ok,
    storeId:machineConfig.STORE_ID,
    storeName:machineConfig.STORE_NAME,
    storeDirectoryCount:machineConfig.STORE_DIRECTORY.length,
    machineCount:machineConfig.MACHINE_DEFINITIONS.length,
    configSource:machineConfig.CONFIG_SOURCE || "unknown",
    problems,
    nodeVersion:process.version,
    gitCommitSha:String(process.env.VERCEL_GIT_COMMIT_SHA || "")
  });
  res.statusCode = ok ? 200 : 503;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}
