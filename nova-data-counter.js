/* Full hit history with bounded page rendering. No lottery RNG or game-state changes. */
globalThis.NovaDataCounter=(()=>{
  const limit=20, keys=['dataNormalGames','dataAtGames','dataHitSeq'];
  const pages=new WeakMap(),machinePages=new Map();
  const n=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
  const names={sosuke:'宗介',toto:'とと',urapi:'うらぴ',giru:'ギル',sora:'空',ouma:'逢魔'};
  function snapshot(stats){return Object.fromEntries(keys.map(key=>[key,n(stats?.[key])]));}
  function init(stats){if(stats.dataLastHitSpin==null)stats.dataLastHitSpin=n(stats.totalSpins);}
  const zoneId=flow=>flow?.phase==='art'&&names[flow.zone]?(flow.ura?'ura_':'')+flow.zone:'';
  const phase=flow=>flow?.phase==='art'?'art':'normal';
  function alignPhase(stats,flow){
    const next=phase(flow);
    if(!stats.dataInterval||stats.dataInterval.phase!==next)stats.dataInterval={phase:next,games:0};
  }
  function adopt(stats,flow,normalGames=0){
    init(stats);if(stats.dataActiveZone==null)stats.dataActiveZone=zoneId(flow);
    if(!stats.dataInterval){
      const elapsed=Math.max(0,n(stats.totalSpins)-n(stats.dataLastHitSpin));
      stats.dataInterval={phase:phase(flow),games:phase(flow)==='art'?elapsed:Math.min(elapsed,n(normalGames))};
    }
    alignPhase(stats,flow);
  }
  function spin(stats,flow){
    init(stats);
    alignPhase(stats,flow);
    stats.dataInterval.games=n(stats.dataInterval.games)+1;
    const key=flow?.phase==='art'?'dataAtGames':'dataNormalGames';
    stats[key]=n(stats[key])+1;
  }
  function hit(stats,kind,zone=''){
    init(stats);
    const spin=n(stats.totalSpins),seq=n(stats.dataHitSeq)+1;
    const interval=stats.dataInterval;
    (stats.dataHits??=[]).push({seq,spin,kind,zone,games:interval?n(interval.games):Math.max(0,spin-n(stats.dataLastHitSpin)),...(interval?{phase:interval.phase}:{})});
    if(interval)interval.games=0;
    stats.dataHitSeq=seq;stats.dataLastHitSpin=spin;
  }
  function zone(stats,flow){
    alignPhase(stats,flow);
    const id=zoneId(flow);
    if(id&&id!==stats.dataActiveZone)hit(stats,'ZONE',id);
    stats.dataActiveZone=id;
  }
  function title(hit){
    if(hit.kind==='CURRENT')return '現在';
    if(hit.kind!=='ZONE')return hit.kind;
    return (hit.zone.startsWith('ura_')?'裏':'')+(names[hit.zone.replace(/^ura_/,'')]||'特化')+'ゾーン';
  }
  function display(stats,base,start){
    const total=n(base?.totalSpins)+Math.max(0,n(stats.totalSpins)-n(base?start?.totalSpins:0));
    const output={total};
    for(const key of keys)output[key]=n(base?.[key])+Math.max(0,n(stats[key])-n(base?start?.[key]:0));
    const hits=(base?.dataHits||[]).map(h=>({...h}));
    for(const hit of (stats.dataHits||[]).filter(h=>!base||h.seq>n(start?.dataHitSeq))){
      const spin=n(base?.totalSpins)+Math.max(0,n(hit.spin)-n(base?start?.totalSpins:0));
      hits.push({...hit,spin,games:hit.phase?n(hit.games):hits.length?Math.max(0,spin-hits.at(-1).spin):n(hit.games)});
    }
    output.hits=hits;
    output.current=stats.dataInterval?n(stats.dataInterval.games):hits.length?Math.max(0,total-hits.at(-1).spin):Math.max(0,n(stats.totalSpins)-n(stats.dataLastHitSpin??stats.totalSpins));
    output.currentPhase=stats.dataInterval?.phase||'normal';
    return output;
  }
  function graph(stats,base,start){
    if(!base)return stats.slumpHistory||[{spin:0,profit:0}];
    const history=(base.slumpHistory||[{spin:0,profit:0},{spin:n(base.totalSpins),profit:Number(base.profit)||0}]).map(p=>({...p}));
    for(const point of stats.slumpHistory||[]){
      if(n(point.spin)<n(start?.totalSpins))continue;
      const next={spin:n(base.totalSpins)+n(point.spin)-n(start?.totalSpins),profit:(Number(base.profit)||0)+(Number(point.profit)||0)-(Number(start?.profit)||0)};
      if(history.at(-1)?.spin===next.spin)history[history.length-1]=next;else history.push(next);
    }
    return history;
  }
  function render(root,view,totals){
    if(!root)return;
    const format=value=>n(value).toLocaleString('ja-JP');
    const set=(name,value)=>{const el=root.querySelector('[data-counter="'+name+'"]');if(el)el.textContent=value;};
    set('current',view.current==null?'—':format(view.current));set('total',format(totals.totalSpins));
    set('current-label',view.currentPhase==='art'?'AT中回転数':'現在回転数');
    set('big',format(totals.bigCount));set('at',totals.atFirstCountPartial?'—':format(totals.atFirstCount));
    set('normal',format(view.dataNormalGames));set('art',format(view.dataAtGames));
    const recorded=n(view.dataNormalGames)+n(view.dataAtGames);
    set('coverage',recorded<n(totals.totalSpins)?'通常・AT内訳は記録開始後の'+format(recorded)+'G分':'');
    const bars=root.querySelector('.novaHitBars');if(!bars)return;
    const machineId=root.dataset?.machineCounter;
    let page=machineId?machinePages.get(machineId):pages.get(root);
    if(!page){page={anchor:null};if(machineId)machinePages.set(machineId,page);else pages.set(root,page);}
    const hits=view.hits||[],count=hits.length;
    const anchorIndex=page.anchor==null?-1:hits.findIndex(h=>h.seq===page.anchor);
    if(page.anchor!=null&&anchorIndex<0)page.anchor=null;
    const end=page.anchor==null?count:anchorIndex+1,begin=Math.max(0,end-limit),latest=page.anchor==null;
    const move=(action,disabled,handler)=>{const button=root.querySelector('[data-hit-page="'+action+'"]');if(button){button.disabled=disabled;button.onclick=()=>{handler();render(root,view,totals);};}};
    const at=index=>{page.anchor=hits[index-1]?.seq??null;};
    move('latest',latest,()=>{page.anchor=null;});
    move('newer',latest,()=>{if(end+limit>=count)page.anchor=null;else at(end+limit);});
    move('older',begin===0,()=>at(begin));
    move('oldest',begin===0,()=>at(Math.min(limit,count)));
    set('page',count?`${begin+1}–${end} / ${format(count)}件`:'履歴なし');
    const columns=[...(latest?[{kind:'CURRENT',games:view.current}]:[]),...hits.slice(begin,end).reverse()],fingerprint=JSON.stringify(columns);
    if(bars.dataset.values===fingerprint)return;
    bars.dataset.values=fingerprint;
    const nodes=columns.map((hit,i)=>{
      const column=document.createElement('button');column.type='button';column.className='novaHitColumn';column.dataset.kind=hit.kind;
      const label=title(hit)+' / '+format(hit.games)+'G';column.title=label;column.setAttribute('aria-label',label);
      const cells=document.createElement('span');cells.className='novaHitCells';
      // A 0G hit still occupies one visual step; never change the recorded games.
      const steps=hit.kind==='CURRENT'?Math.ceil(n(hit.games)/100):Math.max(1,Math.ceil(n(hit.games)/100));
      for(let tick=8;tick>=1;tick--){const cell=document.createElement('i');cell.className=steps>=tick?'lit':'';cells.append(cell);}
      const mark=document.createElement('span');mark.className='novaHitMark';mark.textContent=hit.games>800?'+':hit.kind==='CURRENT'?'今':hit.kind==='ZONE'?'特':hit.kind==='BIG'?'B':'AT';
      column.append(cells,mark);column.addEventListener('click',()=>set('detail',label));return column;
    });
    bars.replaceChildren(...nodes);bars.scrollLeft=0;
    set('detail','左が新しい履歴 / 列を押すとG数・ゾーン名を表示');
  }
  return Object.freeze({limit,keys,snapshot,adopt,spin,hit,zone,transition:alignPhase,display,graph,render});
})();
