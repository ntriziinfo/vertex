// NOVA's source HTML is the account entry itself, including the initial paint.
// Only stores that still issue seat passwords receive the legacy fields.
function renderPlayEntry(html, storeId){
  if(storeId === 'store-debug') return html;
  const fields = /<!-- login-fields:start -->[\s\S]*?<!-- login-fields:end -->/;
  if(!fields.test(html)) throw new Error('Missing play entry fields');
  return html.replace(fields, `<p class="muted" id="entryHelp">管理画面で発行されたパスワードを入力してください。</p>
    <label class="field"><span>パスワード</span><input id="password" maxlength="12" autocomplete="one-time-code"></label>`);
}
module.exports = {renderPlayEntry};
