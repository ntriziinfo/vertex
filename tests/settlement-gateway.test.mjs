import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('V2 real gateway keeps failed Sheets delivery durable and revokes the ended session',()=>{
 const r=spawnSync(process.execPath,['tests/fixtures/settlement-gateway.mjs'],{encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});
