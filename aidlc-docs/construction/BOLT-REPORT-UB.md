# BOLT REPORT: B2 (UB 厨房)

Issue: #4 / ブランチ: `bolt/b2-kitchen` / 前提: B0(`06fb51e`、`.gitignore` 補強 `e9828cb`)

## 完了条件の結果

| 条件 | 結果 |
|------|------|
| K1〜K3 の受入基準 | 満たす(受入テスト + 実機確認) |
| 遷移ルールのテスト | `node --import tsx --test "server/test/kitchen/*.test.ts"` 14件 全通過 |
| 契約テスト 0〜3 | `npm run test:contracts` 25件 全通過 |
| 型チェック / ビルド | `npm run typecheck` / `npm run build:web` 成功 |

## 実装

- `GET /kitchen/orders?status=`: 古い順(`created_at, id`)。不正な `status` は 400
- `PATCH /kitchen/orders/{id}/status`: body `{ status }`。更新は共有関数 `transitionOrder()` 経由のみ(`routes/kitchen.ts` に書き込み SQL なし)
  - 200: 更新後の `Order` 全体を返す(明細・`total` は不変)
  - 400: `status` の欠落・不正値・型違い・ボディなし(存在しない id より先に評価)
  - 404: 注文が存在しない、または id が整数でない
  - 409: 逆戻り・飛ばし・同一状態(`invalid transition: FROM -> TO`)。DB は変わらない
- Kitchen UI(`web/src/kitchen/`): 受付 / 調理中 / 完成の3区分、古い順、明細・経過時間・受付時刻、「調理開始」「完成」ボタン、2秒ポーリング、エラー表示。スマホ幅(390px)でも1列に折り返して使える
- 実機確認(API :3002 / Web :5175): UI のボタンで #11 を PLACED → COOKING → READY に進め、`completed_at` が READY でのみ設定され、`GET /manager/sales/daily` に反映されることを確認

## 決定事項

- **エラー形式の統一**: B0 申し送り(Fastify 標準のエラー形式が `{ error }` と異なる)に対し、`app.ts` は触らず、kitchen プラグイン内の `setErrorHandler` で UB のルートだけ `{ error: メッセージ }` に揃えた。壊れた JSON も `{ "error": "Body is not valid JSON ..." }`(400)で返る。5xx は内部情報を出さず `{ error: "internal server error" }`
  - 影響範囲は kitchen プラグイン内のルートのみ。UA・UC も同様に各プラグイン内で設定すれば全体が揃う。B4 で「プラグインごとの重複」を `app.ts` 側の1か所に寄せるか判断する余地あり(要 B0 差戻し)
- **同一状態への遷移(PLACED → PLACED など)は 409**: `ORDER_TRANSITIONS` に無い遷移はすべて 409 とした
- **id が整数でない場合は 404**: OpenAPI に 400 の定義がないため。「存在しない注文」と同じ扱い
- **UI の完成列**: 当日(JST)に完成した注文のみ、直近10件を新しい順で表示(見出しの件数は当日の完成数)。受付・調理中は件数制限なしで古い順。10分以上経過した未完成の注文は赤枠で強調(`WARN_MIN`)
- **UI の更新失敗時**: 409 など失敗しても最新状態を取り直し、エラーを表示する(他端末で先に更新された場合を想定)

## 契約への疑問・共通ファイルへの変更要望

編集が必要な共通ファイルは**ない**。以下は参考情報。

- 単体テストの実行手段がない: `package.json` に `test:contracts` しかなく、ユニット別テストは `node --import tsx --test "server/test/<role>/*.test.ts"` を直接実行している。B4 前に `npm run test:units`(または `test`)を `package.json` に追加するとよい(共通ファイルのため B0 差戻し or B4 で対応)
- OpenAPI の `PATCH /kitchen/orders/{id}/status` に 400 が定義されていない(実装は 400 を返す)。契約に追記するのが望ましい

## 未解決・限界

- ステータス更新の競合(2台の厨房端末が同時に押す)は、2台目が 409 になる(DB の `WHERE status = ?` で担保)。UI は「更新できませんでした」を表示して最新状態に戻す。専用のメッセージは出していない
- ポーリング更新が 2 秒ごとのため、エラー表示は次のポーリング成功で消える場合がある(更新失敗時は `load()` 後に再設定しているが、数秒で消える)
- UI の自動テストはない(ブラウザでの手動確認のみ)
