const fs = require("fs");
const path = require("path");

const STORE_ID = String(process.env.VERTEX_STORE_ID || "store-local").trim() || "store-local";
const STORE_NAME = String(process.env.VERTEX_STORE_NAME || "VERTEX ローカル店舗").trim() || "VERTEX ローカル店舗";

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
        : machineType === "rising",
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
      seen.add(machine.machineId);
      return true;
    });
}

function loadMachineDefinitions(){
  const envJson = String(process.env.VERTEX_MACHINES_JSON || "").trim();
  if(envJson){
    try{
      const parsed = parseMachineDefinitions(JSON.parse(envJson));
      if(parsed.length) return parsed;
    }catch(error){
      console.warn("VERTEX_MACHINES_JSONを読み込めません:", error.message);
    }
  }

  const localPath = path.join(__dirname, "machines.local.json");
  if(fs.existsSync(localPath)){
    try{
      const parsed = parseMachineDefinitions(JSON.parse(fs.readFileSync(localPath, "utf8")));
      if(parsed.length) return parsed;
    }catch(error){
      console.warn("machines.local.jsonを読み込めません:", error.message);
    }
  }

  return DEFAULT_MACHINE_DEFINITIONS.map(normalizeMachineDefinition);
}

const MACHINE_DEFINITIONS = loadMachineDefinitions();
const MACHINE_DEFINITION_BY_ID = new Map(MACHINE_DEFINITIONS.map(machine=>[machine.machineId, machine]));

function machineDefinition(id){
  return MACHINE_DEFINITION_BY_ID.get(String(id || "")) || null;
}

module.exports = {
  STORE_ID,
  STORE_NAME,
  MACHINE_DEFINITIONS,
  machineDefinition,
  normalizeMachineDefinition,
  parseMachineDefinitions
};
