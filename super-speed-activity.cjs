const crypto=require('node:crypto');
function dateJst(now=Date.now()) { return new Date(now+9*3600000).toISOString().slice(0,10); }
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
function event(password,machineId,playerName,kind,now=Date.now(),sessionId='') {
  const key=crypto.createHash('sha256').update(password||('session:'+sessionId)).digest('hex'),day=dateJst(now);
  return {id:`${key}:${day}:${kind}`,activity_date:day,issuance_key:key,machine_id:String(machineId),player_name:playerName,event_type:kind,occurred_at_ms:now,session_id:sessionId};
}
function summarize(events) {
  const rows=new Map();
  for(const event of events){
    const key=event.issuance_key;
    const row=rows.get(key)||{machineId:event.machine_id,playerName:event.player_name,allowedAt:0,usedAt:0};
    const field=event.event_type==='used'?'usedAt':'allowedAt';
    row[field]=row[field]?Math.min(row[field],Number(event.occurred_at_ms)):Number(event.occurred_at_ms);
    rows.set(key,row);
  }
  return [...rows.values()].sort((a,b)=>(b.usedAt||b.allowedAt)-(a.usedAt||a.allowedAt));
}
module.exports={dateJst,validDate,event,summarize};
