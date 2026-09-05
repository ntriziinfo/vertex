const fs = require("fs");
const path = require("path");

const STORE_ID = String(process.env.VERTEX_STORE_ID || "store-local").trim() || "store-local";
const STORE_NAME = String(process.env.VERTEX_STORE_NAME || "VERTEX ローカル店舗").trim() || "VERTEX ローカル店舗";
const STRICT_CONFIG = String(process.env.VERTEX_STRICT_CONFIG || (process.env.VERCEL ? "1" : "0")) !== "0";

const DEFAULT_STORE_DIRECTORY = [
  {storeId:"store-jag-one", storeName:"Vertex管理画面", adminUrl:""},
  {storeId:"store-las-vegas", storeName:"ロスベガス管理画面", adminUrl:""},
  {storeId:"store-debug", storeName:"デバッグ", adminUrl:""}
];

function normalizeStoreDefinition(value, index=0){
  const raw = value && typeof value === "object" ? value : {};
  const storeId = String(raw.storeId || raw.id || `store-${index + 1}`).trim();
  const storeName = String(raw.storeName || raw.displayName || raw.name || storeId).trim() || storeId;
  const adminUrl = String(raw.adminUrl || raw.url || "").trim();
  return {storeId, storeName, adminUrl};
}

function parseStoreDirectory(raw){
  const source = Array.isArray(raw) ? raw : raw && Array.isArray(raw.stores) ? raw.stores : [];
  const seen = new Set();
  return source
    .map(normalizeStoreDefinition)
    .filter(store=>{
      if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(store.storeId) || seen.has(store.storeId)) return false;
      if(store.adminUrl && !/^https?:\/\//i.test(store.adminUrl)) return false;
      seen.add(store.storeId);
      return true;
    });
}

function parseJsonConfig(label, text, parser){
  try{
    const parsed = parser(JSON.parse(text));
    if(parsed.length) return parsed;
    const error = new Error(`${label} contains no valid entries`);
    if(STRICT_CONFIG) throw error;
    console.warn(error.message);
  }catch(error){
    if(STRICT_CONFIG) throw new Error(`${label} cannot be loaded: ${error.message}`);
    console.warn(`${label}を読み込めません:`, error.message);
  }
  return null;
}

function loadStoreDirectory(){
  const envJson = String(process.env.VERTEX_STORES_JSON || "").trim();
  if(envJson){
    const parsed = parseJsonConfig("VERTEX_STORES_JSON", envJson, parseStoreDirectory);
    if(parsed) return {value:parsed, source:"env:VERTEX_STORES_JSON"};
  }

  const localPath = path.join(__dirname, "stores.local.json");
  if(fs.existsSync(localPath)){
    const parsed = parseJsonConfig("stores.local.json", fs.readFileSync(localPath, "utf8"), parseStoreDirectory);
    if(parsed) return {value:parsed, source:"file:stores.local.json"};
  }

  return {value:DEFAULT_STORE_DIRECTORY.map(normalizeStoreDefinition), source:"default"};
}

const storeDirectoryResult = loadStoreDirectory();
const STORE_DIRECTORY = storeDirectoryResult.value;
const STORE_DIRECTORY_SOURCE = storeDirectoryResult.source;

const DEFAULT_RISING_GAME_URL = String(
  process.env.VERTEX_RISING_GAME_URL || "http://127.0.0.1:18887/jag.html"
).trim();
const DEFAULT_JACKSPOT_GAME_URL = String(
  process.env.VERTEX_JACKSPOT_GAME_URL || "http://127.0.0.1:18888/jackspot.html"
).trim();

const DEFAULT_MACHINE_DEFINITIONS = [
  {
    machineId:"rising-01",
    displayName:"RISING 1番台",
    machineType:"rising",
    gameUrl:DEFAULT_RISING_GAME_URL,
    poolId:"",
    capabilities:{completeLimit:true, jackpot:false}
  },
  ...Array.from({length:5}, (_, index)=>({
    machineId:`jackspot-${String(index + 1).padStart(2, "0")}`,
    displayName:`JACsPOT ${index + 1}番台`,
    machineType:"jackspot",
    gameUrl:DEFAULT_JACKSPOT_GAME_URL,
    poolId:"jackspot-main",
    capabilities:{completeLimit:false, jackpot:true}
  }))
];

