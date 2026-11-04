import {timingSafeEqual} from 'node:crypto';
import {retrySettlements} from './index.mjs';
export default async function handler(req,res){
  const expected=process.env.CRON_SECRET||'',supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'||!expected||Buffer.byteLength(expected)!==Buffer.byteLength(supplied)||!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied))){res.statusCode=401;res.end(JSON.stringify({ok:false}));return;}
  if(process.env.VERTEX_SETTLEMENT_WORKER!=='1'){res.statusCode=200;res.end(JSON.stringify({ok:true,disabled:true}));return;}
  try{const results=await retrySettlements({limit:20,budgetMs:240000});res.statusCode=200;res.end(JSON.stringify({ok:true,processed:results.length}));}
  catch{res.statusCode=503;res.end(JSON.stringify({ok:false,error:'settlement retry unavailable'}));}
}
