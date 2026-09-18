# 既存の有料Supabaseプロジェクトを共用する準備

この変更はサーバーのスキーマ指定対応のみ。本番データの移動・接続先切替はまだ行っていない。
新しいSupabaseプロジェクトは作らず、既存の有料プロジェクトに保存領域を追加する。
管理画面・管理パス・ゲームの接続URLは店舗ごとに維持する。

## 今回の共用先

ユーザー指定: ntriziinfo's Org 内の既存 `lasvegas-control`。
ロスベガスの既存public領域とその接続設定は維持し、デバッグ用 `vertex_debug` だけを追加する。
別途 `vertex_las_vegas` を作成したり、ロスベガスのデータを移す必要はない。
旧 `vertex-debug` が有料組織へ移管済みかどうかは、切替後の課金を止める際に確認する。

| Vercel店舗 | VERTEX_STORE_ID | VERTEX_DB_SCHEMA |
| --- | --- | --- |
| vertex | store-jag-one | vertex_main |
| lasvegas-control | store-las-vegas | vertex_las_vegas |
| vertex-debug | store-debug | vertex_debug |

既存データがあるpublic領域はそのまま維持できる。そこに接続中のサービスは変更しない。
上の表は各店舗を新しい専用領域へ移す場合の指定。未指定・publicは従来の独立DB互換。

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

有料組織の中で共用する既存プロジェクトの名前・参照IDを確定する。
対象に必要な空き容量があること、既存用途、移行元プロジェクトの再開状況を確認する。
APIキーやDB接続文字列はチャット・Git・ログに出力しない。

## 切替の順序（未実施）

1. 移行先・移行元をバックアップする。対象店舗の新規入店を止め、プレイ中のセッションを終了させ、移行中の書き込みを停止する。
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
