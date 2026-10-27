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
 let held=false;
 for(let r=Math.max(5,range.getRow());r<=range.getLastRow();r++)held=registerCustomerRow_(range.getSheet(),r)||held;
 notifyCustomerNameReview_(held);
}
// Optional installable edit trigger, NOT the simple onEdit trigger.
function customerRegistrationEdited(e){
 if(!e||e.range.getSheet().getName()!=='顧客登録')return;
 const sheet=e.range.getSheet(),col=customerIdColumn_(sheet);
 if(e.range.getColumn()>col+2)return;
 const approve=e.range.getNumRows()===1&&e.range.getNumColumns()===1&&e.range.getColumn()===col+2&&e.oldValue==='保留'&&e.value==='有効';
 let held=false;
 for(let r=Math.max(5,e.range.getRow());r<=e.range.getLastRow();r++){
  held=registerCustomerRow_(sheet,r,{approve:approve,nameEdited:e.range.getColumn()===1})||held;
 }
 notifyCustomerNameReview_(held);
}
function registerCustomerRow_(sheet,row,options){
 options=options||{};
 const lock=LockService.getDocumentLock();lock.waitLock(20000);
 try{
  const v=sheet.getRange(row,customerIdColumn_(sheet),1,6).getDisplayValues()[0];
  const id=v[0].trim().toLowerCase();
  if(reviewCustomerName_(sheet,row,options))return true;
  const status=sheet.getRange(row,customerIdColumn_(sheet)+2).getDisplayValue();
  if(!id||!['有効','停止'].includes(status))return false;
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

// Display-name review only; duplicate user IDs remain prohibited.
function normalizedCustomerName_(name){
 return String(name||'').normalize('NFKC').toLowerCase().replace(/[\s・･]/g,'').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
}
function similarCustomerNames_(left,right){
 const a=Array.from(normalizedCustomerName_(left)),b=Array.from(normalizedCustomerName_(right));
 if(!a.length||!b.length)return false;
 if(a.join('')===b.join(''))return true;
 if(Math.min(a.length,b.length)<3||Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,edits=0;
 while(i<a.length&&j<b.length){
  if(a[i]===b[j]){i++;j++;continue;}
  if(++edits>1)return false;
  if(a.length>=b.length)i++;
  if(b.length>=a.length)j++;
 }
 return edits+(a.length-i)+(b.length-j)<=1;
}
function reviewCustomerName_(sheet,row,options){
 const col=customerIdColumn_(sheet),v=sheet.getRange(row,col,1,6).getDisplayValues()[0];
 const name=sheet.getRange(row,1).getDisplayValue().trim();
 const normalized=normalizedCustomerName_(name),id=v[0].trim().toLowerCase();
 if(!normalized||v[2]==='停止')return false;
 const props=PropertiesService.getDocumentProperties();
 const key='NAME_APPROVED:'+sheet.getSheetId()+':'+id;
 if(options.approve&&id)props.setProperty(key,normalized);
 if(id&&props.getProperty(key)===normalized)return false;
 // Existing registrations are reviewed again only when their name is edited.
 if(v[5]&&!options.nameEdited)return false;
 const matches=sheet.getRange(5,1,Math.max(1,sheet.getLastRow()-4),1).getDisplayValues()
  .map((value,index)=>({name:value[0],row:index+5}))
  .filter(item=>item.row!==row&&similarCustomerNames_(name,item.name));
 if(!matches.length)return false;
 const newlyHeld=v[2]!=='保留';
 sheet.getRange(row,col+2).setValue('保留');
 sheet.getRange(row,col+3).setValue('保留：似た名前あり（'+matches.slice(0,5).map(item=>item.row+'行目 '+item.name).join('、')+'）。確認後、状態を有効に切り替えてください');
 return newlyHeld;
}
function notifyCustomerNameReview_(held){
 if(!held)return;
 SpreadsheetApp.flush();
 SpreadsheetApp.getUi().alert('似た名前の確認','似てる名前があります。登録する場合は有効に切り替えてください。',SpreadsheetApp.getUi().ButtonSet.OK);
}
