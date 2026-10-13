import {sanitizeScreen} from './monitor-screen.cjs';

export async function monitorRequest({req,body,id,action,definition,db,authenticate,now=Date.now()}){
  if(!definition||definition.machineType!=='nova')return {status:404,data:{ok:false,error:'machine not found'}};
  const key=encodeURIComponent(id);
  if(action==='frame'&&req.method==='POST'){
    // Always require the player's secret, even for legacy game-state endpoints
    // that still accept a session ID without a token. Spectators never get it.
    const {session}=await authenticate(req,id,body);
    let screen;try{screen=sanitizeScreen(body.screen,definition.gameUrl);}catch{return {status:400,data:{ok:false,error:'invalid screen'}};}
    await db('machine_monitors?on_conflict=machine_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({machine_id:id,session_id:session.session_id,updated_at_ms:now,screen})});
    return {status:200,data:{ok:true}};
  }
  if(!((action==='watch'&&req.method==='POST')||(!action&&req.method==='GET')))return {status:405,data:{ok:false,error:'method not allowed'}};
  const rows=await db(`machine_states?machine_id=eq.${key}&select=machine_id,locked,current_session_id,monitor_requested_until_ms`);
  const machine=rows?.[0];
  const base={ok:true,machineId:id,displayName:definition.displayName,gameOrigin:new URL(definition.gameUrl).origin};
  if(!machine?.locked||!machine.current_session_id)return {status:200,data:{...base,status:'idle'}};
  if(action==='watch'){
    if(Number(machine.monitor_requested_until_ms||0)<now+20000){
      // Bind the lease to the session just read: a concurrent end/reset cannot
      // accidentally request a broadcast for the next player.
      await db(`machine_states?machine_id=eq.${key}&current_session_id=eq.${encodeURIComponent(machine.current_session_id)}&locked=eq.true`,{method:'PATCH',body:JSON.stringify({monitor_requested_until_ms:now+45000})});
    }
    return {status:200,data:{...base,status:'waiting'}};
  }
  const frames=await db(`machine_monitors?machine_id=eq.${key}&session_id=eq.${encodeURIComponent(machine.current_session_id)}&select=updated_at_ms,screen&limit=1`);
  const latest=frames?.[0];
  if(!latest||now-Number(latest.updated_at_ms)>12000)return {status:200,data:{...base,status:'waiting'}};
  return {status:200,data:{...base,status:'live',updatedAt:Number(latest.updated_at_ms),
    // The viewer cannot obtain a prior player's frame or session credentials.
    ...(Number(req.query?.since)===Number(latest.updated_at_ms)?{}:{screen:latest.screen})}};
}
