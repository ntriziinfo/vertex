const crypto=require('node:crypto');
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function fromRow(row){
  return row?{password:row.password,machineId:String(row.machine_id),playerName:row.player_name||'',status:row.status,issuedAt:Number(row.issued_at_ms)||0,usedAt:Number(row.used_at_ms)||0,sessionId:row.session_id||'',superSpeedAllowed:typeof row.super_speed_allowed==='boolean'?row.super_speed_allowed:null}:null;
}
function latest(rows){
  return [...rows].sort((a,b)=>(b.issuedAt-a.issuedAt)||String(b.password).localeCompare(String(a.password)))[0]||null;
}
function current(machine,rows){
  const own=rows.filter(row=>String(row.machineId)===String(machine.machineId));
  if(machine.currentSessionId)return own.find(row=>row.sessionId===machine.currentSessionId&&row.status==='used')
    || {machineId:machine.machineId,playerName:machine.currentPlayerName||'',password:'',status:'busy'};
  const row=latest(own);
  return row?.status==='issued'&&row.issuedAt>Number(machine.lastEndedSession?.endedAt||0)?row:null;
}
function candidate(secret,storeId,machine,previous,attempt){
  // Concurrent requests for the same available seat use the same candidates.
  // The existing password primary key elects one writer across server instances.
  // HMAC keeps codes unpredictable; the prior code/reset changes every generation.
  const seed=JSON.stringify(['seat-password-v1',storeId,machine.machineId,machine.resetSerial||0,machine.lastEndedSession?.sessionId||'',previous?.password||'',attempt]);
  const bytes=crypto.createHmac('sha256',secret).update(seed).digest();
  return Array.from({length:6},(_,i)=>alphabet[bytes.readUInt32BE(i*4)%alphabet.length]).join('');
}
module.exports={fromRow,latest,current,candidate};
