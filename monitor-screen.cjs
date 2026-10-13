// Visual-only wire format. No HTML, event handlers, scripts, session or game state.
const tags = new Set(['div','section','span','p','b','strong','small','em','i','br','img','picture','video','button','h2','h3','output']);
const privateId = /(?:debug|setting|password|token|session|layoutEdit|audioDock|soundPanel|odds|resultText|subMessage|lcd)/i;
function asset(value, origin){
  if(typeof value!=='string'||value.length>1800)return '';
  let url;try{url=new URL(value,origin);}catch{return '';}
  if(url.origin!==new URL(origin).origin||!url.pathname.startsWith('/assets/'))return '';
  if(!/\.(png|webp|jpg|jpeg|gif|svg|mp4|webm)$/i.test(url.pathname))return '';
  url.search='';url.hash='';return url.href;
}
function style(value,origin){
  if(typeof value!=='string'||value.length>12000||/[@<>\\]|expression|javascript|behavior|-moz-binding/i.test(value))return '';
  return value.replace(/url\(([^)]*)\)/gi,(_,url)=>{
    const safe=asset(url.trim().replace(/^['"]|['"]$/g,''),origin);
    return safe?`url("${safe}")`:'none';
  });
}
function attributes(input,origin){
  const out={};
  for(const [key,raw] of Object.entries(input||{})){
    if(typeof raw!=='string'||raw.length>12000)continue;
    if(key==='id'&&!privateId.test(raw)&&/^[\w-]{1,100}$/.test(raw))out[key]=raw;
    else if(key==='class')out[key]=raw.slice(0,1000).replace(/\b(?:debugMode|debugOpen|layoutEditOpen)\b/g,'');
    else if(key==='style')out[key]=style(raw,origin);
    else if(key==='src'||key==='poster'){const src=asset(raw,origin);if(src)out[key]=src;}
    else if((key==='disabled'||key==='hidden')&&raw==='')out[key]='';
    else if(/^data-[a-z0-9-]{1,50}$/.test(key)&&!privateId.test(key)&&raw.length<=120)out[key]=raw;
  }
  return out;
}
function sanitizeScreen(frame,origin){
  if(!frame||frame.v!==1||JSON.stringify(frame).length>210000)throw Error('invalid screen');
  let count=0;
  function node(value,depth=0){
    if(++count>1800||depth>32)throw Error('screen too complex');
    if(typeof value==='string')return value.slice(0,300);
    if(!value||!tags.has(value.tag)||privateId.test(value.attrs?.id||''))return null;
    const out={key:String(value.key||'').slice(0,30),tag:value.tag,attrs:attributes(value.attrs,origin),children:[]};
    if(Array.isArray(value.children))out.children=value.children.map(n=>node(n,depth+1)).filter(n=>n!==null);
    if(value.tag==='video')out.media={time:Math.max(0,Math.min(86400,Number(value.media?.time)||0)),paused:value.media?.paused!==false,loop:value.media?.loop===true};
    return out;
  }
  const root=node(frame.root);if(!root||root.tag!=='section'||root.attrs.id!=='machine')throw Error('missing cabinet');
  const vars={};
  for(const [key,value] of Object.entries(frame.vars||{}))if(/^--[a-z0-9-]{1,70}$/i.test(key)&&typeof value==='string'&&value.length<=300)vars[key]=style(value,origin);
  return {v:1,width:Math.max(600,Math.min(1600,Number(frame.width)||960)),height:Math.max(800,Math.min(2400,Number(frame.height)||1610)),body:attributes(frame.body,origin),vars,root};
}
module.exports={sanitizeScreen};
