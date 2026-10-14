/* Past to present, left to right, at a fixed 1,000 G scale. Rasterize only the viewport. */
globalThis.VertexSlumpGraph=(()=>{
  const positions=new Map(), step=1000, pixels=96;
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmt=v=>num(v).toLocaleString('ja-JP'),signed=v=>(v>=0?'+':'')+fmt(v);
  function draw(canvas,history){
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const scroller=canvas.closest('.graph-scroll'),track=canvas.parentElement;
    const w=scroller?.clientWidth||canvas.getBoundingClientRect().width,h=canvas.getBoundingClientRect().height;
    if(!w||!h)return;
    const points=(history?.length?history:[{spin:0,profit:0}]).map(p=>({spin:Math.max(0,num(p.spin)),profit:num(p.profit)}));
    let min=0,max=0,end=1000;for(const p of points){min=Math.min(min,p.profit);max=Math.max(max,p.profit);end=Math.max(end,Math.ceil(p.spin/step)*step);}
    const rough=Math.max(50,(max-min)/4),magnitude=10**Math.floor(Math.log10(rough));
    const yStep=([1,2,5,10].find(v=>v*magnitude>=rough)||10)*magnitude;
    const lower=min===max?-100:Math.floor(min/yStep)*yStep,upper=min===max?100:Math.ceil(max/yStep)*yStep;
    const ticks=[];for(let v=lower;v<=upper;v+=min===max?50:yStep)ticks.push(v);
    const font='11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';ctx.font=font;
    const label=v=>v===0?'0':signed(v),left=Math.ceil(Math.max(...ticks.map(v=>ctx.measureText(label(v)).width)))+17,right=42,top=14,bottom=h-24;
    const latest=points.at(-1).spin,contentWidth=Math.max(w,left+end/step*pixels+right),key=canvas.dataset.machine||canvas.dataset.id||'';
    const maxOffset=Math.max(0,contentWidth-w);
    let offset=maxOffset;
    if(scroller){
      canvas.style.width=w+'px';track.style.width=contentWidth+'px';
      const old=positions.get(key);
      scroller.scrollLeft=old&&!old.latest?Math.min(old.offset,maxOffset):maxOffset;
      if(!canvas._graphScroll){
        canvas._graphScroll=()=>{const offset=scroller.scrollLeft;positions.set(key,{offset,latest:scroller.scrollWidth-scroller.clientWidth-offset<=2});draw(canvas,canvas._graphHistory);};
        scroller.addEventListener('scroll',canvas._graphScroll,{passive:true});
      }
      offset=scroller.scrollLeft;
    }
    canvas._graphHistory=points;
    const dpr=Math.min(globalThis.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.font=font;ctx.lineWidth=1;const x=spin=>left+spin/step*pixels-offset,y=v=>bottom-(v-lower)/(upper-lower)*(bottom-top);
    ctx.textAlign='right';ctx.textBaseline='middle';
    for(const v of ticks){ctx.setLineDash(v===0?[3,4]:[]);ctx.strokeStyle=v===0?'#80758f':'#302b40';ctx.beginPath();ctx.moveTo(left,y(v));ctx.lineTo(w-right,y(v));ctx.stroke();ctx.fillStyle=v===0?'#e3dcef':'#bcb3cd';ctx.fillText(label(v),left-8,y(v));}
    ctx.setLineDash([]);ctx.save();ctx.beginPath();ctx.rect(left,top,w-left-right,bottom-top);ctx.clip();
    const first=Math.max(0,Math.ceil(offset/pixels));
    ctx.strokeStyle='#302b40';for(let i=first;x(i*step)<=w-right;i++){ctx.beginPath();ctx.moveTo(x(i*step),top);ctx.lineTo(x(i*step),bottom);ctx.stroke();}
    ctx.strokeStyle=points.at(-1).profit>=0?'#89edc5':'#ff9baa';ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(x(p.spin),y(p.profit)):ctx.moveTo(x(p.spin),y(p.profit)));ctx.stroke();
    ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.arc(x(points.at(-1).spin),y(points.at(-1).profit),3,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.fillStyle='#9e95b0';ctx.textAlign='center';ctx.textBaseline='bottom';
    for(let i=first;x(i*step)<=w-right;i++)ctx.fillText(fmt(i*step)+' G',x(i*step),h-3);
    canvas.setAttribute('aria-label',`差枚グラフ。左が過去、右が最新、横軸1,000G刻み、総回転${fmt(latest)}G。最小${fmt(min)}pt、最大${fmt(max)}pt、現在${signed(points.at(-1).profit)}pt。左右にスクロールできます`);
  }
  return {draw};
})();
