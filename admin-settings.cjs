// Store completion is measured from cumulative net zero, never from a trough.
function completionSettings(settings={},machineType){
  if(machineType!=='nova')return {};
  settings=settings||{};
  const valid=value=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=999999;
  const limit=valid(settings.completeLimitPt)?Number(settings.completeLimitPt):valid(settings.completeMyLimitPt)?Number(settings.completeMyLimitPt):19000;
  return {completeBasis:'net',completeLimitPt:limit,completeMyLimitPt:0};
}
function settingsPatch(body, machineType){
  const patch = {};
  for(const [key, max] of [['setting', 6], ['completeLimitPt', 999999]]){
    if(!Object.hasOwn(body, key)) continue;
    const value = Number(body[key]);
    if(!Number.isInteger(value) || value < 1 || value > max){
      throw Object.assign(new Error(`invalid ${key}`), {statusCode:400});
    }
    if(key === 'completeLimitPt' && machineType === 'nova'){
      Object.assign(patch,completionSettings({completeLimitPt:value},machineType));
    }else patch[key] = value;
  }
  if(!Object.keys(patch).length) throw Object.assign(new Error('settings required'), {statusCode:400});
  return patch;
}
module.exports = {settingsPatch,completionSettings};
