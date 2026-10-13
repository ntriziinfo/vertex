import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeScreen} from '../monitor-screen.cjs';
import {monitorRequest} from '../monitor-api.mjs';
const origin='https://nova-eta-jet-30.vercel.app';
const frame={v:1,width:960,height:1610,body:{'data-game-phase':'art'},vars:{'--layout-lamps-x':'12px'},root:{key:'1',tag:'section',attrs:{id:'machine'},children:[]}};
const definition={machineType:'nova',gameUrl:origin+'/jag.html',displayName:'NOVA 1番台'};
function setup(){
  const calls=[],machine={locked:true,current_session_id:'session-a',monitor_requested_until_ms:0};let latest;
  const options={req:{method:'GET',query:{}},body:{},id:'nebula-nova-01',action:'',definition,now:100000,
    authenticate:async()=>({session:{session_id:'session-a'}}),
    db:async(path,opt={})=>{calls.push({path,...opt});if(path.startsWith('machine_states'))return [machine];
      if(opt.method==='POST'){latest=JSON.parse(opt.body);return [];}
      return latest&&path.includes('session_id=eq.'+latest.session_id)?[latest]:[];}};
  return {options,calls,machine,setLatest:value=>latest=value};
}
test('visual format strips scripts, private panels, event handlers and off-origin assets',()=>{
  const input=structuredClone(frame);input.root.children=[
    {tag:'script',children:['alert(1)']},{tag:'div',attrs:{id:'debug-settings'},children:['setting 6']},
    {tag:'img',attrs:{src:origin+'/assets/ui/test.png',onerror:'alert(1)',formaction:'https://evil.invalid'}},
    {tag:'img',attrs:{src:'https://evil.invalid/spy.png'}},
    {tag:'div',attrs:{style:'background:url(https://evil.invalid/spy);color:red','data-token':'secret'}}
  ];input.body={'data-session':'secret',class:'debugMode game'};
  const output=JSON.stringify(sanitizeScreen(input,origin));
  for(const forbidden of ['script','alert','setting 6','onerror','formaction','evil.invalid','secret','debugMode'])assert.ok(!output.includes(forbidden),forbidden);
  assert.ok(output.includes(origin+'/assets/ui/test.png'));
  assert.ok(output.includes('color:red'));
  assert.throws(()=>sanitizeScreen({...frame,root:{tag:'iframe'}},origin));
  assert.throws(()=>sanitizeScreen({...frame,padding:'x'.repeat(210001)},origin));
});
test('watch lease is bound to active session and does not change gameplay columns',async()=>{
  const {options,calls}=setup();const out=await monitorRequest({...options,req:{method:'POST'},action:'watch'});
  assert.equal(out.data.status,'waiting');const write=calls.find(c=>c.method==='PATCH');
  assert.match(write.path,/current_session_id=eq.session-a&locked=eq.true/);
  assert.deepEqual(JSON.parse(write.body),{monitor_requested_until_ms:145000});
  assert.ok(!JSON.stringify(out.data).includes('session-a'));
});
test('public feed never returns a previous session frame; idle and stale feeds are cleared',async()=>{
  const {options,machine,setLatest}=setup();
  setLatest({session_id:'old',updated_at_ms:99999,screen:frame});assert.equal((await monitorRequest(options)).data.status,'waiting');
  setLatest({session_id:'session-a',updated_at_ms:99999,screen:frame});let out=await monitorRequest(options);assert.deepEqual(out.data.screen,frame);
  assert.ok(!JSON.stringify(out.data).includes('session-a'));
  out=await monitorRequest({...options,req:{method:'GET',query:{since:99999}}});assert.ok(!out.data.screen);
  assert.equal((await monitorRequest({...options,now:120000})).data.status,'waiting');
  machine.locked=false;out=await monitorRequest(options);assert.equal(out.data.status,'idle');assert.ok(!out.data.screen);
});
test('publishing requires authentication and replaces one bounded frame instead of accumulating history',async()=>{
  const {options,calls}=setup();
  await assert.rejects(monitorRequest({...options,req:{method:'POST'},action:'frame',body:{screen:frame},authenticate:async()=>{throw Error('unauthorized');}}));
  assert.equal(calls.length,0);
  const out=await monitorRequest({...options,req:{method:'POST'},action:'frame',body:{screen:frame}});
  assert.equal(out.status,200);assert.equal(calls.length,1);assert.match(calls[0].path,/on_conflict=machine_id/);
  const row=JSON.parse(calls[0].body);assert.equal(row.session_id,'session-a');assert.deepEqual(row.screen.root,frame.root);
});
