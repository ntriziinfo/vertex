import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../play.html',import.meta.url),'utf8');
const fn=name=>source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0];
function setup(fetch){
 const elements=new Map(),timers=new Map();let next=0;
 const context=vm.createContext({active:{sessionId:'session-one',token:'token-one',machineId:'one'},slotOrigin:'https://game.invalid',
  sessionWatchTimer:null,sessionWatchInFlight:false,sessionWatchRequested:false,endingSession:false,AbortSignal,fetch,
  $:id=>{if(!elements.has(id))elements.set(id,{hidden:id==='ended',src:id==='slot'?'https://game.invalid/play':'',textContent:''});return elements.get(id);},
  clearSlotLocalState(){},setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}});
 for(const name of ['closeEndedSession','checkSessionStatus','wakeSessionWatch'])vm.runInContext(fn(name),context);
 return {c:context,timers};
}
test('revoked session unloads running iframe without submitting a second settlement',async()=>{
 const calls=[];const {c,timers}=setup(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>({ok:true,active:false})};});
 await c.checkSessionStatus();
 assert.deepEqual(calls,[{url:'/api/sessions/status',body:{sessionId:'session-one',token:'token-one'}}]);
 assert.equal(c.active,null);assert.equal(c.$('slot').src,'about:blank');assert.equal(c.$('play').hidden,true);assert.equal(c.$('ended').hidden,false);
 assert.match(c.$('endSummary').textContent,/終了・リセット/);assert.equal(timers.size,0);
 await c.checkSessionStatus();assert.equal(calls.length,1);
});
test('active session continues, authentication rejection closes, network error does not falsely end',async()=>{
 for(const outcome of ['active','forbidden','offline','server-error']){
  const {c,timers}=setup(async()=>{if(outcome==='offline')throw Error('offline');return {ok:outcome==='active',status:outcome==='forbidden'?403:outcome==='server-error'?500:200,json:async()=>({ok:true,active:true})};});
  await c.checkSessionStatus();
  assert.equal(c.active===null,outcome==='forbidden');
  if(outcome!=='forbidden')assert.equal([...timers.values()][0].delay,3000);
 }
});
test('waking coalesces pending checks and stale responses do not terminate a new session',async()=>{
 let resolve,calls=0;const {c,timers}=setup(()=>{calls++;return new Promise(r=>resolve=r);});
 const pending=c.checkSessionStatus();c.wakeSessionWatch();c.wakeSessionWatch();
 assert.equal(calls,1);assert.equal(timers.size,0);
 c.active={sessionId:'new',token:'new'};
 resolve({ok:true,status:200,json:async()=>({ok:true,active:false})});await pending;
 assert.equal(c.active.sessionId,'new');assert.equal([...timers.values()][0].delay,0);
});
test('customer end in progress is not interrupted by a late watchdog response',async()=>{
 let resolve;const {c,timers}=setup(()=>new Promise(r=>resolve=r));
 const pending=c.checkSessionStatus();c.endingSession=true;
 resolve({ok:true,status:200,json:async()=>({ok:true,active:false})});await pending;
 assert.notEqual(c.active,null);assert.equal(timers.size,0);
});
test('occupied NEBULA card links to password entry while unavailable data stays disabled',()=>{
 const html=fs.readFileSync(new URL('../nebula-machines.html',import.meta.url),'utf8'),elements=new Map();
 const c=vm.createContext({machines:[{machineId:'nova-01',displayName:'NOVA 1番台',locked:true}],fresh:true,filter:'all',num:Number,fmt:String,signed:String,esc:String,atFirstRate:()=>'-',NovaStoreData:{markup:()=>''},graphs(){},$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}});
 vm.runInContext(html.match(/function render\([^]*?\n}/)[0],c);c.render();
 assert.match(c.$('grid').innerHTML,/<a class="play busy" href="\/play.html\?machine=nova-01"/);
 assert.match(c.$('grid').innerHTML,/ただいま利用中・再入場/);assert.doesNotMatch(c.$('grid').innerHTML,/aria-disabled/);
 c.fresh=false;c.render();assert.match(c.$('grid').innerHTML,/aria-disabled="true"/);assert.doesNotMatch(c.$('grid').innerHTML,/<a /);
});
test('customer inline scripts remain valid JavaScript',()=>{
 for(const file of ['play.html','machines.html','nebula-machines.html','admin.html']){
  const html=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  for(const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script,{filename:file});
 }
});