function normalizeMachineDefinition(value, index=0){
  const raw = value && typeof value === "object" ? value : {};
  const machineId = String(raw.machineId || raw.id || `machine-${index + 1}`).trim();
  const machineType = String(raw.machineType || raw.type || "generic").trim().toLowerCase();
  return {
    machineId,
    displayName:String(raw.displayName || raw.name || machineId).trim() || machineId,
    machineType:machineType || "generic",
    gameUrl:String(raw.gameUrl || raw.url || "").trim(),
    poolId:String(raw.poolId || "").trim(),
    capabilities:{
      completeLimit:raw.capabilities && raw.capabilities.completeLimit !== undefined
        ? !!raw.capabilities.completeLimit
        : ["rising", "nova"].includes(machineType),
      jackpot:raw.capabilities && raw.capabilities.jackpot !== undefined
        ? !!raw.capabilities.jackpot
        : machineType === "jackspot"
    }
  };
}

function parseMachineDefinitions(raw){
  const source = Array.isArray(raw) ? raw : raw && Array.isArray(raw.machines) ? raw.machines : [];
  const seen = new Set();
  return source
    .map(normalizeMachineDefinition)
    .filter(machine=>{
      if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(machine.machineId) || seen.has(machine.machineId)) return false;
      if(!machine.gameUrl) return false;
      seen.add(machine.machineId);
      return true;
    });
}

function loadStorePreset(){
  const presetPath = path.join(__dirname, "store-configs", `${STORE_ID}.machines.json`);
  if(!fs.existsSync(presetPath)) return null;
  const relative = path.relative(__dirname, presetPath).replace(/\\/g, "/");
  const parsed = parseJsonConfig(relative, fs.readFileSync(presetPath, "utf8"), parseMachineDefinitions);
  return parsed ? {value:parsed, source:`file:${relative}`} : null;
}

function loadMachineDefinitions(){
  // The debug floor is intentionally deterministic. A stale Vercel JSON value must
  // not silently replace the committed twelve-Nova layout. Set the explicit escape
  // hatch only when a temporary override is truly required.
  const allowDebugOverride = /^(1|true|yes)$/i.test(String(process.env.VERTEX_ALLOW_DEBUG_MACHINE_OVERRIDE || ""));
  if(STORE_ID === "store-debug" && !allowDebugOverride){
    const preset = loadStorePreset();
    if(preset) return preset;
    if(STRICT_CONFIG) throw new Error("store-configs/store-debug.machines.json is required for store-debug");
  }

  const envJson = String(process.env.VERTEX_MACHINES_JSON || "").trim();
  if(envJson){
    const parsed = parseJsonConfig("VERTEX_MACHINES_JSON", envJson, parseMachineDefinitions);
    if(parsed) return {value:parsed, source:"env:VERTEX_MACHINES_JSON"};
  }

  const localPath = path.join(__dirname, "machines.local.json");
  if(fs.existsSync(localPath)){
    const parsed = parseJsonConfig("machines.local.json", fs.readFileSync(localPath, "utf8"), parseMachineDefinitions);
    if(parsed) return {value:parsed, source:"file:machines.local.json"};
  }

  const preset = loadStorePreset();
  if(preset) return preset;

  return {value:DEFAULT_MACHINE_DEFINITIONS.map(normalizeMachineDefinition), source:"default"};
}

const machineDefinitionResult = loadMachineDefinitions();
const MACHINE_DEFINITIONS = machineDefinitionResult.value;
const CONFIG_SOURCE = machineDefinitionResult.source;
const MACHINE_DEFINITION_BY_ID = new Map(MACHINE_DEFINITIONS.map(machine=>[machine.machineId, machine]));

function machineDefinition(id){
  return MACHINE_DEFINITION_BY_ID.get(String(id || "")) || null;
}

module.exports = {
  STORE_ID,
  STORE_NAME,
  STORE_DIRECTORY,
  STORE_DIRECTORY_SOURCE,
  MACHINE_DEFINITIONS,
  CONFIG_SOURCE,
  machineDefinition,
  normalizeMachineDefinition,
  parseMachineDefinitions,
  normalizeStoreDefinition,
  parseStoreDirectory
};
