/* Floor pages use the cabinet renderer and only server-aggregated machine statistics. */
globalThis.NovaStoreData=(()=>{
  let graphView='line';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function markup(machine,{showRates=false}={}){
    if(machine.machineType!=='nova')return '';
    const stats=machine.machineTotalStats||{};
    const rate=(hits,partial=false)=>!partial&&stats.totalSpins>0&&hits>0?'1/'+(stats.totalSpins/hits).toFixed(1):'—';
    return `<section class="novaStoreData${showRates?' withRates':''}" data-machine-counter="${esc(machine.machineId)}" aria-label="筐体の遊技データ">
      <div class="novaDataHead">
        <div class="novaDataNumber"><span data-counter="current-label">現在回転数</span><b data-counter="current">—</b></div>
        <div class="novaDataNumber"><span>総ゲーム数</span><b data-counter="total">—</b></div>
        <div class="novaDataHits"><div><span>BIG</span><b data-counter="big">—</b>${showRates?`<small class="novaHitRate" aria-label="BIG確率">${rate(stats.bigCount)}</small>`:""}</div><div><span>AT</span><b data-counter="at">—</b>${showRates?`<small class="novaHitRate" aria-label="AT初当たり確率">${rate(stats.atFirstCount,stats.atFirstCountPartial)}</small>`:""}</div></div>
      </div>
      <div class="novaGameSplit"><span>通常 <b data-counter="normal">—</b> G</span><span>AT中 <b data-counter="art">—</b> G</span></div>
      <div class="novaStoreHitPanel" hidden>
      <div class="novaHitLegend"><span class="big">■ BIG</span><span class="art">■ AT・特化</span><span class="challenge">■ スーパーノヴァチャレンジ</span><span>1目盛り100G</span></div>
      <div class="novaHitChart"><div class="novaHitScale"><span>800</span><span>400</span><span>0</span></div><div class="novaHitBars" aria-label="当たり履歴"></div></div>
      <nav class="novaHitPager" aria-label="当たり履歴のページ"><button type="button" data-hit-page="latest">最新</button><button type="button" data-hit-page="newer">新しい</button><span data-counter="page"></span><button type="button" data-hit-page="older">古い</button><button type="button" data-hit-page="oldest">最初</button></nav>
      <div class="novaCounterNote" data-counter="detail">台累計データを確認中</div>
      </div>
      <div class="novaCounterNote" data-counter="coverage"></div>
      <details class="novaCounterNote"><summary>集計について</summary>AT回数は初当たりのみ。通常G数はCZ・準備、AT中G数は特化・引き戻しを含みます。BIG消化中・0G連は総ゲーム数に含めません。AT終了後の現在回転数は0Gから数え直します。記録のない過去の履歴は補完しません。</details>
    </section>`;
  }
  function applyGraphView(root,machine,redraw){
    const card=root.closest?.('.machine');if(!card)return;
    const line=card.querySelector('.adminGraphWrap,.graph-wrap'),hits=root.querySelector('.novaStoreHitPanel');
    if(!line||!hits)return;
    hits.hidden=graphView!=='hits';line.hidden=graphView!=='line';
    // A hidden canvas has no dimensions; redraw after it becomes visible.
    const canvas=line.querySelector('canvas');
    if(redraw&&!line.hidden&&canvas)VertexSlumpGraph.draw(canvas,machine.machineTotalSlumpHistory||machine.machineTotalStats?.slumpHistory);
  }
  function renderAll(machines,redraw=false){
    document.querySelectorAll('.novaGraphSwitch').forEach(group=>{group.hidden=!machines.some(m=>m.machineType==='nova');});
    document.querySelectorAll('[data-nova-graph-view]').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.novaGraphView===graphView));
      button.onclick=()=>{graphView=button.dataset.novaGraphView;renderAll(machines,true);};
    });
    const byId=new Map(machines.map(m=>[String(m.machineId),m]));
    document.querySelectorAll('[data-machine-counter]').forEach(root=>{
      const machine=byId.get(root.dataset.machineCounter);if(!machine)return;
      applyGraphView(root,machine,redraw);
      const stats=machine.machineTotalStats;
      if(!stats)return;
      const view=NovaDataCounter.display(stats);
      // Older snapshots cannot reconstruct the phase interval from total games.
      if(!stats.dataInterval&&stats.totalSpins>0)view.current=null;
      NovaDataCounter.render(root,view,stats);
    });
  }
  function setGraphView(view,machines){
    if(!['line','hits'].includes(view))return;
    graphView=view;renderAll(machines);
  }
  return {markup,renderAll,setGraphView};
})();
