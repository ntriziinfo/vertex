const RATES=Object.freeze([2000,1000,500]);
function validate(value){if(!RATES.includes(value))throw Object.assign(new Error('レートは2,000円・1,000円・500円から選択してください'),{statusCode:400});return value;}
function machineRate(machine){
 const c=machine?.capabilities||{};
 const locked=RATES.includes(c.pointRate)&&Number(c.pointRateResetSerial)===Number(machine.resetSerial||0);
 return {pointRate:locked?c.pointRate:2000,pointRateLocked:locked};
}
function settlementRate(session){const rate=session?.startSnapshot?.pointRate;return rate===undefined?2000:validate(rate);}
module.exports={RATES,validate,machineRate,settlementRate};
