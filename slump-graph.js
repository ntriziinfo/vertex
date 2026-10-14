/* Fit the entire history into the card, past to present from left to right. */
globalThis.VertexSlumpGraph=(()=>{
  const step=1000;
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
    const latest=points.at(-1).spin,plotWidth=Math.max(1,w-left-right);
    if(scroller){
      canvas.style.width='100%';track.style.width='100%';scroller.scrollLeft=0;
    }
    const dpr=Math.min(globalThis.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.font=font;ctx.lineWidth=1;const x=spin=>left+spin/end*plotWidth,y=v=>bottom-(v-lower)/(upper-lower)*(bottom-top);
    ctx.textAlign='right';ctx.textBaseline='middle';
    for(const v of ticks){ctx.setLineDash(v===0?[3,4]:[]);ctx.strokeStyle=v===0?'#80758f':'#302b40';ctx.beginPath();ctx.moveTo(left,y(v));ctx.lineTo(w-right,y(v));ctx.stroke();ctx.fillStyle=v===0?'#e3dcef':'#bcb3cd';ctx.fillText(label(v),left-8,y(v));}
    ctx.setLineDash([]);ctx.save();ctx.beginPath();ctx.rect(left,top,w-left-right,bottom-top);ctx.clip();
    // Space axis labels for the available width, instead of widening the chart.
    const roughX=end/Math.max(1,Math.floor(plotWidth/80)),unit=10**Math.floor(Math.log10(roughX));
    const xStep=Math.max(step,([1,2,5,10].find(v=>v*unit>=roughX)||10)*unit);
    ctx.strokeStyle='#302b40';for(let g=0;g<=end;g+=xStep){ctx.beginPath();ctx.moveTo(x(g),top);ctx.lineTo(x(g),bottom);ctx.stroke();}
    ctx.strokeStyle=points.at(-1).profit>=0?'#89edc5':'#ff9baa';ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(x(p.spin),y(p.profit)):ctx.moveTo(x(p.spin),y(p.profit)));ctx.stroke();
    ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.arc(x(points.at(-1).spin),y(points.at(-1).profit),3,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.fillStyle='#9e95b0';ctx.textAlign='center';ctx.textBaseline='bottom';
    for(let g=0;g<=end;g+=xStep)ctx.fillText(fmt(g)+' G',x(g),h-3);
    canvas.setAttribute('aria-label',`差枚グラフ。左が過去、右が最新、全履歴を幅に合わせて表示、総回転${fmt(latest)}G。最小${fmt(min)}pt、最大${fmt(max)}pt、現在${signed(points.at(-1).profit)}pt。`);
  }
  return {draw};
})();
