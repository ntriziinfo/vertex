import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('admin.html','utf8');
const fn=name=>source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0];
const report=()=>({schema:'nova-current-rtp/v1',status:'ready',gamesPerSetting:1000000000,commit:'a'.repeat(40),modelHash:'b'.repeat(64),conditions:'10億G連続・MY／差枚停止なし',settings:[1,2,3,4,5,6].map(setting=>({setting,rtpPct:94+setting}))});
function harness(){
 const c=vm.createContext({novaRtpReport:null,novaRtpLoading:false,AbortSignal,renderMachines(){c.renders=(c.renders||0)+1;}});
 for(const name of ['verifiedNovaRtp','loadNovaRtp','machineSettingValue','machineSettingRtp'])vm.runInContext(fn(name),c);
 return c;
}

test('production admin CSP permits the exact live RTP endpoint without broadening other pages',()=>{
 const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
 const headerFor=page=>config.headers.find(row=>row.source===page).headers.find(header=>header.key.toLowerCase()==='content-security-policy').value;
 const connections=page=>headerFor(page).split(';').map(value=>value.trim().split(/\s+/)).find(parts=>parts[0]==='connect-src').slice(1);
 const endpoint=fn('loadNovaRtp').match(/fetch\('([^']+)'/)[1];
 assert.deepEqual(connections('/admin.html'),["'self'",new URL(endpoint).origin]);
 assert.deepEqual(connections('/play.html'),["'self'"]);
});
test('NOVA reads the shared report and never falls back to another machines fixed RTP',()=>{
 const c=harness();assert(Number.isNaN(c.machineSettingRtp({machineType:'nova',assignedSetting:6})));
 c.novaRtpReport=report();assert.equal(c.machineSettingRtp({machineType:'nova',assignedSetting:6}),100);
 assert.equal(c.machineSettingRtp({machineType:'rising',assignedSetting:6}),108);
 assert.equal(c.machineSettingRtp({machineType:'jackspot',assignedSetting:6}),105);
 for(const change of [r=>r.status='pending',r=>r.gamesPerSetting=100000000,r=>r.settings[0].setting=2,r=>r.settings[0].rtpPct=null,r=>r.commit='old',r=>r.modelHash=undefined]){
  const r=report();change(r);assert.equal(c.verifiedNovaRtp(r),false);
 }
 const pooled={...report(),conditions:'2.5億G×4系列合算・MY／差枚停止なし'};assert(c.verifiedNovaRtp(pooled));
 assert.match(source,/id="floorAverageRtp" class="rtp">未取得/);
 assert.match(source,/data-machine-rtp=/);
});
test('fetch refreshes ready data, coalesces requests and removes old values on pending or failure',async()=>{
 const c=harness();let resolve,calls=0;
 c.fetch=(url,options)=>{calls++;assert.match(url,/nova-rtp-current\.json$/);assert.equal(options.cache,'no-store');return new Promise(r=>resolve=r);};
 const p=c.loadNovaRtp();await c.loadNovaRtp();assert.equal(calls,1);
 resolve({ok:true,json:async()=>report()});await p;assert(c.novaRtpReport);assert.equal(c.novaRtpLoading,false);
 c.fetch=async()=>({ok:true,json:async()=>({...report(),status:'pending'})});await c.loadNovaRtp();assert.equal(c.novaRtpReport,null);
 c.novaRtpReport=report();c.fetch=async()=>{throw Error('offline');};await c.loadNovaRtp();assert.equal(c.novaRtpReport,null);
});
