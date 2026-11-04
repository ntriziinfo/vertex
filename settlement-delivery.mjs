import {randomUUID} from 'node:crypto';
// Only follow a ContentService response URL. Never forward the POST or credentials.
export async function deliver(url,record,{fetchImpl=fetch,timeoutMs=12000}={}){
 if(!url)return {ok:false,error:'Sheets連携先が設定されていません'};
 try{
  const signal=AbortSignal.timeout(timeoutMs);
  let response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record),redirect:'manual',signal});
  for(let hop=0;[302,303].includes(response.status)&&hop<3;hop++){
   const target=new URL(response.headers.get('location')||'',url);
   if(target.protocol!=='https:'||target.hostname!=='script.googleusercontent.com')return {ok:false,error:'想定外のSheets転送先'};
   response=await fetchImpl(target.href,{method:'GET',redirect:'manual',signal});
  }
  if(!response.ok)return {ok:false,error:`Sheets HTTP ${response.status}`};
  const result=await response.json();
  if(result.ok!==true||result.sessionId!==record.sessionId)return {ok:false,error:'Sheetsの受領確認が一致しません'};
  return {ok:true,duplicate:result.duplicate===true};
 }catch(error){return {ok:false,error:error.name==='TimeoutError'?'Sheets応答待ちが時間切れになりました':'Sheetsへ接続できませんでした'};}
}
export function createDeliveryWorker({sb,send,clock=Date.now}){
 async function one(sessionId=null){
  const token=randomUUID();const rows=await sb('rpc/nova_claim_settlement',{method:'POST',body:JSON.stringify({p_token:token,p_session_id:sessionId})});
  if(!rows?.length)return null;
  const job=rows[0];let result;try{result=await send(job.record);}catch{result={ok:false,error:'Sheets送信処理が失敗しました'};}
  await sb('rpc/nova_ack_settlement',{method:'POST',body:JSON.stringify({p_session_id:job.session_id,p_token:token,p_ok:result.ok===true,p_error:result.error||''})});
  return {sessionId:job.session_id,...result,pending:!result.ok,attempts:job.attempts};
 }
 async function drain({budgetMs=18000,limit=2}={}){const started=clock(),results=[];while(results.length<limit&&clock()-started<budgetMs){const r=await one();if(!r)break;results.push(r);}return results;}
 return {one,drain};
}
