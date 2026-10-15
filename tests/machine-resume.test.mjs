import test from 'node:test';
import assert from 'node:assert/strict';
import resume from '../machine-resume.cjs';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

test('local controller creates the same session-scoped handoff entry as the cloud controller',()=>{
 const source=fs.readFileSync('server.js','utf8'),c=vm.createContext({URL,STORE_ID:'qa-store'});
 vm.runInContext(source.match(/function machineGameUrl\([^]*?\n}/)[0],c);
 const url=new URL(c.machineGameUrl({machineId:'nova-01',machineType:'nova',gameUrl:'https://game.invalid/jag.html'},'https://control.invalid','session-qa',{totalSpins:1000,dataHits:Array.from({length:10000},(_,i)=>({seq:i+1,kind:'BIG',games:800}))}));
 assert.equal(url.searchParams.get('resumeFromStore'),'1');assert.equal(url.searchParams.get('playSessionId'),'session-qa');
 assert.equal(url.searchParams.get('server'),'https://control.invalid');assert.equal(JSON.parse(url.searchParams.get('machineDisplay')).totalSpins,1000);
 assert.equal(JSON.parse(url.searchParams.get('machineDisplay')).dataHits.length,0);assert(url.toString().length<1000);
});

test('real gateway hands off saved BIG and unfinished reels across players without resetting machine totals',()=>{
 const result=spawnSync(process.execPath,['tests/fixtures/password-lifecycle.mjs'],{encoding:'utf8',timeout:30000,env:{...process.env,QA_RESUME_ASSERT:'1',ADMIN_PASSWORD:'qa',SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-key',GOOGLE_SHEETS_WEBHOOK_URL:'',VERTEX_ALLOWED_ORIGINS:'',VERTEX_STORE_ID:'store-jag-one',VERTEX_DB_SCHEMA:'public',VERTEX_MACHINES_JSON:JSON.stringify(['one','two'].map(machineId=>({machineId,machineType:'nova',gameUrl:'https://game.invalid'})))}});
 assert.equal(result.status,0,result.stdout+result.stderr);
});

test('new player gets cabinet state without previous credentials; returning player retains settlement baseline',()=>{
 const saved={playSessionId:'old',token:'secret',playerName:'private',capturedAt:1234,
  settings:{setting:5},resumeSettings:{setting:5,mathVersion:148},stats:{totalSpins:2000,totalPaid:3456},
  normalState:{sinceBonus:50,flow:{phase:'art',remaining:800,stock:2}},machineDisplayStats:{sinceBonus:70},
  runtimeState:{session:{active:true,phase:'a_type_bonus',paid:32},pendingSpin:{version:1,result:'NEBULA',stopped:[false,false,true]}},
  completeTrialState:{peak:1000,trough:-3000},playSessionStartStats:{totalSpins:1000,totalPaid:100}};
 const machine={machineType:'nova',assignedSetting:5,lastSnapshot:saved};
 const next=resume.forSession(machine,{sessionId:'new',startSnapshot:saved});
 assert.equal(next.baseline,null);assert.equal(next.state.stats.totalPaid,3456);
 assert.deepEqual(next.state.runtimeState,saved.runtimeState);assert.equal(next.state.settings.mathVersion,148);
 assert.equal(next.state.displaySinceBonusOffset,20);assert.equal(next.state.savedAt,1234);
 assert.doesNotMatch(JSON.stringify(next),/secret|private|"old"/);
 assert.deepEqual(resume.forSession(machine,{sessionId:'old'}).baseline,saved.playSessionStartStats);
 assert.equal(resume.forSession({machineType:'jackspot'},{}),null);
 assert.equal(resume.forSession({...machine,lastSnapshot:{stats:null}},{sessionId:'new',startSnapshot:{stats:null}}).state,null);
});
