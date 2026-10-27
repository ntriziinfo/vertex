import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('admin.html','utf8');
const fn=name=>source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0];
const report=()=>({schema:'nova-current-rtp/v1',status:'ready',gamesPerSetting:1000000000,commit:'a'.repeat(40),conditions:'10億G連続・MY／差枚停止なし',settings:[1,2,3,4,5,6].map(setting=>({setting,rtpPct:94+setting}))});
function harness(){
 const c=vm.createContext({novaRtpReport:null,novaRtpLoading:false,AbortSignal,renderMachines(){c.renders=(c.renders||0)+1;}});
 for(const name of ['verifiedNovaRtp','loadNovaRtp','machineSettingValue','machineSettingRtp'])vm.runInContext(fn(name),c);
 return c;
}
test('NOVA reads the shared report and never falls back to another machines fixed RTP',()=>{
 const c=harness();assert(Number.isNaN(c.machineSettingRtp({machineType:'nova',assignedSetting:6})));
 c.novaRtpReport=report();assert.equal(c.machineSettingRtp({machineType:'nova',assignedSetting:6}),100);
 assert.equal(c.machineSettingRtp({machineType:'rising',assignedSetting:6}),108);
 assert.equal(c.machineSettingRtp({machineType:'jackspot',assignedSetting:6}),105);
 for(const change of [r=>r.status='pending',r=>r.gamesPerSetting=100000000,r=>r.settings[0].setting=2,r=>r.settings[0].rtpPct=null,r=>r.commit='old']){
  const r=report();change(r);assert.equal(c.verifiedNovaRtp(r),false);
 }
});
test('fetch refreshes ready data, coalesces requests and removes old values on pending or failure',async()=>{
 const c=harness();let resolve,calls=0;
 c.fetch=(url,options)=>{calls++;assert.match(url,/nova-rtp-current\.json$/);assert.equal(options.cache,'no-store');return new Promise(r=>resolve=r);};
 const p=c.loadNovaRtp();await c.loadNovaRtp();assert.equal(calls,1);
 resolve({ok:true,json:async()=>report()});await p;assert(c.novaRtpReport);assert.equal(c.novaRtpLoading,false);
 c.fetch=async()=>({ok:true,json:async()=>({...report(),status:'pending'})});await c.loadNovaRtp();assert.equal(c.novaRtpReport,null);
 c.novaRtpReport=report();c.fetch=async()=>{throw Error('offline');};await c.loadNovaRtp();assert.equal(c.novaRtpReport,null);
});
