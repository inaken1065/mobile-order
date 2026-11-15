# BOLT REPORT: B3 (UC 店長)

Issue: #5 / ブランチ: `bolt/b3-manager` / 前提コミット: `e9828cb`(main)

## 完了条件の結果

| 条件 | 結果 |
|------|------|
| M1〜M3 の受入基準 | 満たす(下記。API はテストで、UI はブラウザ実機で確認) |
| 集計テスト合格 | `node --import tsx --test "server/test/manager/*.test.ts"` 40件 全通過 |
| 契約テスト 0〜3 が緑 | `npm run test:contracts` 25件 全通過 |
| 型チェック・ビルド | `npm run typecheck` / `npm run build:web` 成功 |
| 報告書 | 本ファイル |

## 実装範囲(編集したファイル)
- `server/src/routes/manager.ts`: `POST /manager/menu`、`PUT /manager/menu/{id}`、`PATCH /manager/menu/{id}/availability`、`GET /manager/sales/daily`
- `server/test/manager/manager.test.ts`
- `web/src/manager/`: `index.tsx`、`MenuPanel.tsx`、`SalesPanel.tsx`、`format.ts`、`manager.css`
- 共通ファイル(`contracts/`、`schema.sql`、`app.ts`、`web/` のシェル、`package.json` 等)は**編集していない**

## 書き込み境界
- 書き込みは `menu_items` の INSERT / UPDATE のみ。`orders` / `order_lines` は SELECT のみ(テスト「UC の API は orders / order_lines を一切変更しない」と契約テスト 0b で検査)
- `transitionOrder` は参照しない。DELETE は OpenAPI にないため実装しない

## 決定事項
- **入力検証(400)**: `name` / `category` は前後の空白を除いた非空文字列、`price` は 0 以上の整数(小数・文字列・null は不可)、`is_available` は boolean。body が JSON オブジェクトでない場合も 400。保存時は `name` / `category` を trim する
- **PUT の `is_available` 省略**: 現在値を維持する(価格だけ変えて売り切れを解除してしまう事故を避ける)。POST の省略時は販売中
- **id の扱い**: 数値でない・0・負数・小数のパスの id は、存在しない扱いで 404(OpenAPI が PUT / PATCH に 404 だけを定義しているため)
- **`updated_at`**: PUT / PATCH で更新、`created_at` は不変(JST ISO 文字列)
- **売上の集計**: READY の注文のみ、`completed_at` の先頭10文字(JST)で判定。`date` 省略時は今日(JST)、形式不正・存在しない日付(2026-02-30 など)は 400
- **商品別内訳**: `menu_item_id` 単位で1行に集約。数量・金額は `order_lines` のスナップショット(`unit_price`)で集計するので、後の価格変更の影響を受けない。商品名は当日最後に完成した注文の行の名前(改名後も1行にまとまる)。並びは数量の多い順(同数は `menu_item_id` 順)
- **エラー形式**: `{ "error": "<メッセージ>" }`。Fastify 自身のエラー(壊れた JSON など)も、manager ルートのプラグインスコープに `setErrorHandler` を置いて同形式にした。500 は詳細を返さず `internal server error`
- **UI**: タブ2つ(メニュー管理 / 売上)。メニュー一覧はカテゴリ別、売り切れはワンタップで切替、追加・編集フォーム(クライアント側でも入力検証)、売上は日付選択 + 前日 / 翌日 / 今日、合計・件数・商品別の数量と金額。スマホ幅(1カラム、タップ領域 40px 以上)とダークモードに対応

## 検証
- 受入テスト 40件(M1 追加・編集・価格変更・検証 / M2 売り切れ / M3 売上 / 共通 エラー形式・書き込み境界)
- テストの検出力: 5変異(日付基準を `created_at` に変更、trim 削除、PUT が `is_available` を上書き、売上を現在のメニュー価格で計算、エラーハンドラ撤去)をすべて検出
- ブラウザ実機(API=3003、Web=5176、`/manager`): メニュー追加(価格不正はクライアント側で拒否 → 正しい値で追加 → API に反映)、売り切れ解除(杏仁豆腐)、売上タブ(今日 ¥4,850 / 3件、前日 ¥3,200 / 2件。seed と API の値と一致)

## 契約への疑問・提案(共通ファイルは編集していない)
1. **OpenAPI に manager 系の 400 が未定義**: `POST /manager/menu`、`PUT /manager/menu/{id}`、`PATCH .../availability`、`GET /manager/sales/daily` は実際には 400 を返す。`contracts/openapi.json` への追記を提案(B0 への差戻し事項)
2. **店長用のメニュー一覧 API がない**: UI は UA 所有の `GET /menu`(売り切れ含む全件)に依存している。UA が将来「売り切れを除外する」「カテゴリで絞る」等の変更をすると UC の画面が壊れる。`GET /manager/menu` を契約に追加するか、`GET /menu` が常に全件を返すことを契約で明記したい
3. **`package.json` に Bolt 単体テストの実行スクリプトがない**: 現状は `node --import tsx --test "server/test/manager/*.test.ts"` を直接実行している。`test:units`(`server/test/**`)の追加を B4 で検討

## 未解決・限界
- UI の自動テストはない(型チェック・ビルド・ブラウザ手動確認のみ)
- メニューの削除はできない(OpenAPI にない)。不要な商品は売り切れにして運用する
- 同時編集は後勝ち(楽観ロックなし)
- メニュー一覧のページング・並び替えなし(カテゴリはカテゴリ名順、商品は id 順で表示)
- 「date 省略時は今日」のテストは実行時刻を使う(日付をまたぐ瞬間の実行は想定していない)
