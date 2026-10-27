import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = file => fs.readFileSync(file,'utf8');
const script = file => source(file).match(/<script>([^]*?)<\/script>/)[1];
const machine = {
  machineId:'nova-03',displayName:'NOVA 3番台',machineType:'nova',currentSessionId:'new-player',
  stats:{totalSpins:73,profit:-219},slumpHistory:[{spin:73,profit:-219}],
  machineTotalStats:{totalSpins:12873,profit:5432,bigCount:30,atFirstCount:20},
  machineTotalSlumpHistory:[{spin:0,profit:0},{spin:900,profit:-2000},{spin:12000,profit:6000},{spin:12873,profit:5432}]
};
function ui(){
  const elements = new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{dataset:{},innerHTML:'',textContent:'',value:'',classList:{toggle(){}},setAttribute(){},querySelectorAll(){return [];}});
    return elements.get(id);
  };
  const c=vm.createContext({
    sessionStorage:{getItem:key=>key==='vertexAdminMachineView'?'player':null},
    document:{getElementById:element,querySelectorAll:()=>[],querySelector:()=>null},window:{devicePixelRatio:1},
  });
  vm.runInContext(source('slump-graph.js')+source('nova-data-counter.js')+source('machine-data.js'),c);
  return {c,element};
}
test('admin cards ignore a saved personal view and use cabinet totals for all values',()=>{
  const {c,element}=ui();
  vm.runInContext(script('admin.html').split("$('authForm').addEventListener")[0],c);
  c.input=machine;
  vm.runInContext('machines=[input]; renderMachines();',c);
  const html=element('machines').innerHTML;
  assert.match(html,/data-counter="total"/);assert.equal(c.totalViewForMachine(machine).stats.totalSpins,12873);assert.doesNotMatch(html,/class="graphStats"/);assert.match(html,/\+5,432 pt/);
  assert.match(html,/\+6,000 pt/);assert.match(html,/-2,000 pt/);
  assert.doesNotMatch(html,/>73 G<|-219|個人/);
  assert.equal(element('floorCurrentProfit').textContent,'+5,432 pt');
  assert.equal(c.totalViewForMachine({stats:machine.stats}).stats,null,'missing cabinet data must not fall back to personal data');
});
test('both customer renderers use cumulative games for counters and probabilities, never personal snapshots',()=>{
  for(const file of ['machines.html','nebula-machines.html']){
    const {c,element}=ui();c.input=machine;
    const s=script(file), boundary=file==='machines.html'?'let lastMachines =':"document.querySelectorAll('[data-filter]')";
    vm.runInContext(s.slice(0,s.indexOf(boundary)),c);
    vm.runInContext(file==='machines.html'?'render([input]);':'machines=[input]; fresh=true; render();',c);
    const html=element('grid').innerHTML;
    if(file==='machines.html'){assert.match(html,/総回転数/);assert.match(html,/12,873/);}else{assert.match(html,/data-counter="total"/);assert.doesNotMatch(html,/<dt>総回転数<\/dt>|<dt>差枚<\/dt>/);assert.match(html,/最高/);assert.match(html,/最低/);assert.match(html,/\+6,000 pt/);assert.match(html,/-2,000 pt/);}assert.match(html,/\+5,432/);
    assert.match(html,/1\/429\.1/);assert.match(html,/1\/643\.6/);
    assert.doesNotMatch(html,/-219|>73</);
  }
});
test('admin graph keeps the full cumulative span with pt ticks and a G axis across sparse history',()=>{
  const {c}=ui();
  vm.runInContext(script('admin.html').split("$('authForm').addEventListener")[0],c);
  const labels=[], lines=[];
  const ctx={save(){},restore(){},rect(){},clip(){},setTransform(){},measureText:text=>({width:text.length*6}),setLineDash(){},beginPath(){},stroke(){},fill(){},arc(){},
    fillText(text){labels.push(text);},moveTo(x,y){lines.push([x,y]);},lineTo(x,y){lines.push([x,y]);}};
  const attrs={};const canvas={dataset:{},closest:()=>null,getContext:()=>ctx,getBoundingClientRect:()=>({width:340,height:180}),setAttribute:(k,v)=>attrs[k]=v};
  // The former gap filter discarded the first two points in this history.
  c.drawSlump(canvas,[{spin:0,profit:0},{spin:100,profit:-2500},{spin:12000,profit:100},{spin:12050,profit:200},{spin:12100,profit:300},{spin:12150,profit:400}]);
  assert.deepEqual(labels.filter(text=>text.endsWith(' G')),['0 G','5,000 G','10,000 G']);assert.match(attrs['aria-label'],/右が最新/);assert.match(attrs['aria-label'],/総回転12,150G/);
  assert(labels.some(text=>text.startsWith('-')));assert(labels.some(text=>text.startsWith('+')));
  assert.match(attrs['aria-label'],/最小-2,500pt/);assert.match(attrs['aria-label'],/現在\+400pt/);
  assert(lines.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)));
});
test('ended history hides individual play statistics while keeping settlement status',async()=>{
  const {c,element}=ui();
  vm.runInContext(script('admin.html').split("$('authForm').addEventListener")[0],c);
  c.fetch=async()=>({ok:true,json:async()=>[{machineId:'nova-03',playerName:'検証利用者',endedAt:'2026-10-13T00:00:00Z',playerProfit:98765,playerSpins:54321,playerTotalFee:123456,playerTotalPaid:222221,sheets:{ok:true}}]});
  await c.loadResults();
  assert.match(element('results').innerHTML,/検証利用者/);assert.match(element('results').innerHTML,/Sheets/);
  assert.doesNotMatch(element('results').innerHTML,/98,765|54,321|123,456|222,221|利用差pt|投入|払出/);
});
test('chronological graph fits all points into a fixed card at 10k, 50k and 100k games',()=>{
 const {c}=ui(),paths=[];let current=[];const track={style:{}};
 const scroller={clientWidth:340,scrollLeft:0,get scrollWidth(){return parseFloat(track.style.width)||340;},addEventListener(type,fn){this.onScroll=fn;}};
 const ctx={save(){},restore(){},rect(){},clip(){},setTransform(){},measureText:t=>({width:t.length*6}),setLineDash(){},beginPath(){current=[];},stroke(){paths.push(current);},fill(){},arc(){},fillText(){},moveTo(x){current.push(x);},lineTo(x){current.push(x);}};
 const canvas={dataset:{id:'scroll-check'},style:{},parentElement:track,closest:()=>scroller,getContext:()=>ctx,getBoundingClientRect:()=>({width:340,height:180}),setAttribute(){}};
 for(const end of [10000,50000,100000]){
   paths.length=0;scroller.scrollLeft=250;
   c.VertexSlumpGraph.draw(canvas,[{spin:0,profit:0},{spin:end/2,profit:200},{spin:end,profit:5432}]);
   assert.equal(scroller.scrollLeft,0);assert.equal(track.style.width,'100%');assert.equal(canvas.style.width,'100%');assert.equal(canvas.width,340);
   const line=paths.find(p=>p.length===3);assert(line[0]<line[1]&&line[1]<line[2]);assert(line.every(x=>x>=0&&x<=340));
 }
});
