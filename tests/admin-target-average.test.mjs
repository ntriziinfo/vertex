import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('admin.html','utf8');
test('debug average uses original NOVA targets without changing reference RTP or other stores',()=>{
 const c=vm.createContext({useTargetAverageRtp:true,novaRtpReport:{settings:[{setting:6,rtpPct:115.02}]}});
 for(const name of ['machineSettingValue','machineSettingRtp','machineAverageRtp'])vm.runInContext(source.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0],c);
 assert.deepEqual([1,2,3,4,5,6].map(assignedSetting=>c.machineAverageRtp({machineType:'nova',assignedSetting})),[95,97,99,103,111,116]);
 assert.equal(c.machineSettingRtp({machineType:'nova',assignedSetting:6}),115.02);
 assert.equal(c.machineAverageRtp({machineType:'jackspot',assignedSetting:6}),105);
 c.useTargetAverageRtp=false;assert.equal(c.machineAverageRtp({machineType:'nova',assignedSetting:6}),115.02);
});
