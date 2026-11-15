# API Documentation

正本は `contracts/openapi.json`。実装は `server/src/routes/`。

## エンドポイント(9 本)
| ユニット | メソッド/パス | 成功 | エラー応答 |
|----------|--------------|------|------------|
| UA | GET `/menu` | 200 `{ items }`(売り切れ含む。UC が依存) | - |
| UA | POST `/orders` | 201 `Order` | 400(lines 不正・未知 menu_item_id)、409(売り切れ) |
| UA | GET `/orders/:id` | 200 `Order` | 404(非整数 id も 404) |
| UB | GET `/kitchen/orders?status=` | 200 `{ orders }` | 400(不正 status) |
| UB | PATCH `/kitchen/orders/:id/status` | 200 `Order` | 400 / 404 / 409(不正遷移) |
| UC | POST `/manager/menu` | 201 `MenuItem` | 400 |
| UC | PUT `/manager/menu/:id` | 200 `MenuItem` | 400 / 404 |
| UC | PATCH `/manager/menu/:id/availability` | 200 `MenuItem` | 400 / 404 |
| UC | GET `/manager/sales/daily?date=` | 200 `DailySales` | 400(日付不正) |

## エラー応答の契約
- 形式: `{ "error": string }`(`components.schemas.Error`)。5xx は `internal server error` 固定(詳細非公開)
- 例外: 未定義ルートの 404 は Fastify 標準 `{ message, error, statusCode }`(`e2e/e2e.test.ts:251` で固定。README:152 に既知と記載)
- クライアント側の呼び出し面: `web/src/shared/api.ts` の `api`(`/api` プレフィックス、失敗時は文字列 `Error` を throw)。実装の重複は `code-quality-assessment.md`
