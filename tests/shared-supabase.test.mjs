import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolveDatabaseSchema, scopeHeaders, STORE_SCHEMAS} from "../supabase-scope.mjs";
import {sharedSchemaSql} from "../scripts/shared-schema.mjs";

test("existing independent databases retain the public schema", () => {
  assert.equal(resolveDatabaseSchema({}), "public");
  assert.equal(resolveDatabaseSchema({VERTEX_STORE_ID: "store-debug"}), "public");
});

test("shared deployments reject another store's schema and invalid identifiers", () => {
  for (const [store, schema] of Object.entries(STORE_SCHEMAS)) {
    assert.equal(resolveDatabaseSchema({VERTEX_STORE_ID: store, VERTEX_DB_SCHEMA: schema}), schema);
    for (const invalid of ["auth", "storage", " public,auth", " ", "x;drop schema public", ...Object.values(STORE_SCHEMAS).filter(s => s !== schema)]) {
      assert.throws(() => resolveDatabaseSchema({VERTEX_STORE_ID: store, VERTEX_DB_SCHEMA: invalid}));
    }
  }
});

test("request profile overrides cannot escape the server-selected schema", () => {
  assert.deepEqual(scopeHeaders({
    "accept-profile": "public", "CONTENT-PROFILE": "vertex_debug", Prefer: "return=representation"
  }, {VERTEX_STORE_ID: "store-las-vegas", VERTEX_DB_SCHEMA: "vertex_las_vegas"}), {
    Prefer: "return=representation", "Accept-Profile": "vertex_las_vegas", "Content-Profile": "vertex_las_vegas"
  });
});

test("schema setup keeps every table, sequence and jackpot RPC in its own namespace", () => {
  for (const [store, schema] of Object.entries(STORE_SCHEMAS)) {
    const sql = sharedSchemaSql(store);
    assert.ok(sql.includes(`CREATE SCHEMA ${schema};`));
    assert.doesNotMatch(sql, /\bpublic\./);
    assert.equal((sql.match(/create table if not exists /g) || []).length, 7);
    assert.equal((sql.match(/enable row level security/g) || []).length, 7);
    assert.equal((sql.match(new RegExp(`set search_path = ${schema}`, "g")) || []).length, 3);
    assert.match(sql, /from public, anon, authenticated;/);
    assert.ok(sql.includes(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC, anon, authenticated;`));
    assert.ok(sql.includes(`GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schema} TO service_role;`));
    assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  }
  assert.throws(() => sharedSchemaSql("public"));
});

// Exercise the real gateway, legacy API and health handler, intercepting only
// their database transports. Test values are synthetic; no cloud calls occur.
const probe = String.raw`
  import assert from 'node:assert/strict';
  import {createRequire, syncBuiltinESMExports} from 'node:module';
  import {EventEmitter} from 'node:events';
  const require = createRequire(import.meta.url);
  const https = require('node:https');
  const calls = [];
  function answer(url, options, body) {
    const path = new URL(url).pathname.replace('/rest/v1/', '');
    const headers = options.headers;
    const method = options.method || 'GET';
    calls.push({path, method, headers});
    assert.equal(headers['Accept-Profile'], process.env.VERTEX_DB_SCHEMA || 'public');
    assert.equal(headers['Content-Profile'], process.env.VERTEX_DB_SCHEMA || 'public');
    if(path === 'machine_states') return [{machine_id:'same-id', current_session_id:'same-session', reset_serial:0, assigned_setting:2}];
    if(path === 'sessions') return [{session_id:'same-session', token:'test-token', machine_id:'same-id', status:'active', reset_serial_at_start:0}];
    if(path === 'issued_passwords') return method === 'POST' ? [JSON.parse(body)] : [{password:'SAME01', machine_id:'same-id', status:'issued'}];
    if(path === 'machine_commands') return [{id:1, machine_id:'same-id', command:{type:'snapshot'}}];
    if(path.startsWith('rpc/')) return [{current_pt:50, version:1, applied:true}];
    return [];
  }
  https.request = (url, options, callback) => {
    const req = new EventEmitter(); let body = '';
    req.write = chunk => {body += chunk;};
    req.end = () => queueMicrotask(() => {
      try {
        const response = new EventEmitter(); response.statusCode = 200;
        const data = answer(String(url), options, body);
        callback(response); response.emit('data', JSON.stringify(data)); response.emit('end');
      } catch(error) { req.emit('error', error); }
    });
    return req;
  };
  syncBuiltinESMExports();
  globalThis.fetch = async (url, options = {}) => new Response(JSON.stringify(answer(String(url), options, options.body)), {status:200});
  const {default:gateway} = await import('./api/gateway.mjs');
  const {default:health} = await import('./api/health.mjs');
  function response() {
    return {headers:{}, setHeader(k,v){this.headers[k.toLowerCase()]=v;}, getHeader(k){return this.headers[k.toLowerCase()];}, end(body){this.body=String(body);}};
  }
  for(const [path, method, body] of [
    ['machines','GET',{}],
    ['admin/passwords','GET',{}],
    ['results','GET',{}],
    ['admin/issue-password','POST',{machineId:'same-id', playerName:'synthetic'}],
    ['machines/same-id/commands/poll','GET',{}],
    ['machines/same-id/state','POST',{playSessionId:'same-session', token:'test-token', stats:{totalSpins:1}}],
    ['admin/jackpot/pools/shared-pool/amount','POST',{currentPt:50}]
  ]) {
    const res = response();
    await gateway({query:{path}, method, body, headers:{host:'test.invalid', 'x-admin-password':'test-admin', 'accept-profile':'other-store', 'content-profile':'other-store'}}, res);
    assert.equal(res.statusCode, 200, path + ': ' + res.body);
  }
  const healthRes = response(); await health({}, healthRes); assert.equal(healthRes.statusCode, 200);
  assert.ok(calls.some(c => c.path === 'sessions'));
  assert.ok(calls.some(c => c.path === 'machine_states' && c.method === 'POST'));
  assert.ok(calls.some(c => c.path === 'rpc/jackpot_pool_set'));
  process.stdout.write(JSON.stringify({requests:calls.length}));
`;

for (const [store, schema] of [...Object.entries(STORE_SCHEMAS), ["store-jag-one", "public"]]) {
  test(`all API reads, writes, health checks and RPCs select ${schema}`, () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 15000,
      env: {...process.env, VERTEX_STORE_ID:store, VERTEX_DB_SCHEMA:schema,
        VERTEX_ALLOW_DEBUG_MACHINE_OVERRIDE:"1", VERTEX_REQUIRE_SESSION_TOKEN:"0",
        VERTEX_MACHINES_JSON:JSON.stringify(Array.from({length:store === "store-debug" ? 12 : 1}, (_, i) => ({
          machineId:i === 0 ? "same-id" : `nova-${i}`, machineType:"nova", gameUrl:"https://game.invalid/play",
          poolId:"shared-pool", capabilities:{jackpot:true}
        }))),
        ADMIN_PASSWORD:"test-admin", SUPABASE_URL:"https://database.invalid", SUPABASE_SERVICE_ROLE_KEY:"test-key"}
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    assert.ok(JSON.parse(result.stdout).requests >= 10);
  });
}
