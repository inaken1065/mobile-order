# BOLT REPORT: B0 (U0 Contracts + Walking Skeleton)

## B0 完了条件の結果

| # | 条件 | 結果 |
|---|------|------|
| 1 | 客画面 → `POST /orders` → DB → 厨房画面 | API 経路は実サーバー + Vite プロキシ経由の curl で確認(注文作成 → `GET /kitchen/orders?status=PLACED` に出現)。3画面は 200 で配信、型チェックとビルド成功。**ブラウザ上でボタンを押す操作は未実施** |
| 2 | 契約(型・OpenAPI・書き込み担当表) | `contracts/types.ts` `openapi.json` `ownership.ts` + `02-units.md`。**レビュー承認は人間側の作業として未了** |
| 3 | スキーマ・シード・トリガー | `server/src/db/schema.sql` `seed.ts`。シードもトリガーの内側(INSERT→`transitionOrder`)で作成 |
| 4 | 契約テスト 0〜3 が緑 | `npm run test:contracts` 25件 全通過 |
| 5 | 意図的に壊して赤を確認 | `npm run mutation:check` 19変異すべて検出 |
| 6 | 1コマンドで全件実行 | `npm run test:contracts` |

## 決定事項
- `node:sqlite`(Node 24 組込み)を採用。ネイティブビルド不要。実験的警告が出る
- テストは `node:test` + `tsx`。vite 系ランナーは `node:sqlite` の解決に問題があるため避けた
- 日時は JST の ISO 文字列。日次集計は先頭10文字で判定(`02-units.md` に追記)
- API のフィールド名は DB 列名と同じ snake_case。`is_available` のみ API では boolean
- `menu_item_id` は外部キーにしない(メニュー削除後も注文を残す。テスト 1d で保証)
- `completed_at` は「READY への遷移と同時にのみ設定」をトリガー(`orders_completed_at_only_on_ready`)とテスト 0a の両方で保証。`orders` の DELETE も不可にした
- 売上スタブ(`routes/manager.ts`)は B0 で最小実装済み。B3 が置き換える。メニュー管理 API は未実装(B3)
- `PATCH /kitchen/orders/{id}/status` は未実装(B2)。契約(OpenAPI)と `transitionOrder()` は用意済み

## 検証で分かったこと
- **等価変異**: 売上の `status = 'READY'` 条件だけを緩めても結果は変わらない。`completed_at` が READY 以外で常に NULL(トリガー保証)なので、日付条件が結果的に除外するため。多重防御であり、検出対象外とした(`scripts/mutation-check.ts` に注記)
- **テストの穴を1件修正**: テスト3の「日付は completed_at 基準」は、注文の `created_at` が実行時刻になるため `created_at` 基準の実装と区別できていなかった(実行日が `TODAY` と同じ偶然で通っていた)。`created_at` を明示して作る `insertOrderAt()` を追加して解消。ミューテーション検査で発見

## 既知の限界・B1〜B4 への申し送り
- テスト 1(c)「売り切れ商品を含む `POST /orders` が 409」は B1(UA)の受入テスト。B4 で再確認
- 静的検査(0b)は「SQL は大文字」「コメントは対象外」「文字列として書かれた SQL」前提の簡易検査。クエリビルダ等を導入した場合は検査器の更新が必要
- ユニット識別は実行時に行わない(1プロセス・1DB)。境界はトリガーと静的検査のみ
- 呼出番号は `MAX+1`(日次リセットなし)。B1 で要件化するか判断
- 契約テストは Wave 1 中は読み取り専用。赤くなったらテストでなく実装を直す
- Wave 1 を並列に回す場合: API は `PORT` / `DB_PATH`、Web は `WEB_PORT` / `API_PORT` で Bolt ごとに分ける(UA=3001、UB=3002、UC=3003)

## 使い方
```
npm run db:reset         # data/app.db を作り直してシード
npm run dev:server       # API (PORT=3000, DB_PATH=data/app.db)
npm run dev:web          # Web (WEB_PORT=5173, API_PORT=3000)  /customer /kitchen /manager
npm run test:contracts   # 契約テスト 0〜3
npm run mutation:check   # 契約テストの検出力確認
npm run typecheck
```
