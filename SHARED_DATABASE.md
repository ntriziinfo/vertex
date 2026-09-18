# 既存の有料Supabaseプロジェクトを共用する準備

サーバーのスキーマ指定対応を実装済み。2026-09-18にPro側の専用領域を作成し、移行元のデータをコピー・照合した。
Vercelの認証が未完了のため、本番サイトの接続先切替・変更コードの配備はまだ行っていない。
新しいSupabaseプロジェクトは作らず、既存の有料プロジェクトに保存領域を追加する。
管理画面・管理パス・ゲームの接続URLは店舗ごとに維持する。

## 今回の共用先

2026-09-18に公式CLIの認証後、所属先を実データで確認した。
ユーザーが有料側として指定した `ntriziinfo's Org` に存在する既存プロジェクトは
`ntriziinfo's Project`（`kruhmbpzshunbvniuccz`）。Management APIで組織の契約がProであることを確認済み。
移行前のDBサイズは42,699,923 bytes。移行元の組織 `vertex-independent-stores` はFree。
`lasvegas-control` は同組織にはなく、デバッグ用とともに `vertex-independent-stores` にある。

| 役割 | プロジェクト | 参照ID | 確認時の状態 |
| --- | --- | --- | --- |
| 集約先 | ntriziinfo's Project | kruhmbpzshunbvniuccz | ACTIVE_HEALTHY |
| ロスベガス移行元 | lasvegas-control | jrmmtrdgjwjkabujfrsy | ACTIVE_HEALTHY |
| デバッグ移行元 | vertex-debug | wzeuduuzijvapjybiejv | 再開後 ACTIVE_HEALTHY |

集約先の既存public領域と、その領域に接続中のサービスは維持する。
ロスベガスを `vertex_las_vegas`、デバッグ用を `vertex_debug` へコピーして接続を切り替える。
プロジェクトを有料組織へ移管する操作や新規プロジェクトの作成は行わない。
デバッグ移行元は無料組織内で再開済み。元のプロジェクト・データは維持している。

## 2026-09-18時点の実施状況

- 移行元2つの7テーブルをローカルのアクセス制限付きフォルダへバックアップ。各ファイルのSHA-256を記録。
- 集約先の既存public領域は変更していない。Supabase側のバックアップが2026-09-17 21:23 UTCにCOMPLETEDであることを確認。
- 集約先のローカル全データ書き出しはタイムアウトし、完了していない。これを完了済みバックアップとして扱わない。
- `vertex_las_vegas` / `vertex_debug` を作成。匿名・ログインユーザーの利用権限を撤回し、service_roleだけに利用を許可。
- データコピー後、両領域の全7テーブルについて移行元との件数・内容のハッシュ一致を確認。identity sequenceも引き継ぎ済み。
- Data APIの既存公開領域を保持したまま、2つの専用領域を追加。service_roleで読み取り成功、anonでは401となることを確認。
- コピーは切替前のステージング状態。元のサイトは元のDBへ接続中なので、切替直前に再照合・必要に応じて再同期する。
- Vercelの環境変数・本番デプロイ・ドメイン割当は未変更。切替・動作確認・元側の更新停止の整理が残っている。

| テーブル | ロスベガス | デバッグ |
| --- | ---: | ---: |
| machine_states | 4 | 6 |
| issued_passwords | 6 | 15 |
| sessions | 5 | 10 |
| machine_commands | 5 | 12 |
| session_results | 3 | 8 |
| jackpot_pools | 1 | 0 |
| jackpot_events | 11,089 | 0 |

上記は保存済みレコード数。画面の設定上の台数（ロスベガス5台・デバッグ12台）とは異なる。

| Vercel店舗 | VERTEX_STORE_ID | VERTEX_DB_SCHEMA |
| --- | --- | --- |
| vertex（既存接続を維持） | store-jag-one | public（現状を確認して維持） |
| lasvegas-control | store-las-vegas | vertex_las_vegas |
| vertex-debug | store-debug | vertex_debug |

既存データがあるpublic領域はそのまま維持できる。そこに接続中のサービスは変更しない。
未指定・publicは従来の独立DB互換。`vertex_main` もコード上は対応するが、今回は移行しない。

## 準備済み

- API本体、セッション検証、台の状態更新、履歴、パスワード、コマンド、JP関数、ヘルスチェックに同一のスキーマ指定を適用。
- 店舗と異なるスキーマ指定はエラーにし、publicへの代替接続はしない。
- 外部リクエストのスキーマ指定をDBへ引き継がない。
- 7テーブルと3つのJP関数を各専用領域に作るSQLジェネレーター。
- 既存領域と同名なら作成を中止。既存のテーブル・行を上書きしない。
- 匿名・ログインユーザーにはテーブル・関数の権限を付与しない。従来どおりサーバーのservice_roleだけがアクセスする。

SQLを生成（これだけではDBへ接続しない）:

```text
node scripts/shared-schema.mjs store-las-vegas
node scripts/shared-schema.mjs store-debug
```

## 移行前に必要な情報

Vercel側の認証と現在の接続設定を確認し、切替時の書き込み整合性を確保する。
APIキーやDB接続文字列はチャット・Git・ログに出力しない。

## 切替の全体手順（初回コピー済み、運用停止・最終同期・サイト切替は未実施）

1. 移行先・移行元のバックアップを確保する。サイト切替直前に対象店舗の新規入店・書き込みを一時停止し、最終同期する。既存セッションのID・状態は保持する。
2. 上のSQLで移行先へ新しい専用領域を作成する。既存public領域に対するDDLは実行しない。
3. 移行元のmachine_states / issued_passwords / sessions / machine_commands / session_results / jackpot_pools / jackpot_eventsを、対応する領域へデータを保ったままコピーする。
4. machine_commandsとsession_resultsのidentity sequenceを移行した最大IDに合わせる。件数・主キー・内容・設定・JP残高を照合する。台番号、セッションID、コマンドID、パスワードは変更しない。
5. Supabase Data APIのExposed schemasに対応領域を追加する。既存の公開領域は削除しない。RLSと権限を検証する。
6. 変更済みAPIを配備し、各Vercel環境のSUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VERTEX_DB_SCHEMAを同時に切り替える。
7. 台一覧、管理ログイン、パス発行、プレイ、終了記録、JPを確認。片方のリセットやコマンドが他の領域へ届かないことを確認して運用を再開する。
8. 元データは削除しない。すでに有料組織へ移管した旧プロジェクトがある場合、単に接続を外すだけでは稼働費は止まらない。復旧用コピーを確保し、別途停止方法を確認する。

切替後に新しい書き込みが入った場合、旧DBへ接続を戻すだけではその間の記録が欠落する。再停止・差分照合してから戻す。

## 費用と分離の限界

領域を増やしてもプロジェクト数は増えないため、追加プロジェクトのCompute費は発生しない。
容量・通信量などの従量費や、性能不足によるサイズ変更は別。追加費用ゼロを無条件に保証するものではない。
CPU、ディスク、バックアップ、障害範囲、およびサーバー用service_roleキーは共通になる。
この分離はアプリの通常操作・台番号の衝突を防ぐもので、管理者キーを持つサービス同士の権限境界ではない。

公式資料:
- https://supabase.com/docs/guides/api/using-custom-schemas
- https://supabase.com/docs/guides/platform/billing-on-supabase
