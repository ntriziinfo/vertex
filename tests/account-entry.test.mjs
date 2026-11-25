import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../play.html',import.meta.url),'utf8');
function setup(fetch,customerLogin=true){
  const elements=new Map();
  const context=vm.createContext({
    fetch,customerLogin,brandingReady:false,active:null,entryMachineId:'nova-01',machineNames:new Map(),
    document:{title:''},AbortSignal,
    $:id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'',addEventListener(){},disabled:id==='startBtn'});return elements.get(id);},
  });
  vm.runInContext(source.slice(source.indexOf('let startPending=false;'),source.indexOf('async function loadBranding(){')),context);
  for(const name of ['machineName','loadBranding']){
    const code=name==='machineName'?source.match(/function machineName[^\n]*/)[0]
      :source.match(/async function loadBranding\([^]*?\n}/)[0];
    vm.runInContext(code,context);
  }
  return context;
}
const config={storeId:'store-debug',storeName:'NOVA',customerLoginEnabled:true};
const rows=[{machineId:'nova-01',displayName:'Nova 1番台'}];
function response(data,ok=true){return {ok,json:async()=>data};}

test('account entry is complete before JavaScript or API replies',()=>{
  const markup=source.split('<script>')[0];
  assert.equal((markup.match(/id="userId"/g)||[]).length,1);
  assert.match(markup,/id="password" type="password" maxlength="128" autocomplete="current-password"/);
  assert.doesNotMatch(markup,/one-time-code|管理画面で発行された/);
});

test('slow branding never changes the form and requires a rate selection after both replies',async()=>{
  let configReady,machinesReady;
  const context=setup(url=>new Promise(resolve=>{if(url==='/api/config')configReady=resolve;else machinesReady=resolve;}));
  const pending=context.loadBranding();
  assert.equal(context.brandingReady,false);assert.equal(context.$('startBtn').disabled,true);
  configReady(response(config));await Promise.resolve();
  assert.equal(context.$('startBtn').disabled,true);
  machinesReady(response(rows));await pending;
  assert.equal(context.brandingReady,true);assert.equal(context.$('startBtn').disabled,true);
  assert.equal(context.$('pointRate').value,'');
  context.$('pointRate').value='500';context.updateStartAvailability();
  assert.equal(context.$('startBtn').disabled,false);
  context.$('pointRate').value='';context.updateStartAvailability();
  assert.equal(context.$('startBtn').disabled,true);
  assert.equal(context.customerLogin,true);assert.equal(context.$('entryMachineTitle').textContent,'Nova 1番台');
});

test('failed, disabled or mismatched account configuration never falls back to seat passwords',async()=>{
  for(const mode of ['network','config-error','machines-error','bad-machines','disabled','wrong-store']){
    const context=setup(async url=>{
      if(mode==='network')throw Error('offline');
      if(url==='/api/config')return response({...config,
        ...(mode==='disabled'?{customerLoginEnabled:false}:{}),
        ...(mode==='wrong-store'?{storeId:'store-las-vegas'}:{}),
      },mode!=='config-error');
      return response(mode==='bad-machines'?{}:rows,mode!=='machines-error');
    });
    await context.loadBranding();
    assert.equal(context.customerLogin,true,mode);
    assert.equal(context.brandingReady,false,mode);
    assert.equal(context.$('startBtn').disabled,true,mode);
    assert.match(context.$('error').textContent,/再読み込み/,mode);
    assert.match(context.$('entryHelp').textContent,/ユーザーID/,mode);
  }
});

test('locked cabinet keeps its fixed rate and allows entry',async()=>{
 const context=setup(async url=>response(url==='/api/config'?config:[{...rows[0],pointRate:1000,pointRateLocked:true}]));
 await context.loadBranding();
 assert.equal(context.$('pointRate').value,'1000');
 assert.equal(context.$('pointRate').disabled,true);
 assert.equal(context.$('startBtn').disabled,false);
});
