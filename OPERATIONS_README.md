# VERTEX 店舗管理

RISINGやJACsPOTなどのゲーム本体から独立した、店舗単位の管理システムです。
ゲーム本体はそれぞれのGitHubリポジトリで更新し、VERTEXは台一覧、設定変更、パスワード発行、プレイセッション、結果履歴を担当します。

## 3店舗の構成

同じ`vertex`リポジトリからVercelプロジェクトを3つ作り、店舗ごとに環境変数とSupabaseを分けます。

| 項目 | 店舗1 | 店舗2 | 店舗3 |
| --- | --- | --- | --- |
| 管理画面名 | Vertex管理画面 | ロスベガス管理画面 | デバッグ |
| Vercelプロジェクト | vertex | lasvegas-control | vertex-debug |
| `VERTEX_STORE_ID` | store-jag-one | store-las-vegas | store-debug |
| `VERTEX_STORE_NAME` | Vertex管理画面 | ロスベガス管理画面 | デバッグ |
| `ADMIN_PASSWORD` | 店舗1専用 | 店舗2専用 | 店舗3専用 |
| Supabase | 店舗1専用 | 店舗2専用 | 店舗3専用 |

店舗ごとにDBを分けるため、台データ、パスワード、終了履歴、JACsPOTの共有プールは他店舗と混ざりません。

## Vercel環境変数

```text
VERTEX_STORE_ID=store-jag-one
VERTEX_STORE_NAME=Vertex管理画面
ADMIN_PASSWORD=店舗専用の管理パス
VERTEX_STORES_JSON=stores.example.jsonと同じ書式の1行JSON
VERTEX_RISING_GAME_URL=https://rising.example.com/jag.html
VERTEX_JACKSPOT_GAME_URL=https://jackspot.example.com/jackspot.html
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=Supabaseのservice role key
GOOGLE_SHEETS_WEBHOOK_URL=任意
```

台構成を変更するときは、Vercelの`VERTEX_MACHINES_JSON`へJSON配列を設定します。書式は`machines.example.json`を参照してください。ローカルだけで変更する場合は、同じ内容を`machines.local.json`として保存します。このファイルはGitへ登録されません。

店舗ごとの正式な非機密設定は`store-configs/<store-id>.machines.json`でGit管理できます。`VERTEX_MACHINES_JSON`と`machines.local.json`が未設定の場合、`VERTEX_STORE_ID`に対応するファイルを自動で読み込みます。現在のロスベガス本番構成は`store-configs/store-las-vegas.machines.json`に保存され、JACsPOT 5台のみです。管理パス、Supabaseキー、Webhook URLなどの秘密情報はこのファイルへ書きません。

店舗切替一覧は`VERTEX_STORES_JSON`で設定します。書式は`stores.example.json`を参照してください。3つのVercelプロジェクトへ同じ値を設定すると、管理画面の「店舗切替」から移動できます。未開設店舗の`adminUrl`を空にすると「準備中」と表示され、移動できません。管理パスはブラウザのオリジン単位で保持されるため、店舗を切り替えると移動先店舗の専用パスが必要です。

`stores.example.json`はURLだけを扱う公開設定です。管理パス、Supabaseキー、Google Apps Script URLは書かず、Vercel環境変数だけに保存します。

店舗プリセットが存在しない環境の初期構成は次の6台です。

- `rising-01`: RISING 1台
- `jackspot-01`〜`jackspot-05`: JACsPOT 5台
- JACsPOT 5台は同じ`poolId`の`jackspot-main`

## Supabase準備

各店舗のSupabase SQL Editorで`supabase_schema.sql`を実行します。既存テーブルにも`alter table ... add column if not exists`が適用されるため、再実行できます。全テーブルでRLSを有効化し、ブラウザ用キーからの直接アクセスを遮断します。VERTEX APIはservice roleで接続します。

JACsPOT共有ジャックポット用の`jackpot_pools`と`jackpot_events`も店舗DB内に作成されます。各100pt BETから10ptを原子的に共有プールへ加算し、3rdステージのJP成立時は同一店舗・同一`poolId`の残高を1回のトランザクションで全額払い出して0へ戻します。10,000ptは固定払い出しのみで共有JPとは同時払い出ししません。`idempotency_key`により通信再送時の二重積立・二重払い出しを防止します。

共有プールAPIは次の3つです。

- `GET /api/jackpot/pool?machineId=jackspot-01`: 現在残高
- `POST /api/jackpot/contribute`: 1回転分10ptの積立
- `POST /api/jackpot/claim`: 3rdステージJP成立時の全額払い出しとリセット（10,000ptとは別当選）

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
