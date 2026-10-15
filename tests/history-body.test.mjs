import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('long hit histories fit state and end payloads while the one MiB request limit remains enforced',async()=>{
 const source=fs.readFileSync('api/gateway.mjs','utf8'),c=vm.createContext({Buffer,process:{env:{}}});
 vm.runInContext(source.match(/const MAX_BODY_BYTES =[^\n]+/)[0]+source.match(/async function readLimitedBody\([^]*?\n}/)[0],c);
 const body={stats:{dataHits:Array.from({length:10000},(_,i)=>({seq:i+1,spin:i*100,kind:'ZONE',zone:'sora',games:100,phase:'art'}))}};
 assert(Buffer.byteLength(JSON.stringify(body))>262144);
 assert.equal((await c.readLimitedBody({method:'POST',body})).stats.dataHits.length,10000);
 await assert.rejects(c.readLimitedBody({method:'POST',body:{padding:'x'.repeat(1048576)}}),e=>e.statusCode===413);
});
