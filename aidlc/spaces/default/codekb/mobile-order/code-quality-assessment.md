# Code Quality Assessment

## 品質の概況
| 観点 | 評価 | 備考 |
|------|------|------|
| 命名 | good | 日本語コメントで意図が明確 |
| 関数サイズ | good | 大半が短い。`manager.ts` 155 行、`customer/index.tsx` 269 行が最大級 |
| エラー処理 | fair | 動作はするが重複・不統一(下記) |
| テスト | good(server)/ poor(web) | 契約 27 + ユニット 69 + E2E 14。web にテストなし。カバレッジ計測なし |
| 重複 | fair | エラー処理に集中 |
| Lint / CI | poor | ESLint・Prettier・CI なし。`npm run typecheck` のみ |
| ドキュメント | good | README、`aidlc-docs/` |

## エラー処理の重複(本 intent の対象。ここが正本)
`ApiError` という名前の型はリポジトリに無い(バックログ #11 の目標像。`aidlc-docs/construction/BOLT-REPORT-UA.md:43`)。

### A. サーバー側のエラー型
- `server/src/routes/customer.ts:10` `HttpError { statusCode }`(非 export)。400/404/409 を throw
- `server/src/db/transition.ts:8,14` `OrderNotFoundError`, `InvalidTransitionError { from, to }`。厨房ルートが `kitchen.ts:49-53` で `instanceof` により 404/409 に変換
- `manager.ts` は専用エラー型なし。`Parsed` 判別共用体 + `reply.code(N).send({ error })` を直接呼ぶ
- ルート内のインライン `reply.code(N).send({ error })` は `server/src/routes/` に計 18 箇所

### B. エラーハンドラの重複(#12)
| 場所 | 4xx の扱い | 5xx の扱い | ログ |
|------|-----------|-----------|------|
| `customer.ts:43-48` | `statusCode>=400` のメッセージを通す | `internal server error` | `app.log.error` |
| `kitchen.ts:19-28` | 同上(`message ?? 'bad request'`) | `internal server error` | `req.log.error` |
| `manager.ts:61-69` | `statusCode` 400-499 のみ通す | それ以外は 500 | `app.log.error` |
- `server/src/app.ts` に全体 `setErrorHandler` も `setNotFoundHandler` も無い。未定義ルート 404 は Fastify 標準形式(`e2e/e2e.test.ts:251` が特性テストで固定)

### C. クライアント側(#11)
- `web/src/shared/api.ts:9-11`: `new Error("<METHOD> <path> -> <status> <error>")` と文字列化。status・本文は構造化されない
- `web/src/customer/index.tsx:38-42` `parseApiError` が正規表現で status を復元(使用: 55, 98, 141 行)
- 他画面は別方式: `kitchen/index.tsx:111,133` は `String(e)`("Error: ..." が付く)、`manager/MenuPanel.tsx:91,118` と `SalesPanel.tsx:19` は `e instanceof Error ? e.message : e`
- 実際に status を参照するのは customer のみ(404 で保存 ID 破棄、409 で売り切れ処理)

## 技術的負債シグナル
- TODO/FIXME: なし(検出されず)。linter 抑制コメント: なし
- 共通ファイルの「Wave 1 中は読み取り専用」コメントが残存(`contracts/types.ts`, `app.ts`, `web/src/shared/api.ts`)。現在は Wave 1 終了済み

## リファクタ時の注意(Handoff)
1. server/web 共通の `ApiError` 置き場の候補は `contracts/`(web の tsconfig include 更新が必要。`dependencies.md`)
2. wire 形式 `{ error: string }` は OpenAPI・契約テスト・README と整合させ維持する。未定義 404 の形式を変えるなら `e2e/e2e.test.ts:251` を更新
3. 契約テスト 0b は `routes/{customer,kitchen,manager}` の書き込み SQL の位置を静的検査する。エラー処理のみの移動に留める
4. 回帰検出は `npm test` と E2E に依存。web 側の挙動(customer の 404/409 分岐、kitchen/manager のエラー表示文言)は自動テストがない
