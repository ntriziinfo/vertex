# VERTEX 店舗管理

RISINGやJACsPOTなどのゲーム本体から独立した、店舗単位の管理システムです。
ゲーム本体はそれぞれのGitHubリポジトリで更新し、VERTEXは台一覧、設定変更、パスワード発行、プレイセッション、結果履歴を担当します。

## 3店舗の構成

同じ`vertex`リポジトリからVercelプロジェクトを3つ作り、店舗ごとに環境変数とSupabaseを分けます。

| 項目 | 店舗A | 店舗B | 店舗C |
| --- | --- | --- | --- |
| Vercelプロジェクト | vertex-store-a | vertex-store-b | vertex-store-c |
| `VERTEX_STORE_ID` | store-a | store-b | store-c |
| `VERTEX_STORE_NAME` | 店舗A | 店舗B | 店舗C |
| `ADMIN_PASSWORD` | 店舗A専用 | 店舗B専用 | 店舗C専用 |
| Supabase | 店舗A専用 | 店舗B専用 | 店舗C専用 |

店舗ごとにDBを分けるため、台データ、パスワード、終了履歴、JACsPOTの共有プールは他店舗と混ざりません。

## Vercel環境変数

```text
VERTEX_STORE_ID=store-a
VERTEX_STORE_NAME=店舗A
ADMIN_PASSWORD=店舗専用の管理パス
VERTEX_RISING_GAME_URL=https://rising.example.com/jag.html
VERTEX_JACKSPOT_GAME_URL=https://jackspot.example.com/jackspot.html
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=Supabaseのservice role key
GOOGLE_SHEETS_WEBHOOK_URL=任意
```

台構成を変更するときは、Vercelの`VERTEX_MACHINES_JSON`へJSON配列を設定します。書式は`machines.example.json`を参照してください。ローカルだけで変更する場合は、同じ内容を`machines.local.json`として保存します。このファイルはGitへ登録されません。

初期構成は次の6台です。

- `rising-01`: RISING 1台
- `jackspot-01`〜`jackspot-05`: JACsPOT 5台
- JACsPOT 5台は同じ`poolId`の`jackspot-main`

## Supabase準備

各店舗のSupabase SQL Editorで`supabase_schema.sql`を実行します。既存テーブルにも`alter table ... add column if not exists`が適用されるため、再実行できます。

JACsPOT共有ジャックポット用の`jackpot_pools`と`jackpot_events`も店舗DB内に作成されます。現時点ではプールのDB土台までで、投入10%加算・当選時の原子的な全額払出APIは次段階でゲームへ接続します。

## 台をVERTEXへ接続する仕組み

VERTEXがプレイ開始時にゲームURLへ以下を自動付加します。

```text
?controller=vertex
&storeId=store-a
&machine=jackspot-01
&server=https%3A%2F%2Fvertex-store-a.example.com
&creditBaseline=0
&playSessionId=...
```

RISINGの`jag.html`とJACsPOTの`jackspot.html`は`server`のVERTEXへ定期的に状態を送信し、同じVERTEXから管理コマンドを取得します。通常の終了操作ではVERTEXから最新状態の送信を要求し、返信後に清算します。

## ページ

- `/admin.html`: 店舗管理画面
- `/machines.html`: 台選び
- `/play.html?machine=jackspot-01`: 台別プレイ入口
- `/api/config`: 店舗設定の確認
- `/api/health`: 接続確認

## ローカル確認

```powershell
$env:ADMIN_PASSWORD="test"
$env:VERTEX_STORE_ID="store-local"
$env:VERTEX_STORE_NAME="ローカル店舗"
node server.js
```

初期URLはRISINGが`http://127.0.0.1:18887/jag.html`、JACsPOTが`http://127.0.0.1:18888/jackspot.html`です。管理サーバーは`http://127.0.0.1:8787/admin.html`で開きます。ローカルデータは`data/`へ保存され、Gitには登録されません。

## 終了データ

終了履歴は機種共通で次を保持します。

- `playerProfit`: 利用者の差pt
- `playerTotalFee`: 利用者の投入pt
- `playerTotalPaid`: 利用者の払出pt
- `playerSpins`: 利用者の回転数
- `storeId`, `storeName`, `machineId`, `machineName`, `machineType`

ブラウザが突然閉じた場合の強制清算は最後に受信した保存状態を使います。通常終了は終了直前に最新状態を同期します。
