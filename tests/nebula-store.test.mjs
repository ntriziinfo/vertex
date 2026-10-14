import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('Nebula loads twelve NOVA machines with IDs separate from the existing store',()=>{
  const probe=spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(require("./machine-config.cjs")))'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',
    env:{...process.env,VERTEX_STORE_ID:'store-nebula',VERTEX_MACHINES_JSON:'',VERTEX_STORE_NAME:'NEBULA'}
  });
  assert.equal(probe.status,0,probe.stderr);
  const config=JSON.parse(probe.stdout), machines=config.MACHINE_DEFINITIONS;
  assert.equal(config.CONFIG_SOURCE,'file:store-configs/store-nebula.machines.json');
  assert.equal(machines.length,12);
  const oldIds=new Set(JSON.parse(fs.readFileSync(new URL('../store-configs/store-debug.machines.json',import.meta.url),'utf8')).machines.map(m=>m.machineId));
  machines.forEach((m,i)=>{
    assert.equal(m.machineId,`nebula-nova-${String(i+1).padStart(2,'0')}`);
    assert.equal(m.machineType,'nova');
    assert.equal(m.gameUrl,'https://nova-eta-jet-30.vercel.app/jag.html');
    assert.equal(m.capabilities.jackpot,false);
    assert.ok(!oldIds.has(m.machineId));
  });
});

test('store-specific builds use Nebula customer entry without changing existing stores',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nebula-build-'));
  try{
    fs.mkdirSync(path.join(temp,'scripts'));
    const files=['index.html','admin.html','machines.html','play.html','monitor.html','nebula-machines.html','slump-graph.js','scripts/build-static.mjs'];
    for(const file of files)fs.copyFileSync(new URL('../'+file,import.meta.url),path.join(temp,file));
    for(const [store,theme] of [['store-nebula',''],['store-jag-one',''],['store-debug','nebula']]){
      const built=spawnSync(process.execPath,['scripts/build-static.mjs'],{cwd:temp,encoding:'utf8',env:{...process.env,VERTEX_STORE_ID:store,VERTEX_CUSTOMER_THEME:theme}});
      assert.equal(built.status,0,built.stderr);
      const read=file=>fs.readFileSync(path.join(temp,'dist',file),'utf8');
      if(store==='store-nebula'||theme==='nebula'){
        assert.equal(read('machines.html'),fs.readFileSync(path.join(temp,'nebula-machines.html'),'utf8'));
        assert.match(read('index.html'),/url=\/machines.html/);
        assert.match(read('play.html'),/<title>NEBULA/);
        assert.match(read('play.html'),/台選びに戻る/);
        if(store==='store-debug')assert.match(read('admin.html'),/url=https:\/\/vertex-debug.vercel.app\/admin.html/);
      }else{
        for(const file of files.slice(0,4))assert.equal(read(file),fs.readFileSync(path.join(temp,file),'utf8'));
      }
    }
  }finally{
    // mkdtemp returns an absolute, private child of the known system temp path.
    assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('nebula-build-'));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
