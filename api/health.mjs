import machineConfig from "../machine-config.cjs";

export default function health(req, res){
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    storeId: machineConfig.STORE_ID,
    storeName: machineConfig.STORE_NAME,
    storeDirectoryCount: machineConfig.STORE_DIRECTORY.length,
    machineCount: machineConfig.MACHINE_DEFINITIONS.length,
    supabaseUrlSet: !!process.env.SUPABASE_URL,
    supabaseKeySet: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY),
    sheetsWebhookSet: !!process.env.GOOGLE_SHEETS_WEBHOOK_URL,
    nodeVersion: process.version
  }));
}
