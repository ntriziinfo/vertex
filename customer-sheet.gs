/** @OnlyCurrentDoc */
// Container-bound customer registration for NOVA.
function setupCustomerRegistration(){
 const sheet=SpreadsheetApp.getActiveSpreadsheet();
 const existing=ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='customerRegistrationEdited');
 if(!existing)ScriptApp.newTrigger('customerRegistrationEdited').forSpreadsheet(sheet).onEdit().create();
 onOpen();
}
function customerIdColumn_(sheet){
 const headers=sheet.getRange(4,1,1,7).getDisplayValues()[0];
 const col=headers.indexOf('ユーザーID')+1;
 if(!col)throw new Error('ユーザーID列が見つかりません');
 return col;
}
function registerPendingCustomers(){
 const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('顧客登録');
 for(let row=5;row<=sheet.getLastRow();row++){
  const v=sheet.getRange(row,customerIdColumn_(sheet),1,6).getDisplayValues()[0];
  if(v[0]&&['有効','停止'].includes(v[2])&&(v[1]||!v[5]))registerCustomerRow_(sheet,row);
 }
}
function onOpen(){SpreadsheetApp.getUi().createMenu('顧客登録').addItem('選択行を登録・更新','registerSelectedCustomers').addToUi();}
function registerSelectedCustomers(){
 const range=SpreadsheetApp.getActiveRange();
 if(range.getSheet().getName()!=='顧客登録')throw new Error('顧客登録シートで行を選択してください');
 for(let r=Math.max(5,range.getRow());r<=range.getLastRow();r++)registerCustomerRow_(range.getSheet(),r);
}
// Optional installable edit trigger, NOT the simple onEdit trigger.
function customerRegistrationEdited(e){
 if(!e||e.range.getSheet().getName()!=='顧客登録'||e.range.getColumn()>customerIdColumn_(e.range.getSheet())+2)return;
 for(let r=Math.max(5,e.range.getRow());r<=e.range.getLastRow();r++){
  const v=e.range.getSheet().getRange(r,customerIdColumn_(e.range.getSheet()),1,3).getDisplayValues()[0];
  if(v[0]&&['有効','停止'].includes(v[2]))registerCustomerRow_(e.range.getSheet(),r);
 }
}
function registerCustomerRow_(sheet,row){
 const lock=LockService.getDocumentLock();lock.waitLock(20000);
 try{
  const v=sheet.getRange(row,customerIdColumn_(sheet),1,6).getDisplayValues()[0];
  const id=v[0].trim().toLowerCase();
  if(!id)return;
  if(v[5]&&v[5]!==id)throw new Error('登録済みIDは変更できません。停止して別行に新規登録してください');
  const ids=sheet.getRange(5,customerIdColumn_(sheet),Math.max(1,sheet.getLastRow()-4),1).getDisplayValues().flat().map(x=>x.trim().toLowerCase());
  if(ids.filter(x=>x===id).length!==1)throw new Error('ユーザーIDが重複しています');
  const p=PropertiesService.getScriptProperties(),origin=p.getProperty('CUSTOMER_API_ORIGIN')||'',secret=p.getProperty('CUSTOMER_SYNC_SECRET')||'';
  if(origin!=='https://vertex-debug.vercel.app'||secret.length<32)throw new Error('接続先が未設定です');
  const response=UrlFetchApp.fetch(origin+'/api/customers/sync',{method:'post',contentType:'application/json',headers:{'X-Customer-Sync-Secret':secret},payload:JSON.stringify({userId:id,password:v[1],status:v[2],displayName:sheet.getRange(row,1).getDisplayValue().trim()}),muteHttpExceptions:true});
  const data=JSON.parse(response.getContentText());
  if(response.getResponseCode()!==200||!data.ok)throw new Error(data.error||'登録できませんでした');
  // Keep the operator-entered password visible in the private customer sheet.
  sheet.getRange(row,customerIdColumn_(sheet)+3,1,3).setValues([[v[2]==='停止'?'停止済み':'登録済み',new Date(),id]]);
 }catch(error){sheet.getRange(row,customerIdColumn_(sheet)+3).setValue('要確認：'+error.message);}
 finally{lock.releaseLock();}
}

