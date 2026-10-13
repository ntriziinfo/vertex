// Only submitted fields are changed. NOVA's limit uses its existing MY basis.
function settingsPatch(body, machineType){
  const patch = {};
  for(const [key, max] of [['setting', 6], ['completeLimitPt', 999999]]){
    if(!Object.hasOwn(body, key)) continue;
    const value = Number(body[key]);
    if(!Number.isInteger(value) || value < 1 || value > max){
      throw Object.assign(new Error(`invalid ${key}`), {statusCode:400});
    }
    if(key === 'completeLimitPt' && machineType === 'nova'){
      patch.completeMyLimitPt = value;
      patch.completeLimitPt = 0;
    }else patch[key] = value;
  }
  if(!Object.keys(patch).length) throw Object.assign(new Error('settings required'), {statusCode:400});
  return patch;
}
module.exports = {settingsPatch};
