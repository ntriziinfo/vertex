import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const debugPath = path.join(root, "store-configs", "store-debug.machines.json");
const parsed = JSON.parse(fs.readFileSync(debugPath, "utf8"));
const machines = Array.isArray(parsed) ? parsed : parsed.machines;

if(!Array.isArray(machines) || machines.length !== 12){
  throw new Error(`store-debug must contain exactly 12 machines; found ${Array.isArray(machines) ? machines.length : 0}`);
}

const ids = new Set();
for(let index = 0; index < machines.length; index += 1){
  const expected = `nova-${String(index + 1).padStart(2, "0")}`;
  const machine = machines[index] || {};
  if(machine.machineId !== expected) throw new Error(`expected ${expected}, got ${machine.machineId || "empty"}`);
  if(ids.has(machine.machineId)) throw new Error(`duplicate machine id: ${machine.machineId}`);
  ids.add(machine.machineId);
  if(machine.machineType !== "nova") throw new Error(`${machine.machineId} must use machineType=nova`);
  if(!/^https:\/\//i.test(String(machine.gameUrl || ""))) throw new Error(`${machine.machineId} must use an HTTPS gameUrl`);
  if(machine.capabilities?.jackpot) throw new Error(`${machine.machineId} must not enable jackpot`);
}

console.log(`Validated ${machines.length} Nova machines in ${path.relative(root, debugPath)}`);
