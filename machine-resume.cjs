// Share only the cabinet state, never the previous player's identity or credentials.
function forSession(machine,session){
  if(machine.machineType!=='nova')return null;
  const same=String(machine.lastSnapshot?.playSessionId||'')===String(session.sessionId);
  const saved=same?machine.lastSnapshot:session.startSnapshot;
  if(!saved?.stats)return {version:1,state:null,baseline:null};
  return {version:1,baseline:same?saved.playSessionStartStats||null:null,state:{
    savedAt:Number(saved.capturedAt||saved.updatedAt)||0,settings:{...(saved.resumeSettings||saved.settings),setting:machine.assignedSetting||saved.settings?.setting||1},
    stats:saved.stats,normalState:saved.normalState||{},completeTrialState:saved.completeTrialState||{},
    runtimeState:saved.runtimeState||{session:saved.session||{},replayAccountingVersion:2},
    displaySinceBonusOffset:Math.max(0,(Number(saved.machineDisplayStats?.sinceBonus)||0)-(Number(saved.normalState?.sinceBonus)||0))
  }};
}
module.exports={forSession};
