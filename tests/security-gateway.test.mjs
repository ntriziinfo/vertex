import test from "node:test";
import assert from "node:assert/strict";
import {
  constantTimeEqual,
  configuredRuntimeProblems,
  isAdminRoute,
  sanitizeIssuedPasswordResponse,
  sanitizePublicMachine
} from "../api/gateway.mjs";

test("constant-time comparison is exact", ()=>{
  assert.equal(constantTimeEqual("correct", "correct"), true);
  assert.equal(constantTimeEqual("correct", "wrong"), false);
  assert.equal(constantTimeEqual("correct", "correct-longer"), false);
});

test("admin routes are classified", ()=>{
  assert.equal(isAdminRoute("/api/admin/verify"), true);
  assert.equal(isAdminRoute("/api/results"), true);
  assert.equal(isAdminRoute("/api/machines/nova-01/command"), true);
  assert.equal(isAdminRoute("/api/machines"), false);
});

test("public machine payload hides session and result secrets", ()=>{
  const publicMachine = sanitizePublicMachine({
    storeId:"store-debug",
    machineId:"nova-01",
    displayName:"Nova 1番台",
    machineType:"nova",
    locked:true,
    currentSessionId:"sess_secret",
    currentPlayerName:"private name",
    assignedSetting:6,
    settings:{setting:6},
    lastEndedSession:{record:{password:"secret", token:"token"}},
    machineTotalStats:{totalSpins:10},
    machineTotalSlumpHistory:[{spin:0, profit:0}]
  });
  assert.equal(publicMachine.currentSessionId, "active");
  assert.equal(publicMachine.currentPlayerName, "利用中");
  assert.equal("assignedSetting" in publicMachine, false);
  assert.equal("settings" in publicMachine, false);
  assert.equal("lastEndedSession" in publicMachine, false);
  assert.equal(JSON.stringify(publicMachine).includes("sess_secret"), false);
  assert.equal(JSON.stringify(publicMachine).includes("private name"), false);
});

test("newly issued password is returned once without exposing other secrets", ()=>{
  const response = sanitizeIssuedPasswordResponse({
    ok:true,
    issued:{password:"482731", machineId:"nova-01", playerName:"test player", status:"issued"},
    internal:{password:"hidden", token:"hidden-token"}
  });
  assert.equal(response.issued.password, "482731");
  assert.equal(response.issued.machineId, "nova-01");
  assert.equal("password" in response.internal, false);
  assert.equal("token" in response.internal, true);
});

test("runtime validation rejects missing secrets and invalid debug layout", ()=>{
  const problems = configuredRuntimeProblems({
    ADMIN_PASSWORD:"",
    SUPABASE_URL:"",
    SUPABASE_SERVICE_ROLE_KEY:"",
    VERTEX_STORE_ID:"store-debug",
    VERCEL_ENV:"production"
  }, []);
  assert.ok(problems.includes("ADMIN_PASSWORD"));
  assert.ok(problems.includes("SUPABASE_URL"));
  assert.ok(problems.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(problems.includes("MACHINE_DEFINITIONS"));
  assert.ok(problems.includes("DEBUG_NOVA_MACHINE_COUNT"));
});
