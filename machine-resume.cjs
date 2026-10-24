// Share only the cabinet state, never the previous player's identity or credentials.
// Carry is display-only; every password/session still settles its own delta.
function creditCarryFor(machine,playerName){
  if(machine.machineType!=='nova')return 0;
  const previous=machine.lastEndedSession,record=previous?.record;
  const name=String(playerName||'').trim();
  if(!name || name!==String(previous?.playerName||'').trim() || !record
    || Number(record.resetSerial)!==Number(machine.resetSerial)
    || String(record.machineId)!==String(machine.machineId))return 0;
  const carry=record.playerCreditTotal ?? record.playerProfit;
  return Number.isFinite(Number(carry))?Number(carry):0;
}
function creditFields(machine,session,playerProfit){
  if(machine.machineType!=='nova')return {};
  const carry=Number(session.startSnapshot?.playerCreditCarry)||0;
  return {playerCreditCarry:carry,playerCreditTotal:carry+playerProfit};
}
function forSession(machine,session){
  if(machine.machineType!=='nova')return null;
  const same=String(machine.lastSnapshot?.playSessionId||'')===String(session.sessionId);
  const saved=same?machine.lastSnapshot:session.startSnapshot;
  const meta={version:2,creditCarry:Number(session.startSnapshot?.playerCreditCarry)||0,
    commandsAfter:Number(session.startedAt)||0,lastCommandId:Number(saved?.adminCommandLastId)||0};
  // After a management reset there is no game checkpoint, but the assigned
  // setting must still reach a fresh browser without replaying old commands.
  if(!saved?.stats)return {...meta,baseline:null,state:{savedAt:Number(saved?.updatedAt)||Number(session.startedAt)||0,
    settings:{...saved?.settings,setting:machine.assignedSetting||saved?.settings?.setting||1}}};
  return {...meta,baseline:same?saved.playSessionStartStats||null:null,state:{
    savedAt:Number(saved.capturedAt||saved.updatedAt)||0,settings:{...(saved.resumeSettings||saved.settings),setting:machine.assignedSetting||saved.settings?.setting||1},
    stats:saved.stats,normalState:saved.normalState||{},completeTrialState:saved.completeTrialState||{},
    runtimeState:saved.runtimeState||{session:saved.session||{},replayAccountingVersion:2},
    displaySinceBonusOffset:Math.max(0,(Number(saved.machineDisplayStats?.sinceBonus)||0)-(Number(saved.normalState?.sinceBonus)||0))
  }};
}
module.exports={forSession,creditCarryFor,creditFields};
