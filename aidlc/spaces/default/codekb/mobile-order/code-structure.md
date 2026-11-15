# Code Structure

## ディレクトリ構成と分類
| パス | 分類 | 内容 |
|------|------|------|
| `contracts/types.ts` | Model | 共通型(Order, MenuItem, DailySales, ORDER_TRANSITIONS, DB_COLUMNS) |
| `contracts/ownership.ts` | Configuration | 書き込み担当表・API 読み取り依存(契約テストが使用) |
| `contracts/openapi.json` | Static | OpenAPI 3.0.3 契約(`Error` スキーマを含む) |
| `contracts/test/*.test.ts`, `helpers.ts` | Test | 契約テスト 0〜3 と `freshApp` 等のヘルパー |
| `server/src/app.ts` | Configuration | `buildApp`: 3 ルートプラグインを登録するのみ |
| `server/src/index.ts` | Configuration | 起動(DB を開き、空ならシード、listen) |
| `server/src/routes/customer.ts` | Controller | UA ルート(`HttpError`, `parseLines`, `setErrorHandler` を内包) |
| `server/src/routes/kitchen.ts` | Controller | UB ルート(`setErrorHandler`, 例外→HTTP 変換を内包) |
| `server/src/routes/manager.ts` | Controller | UC ルート(`parseMenuInput`, `setErrorHandler` を内包) |
| `server/src/db/db.ts` | Configuration/Utility | `openDb`, `tx`(BEGIN IMMEDIATE) |
| `server/src/db/queries.ts` | Repository | 読み取り専用クエリ |
| `server/src/db/transition.ts` | Service | `transitionOrder` + ドメインエラー 2 種 |
| `server/src/db/{schema.sql,seed.ts,reset.ts,time.ts}` | Migration/Utility | スキーマ・シード・JST 時刻 |
| `web/src/main.tsx` | Configuration | パスでロール画面を切替 |
| `web/src/shared/api.ts` | Utility | 型付き fetch ラッパー `api.get/post/put/patch` |
| `web/src/{customer,kitchen,manager}/` | UI | 各ロール画面(`manager/` は MenuPanel, SalesPanel, format.ts, css) |
| `e2e/`, `server/test/*/` | Test | E2E 14 / ユニット 69 |
| `scripts/mutation-check.ts` | Utility | 手動の変異検査 |

## コードパターン
- ESM + TypeScript strict。サーバーは Fastify プラグイン(`FastifyPluginAsync<{ db }>`)
- エラー処理パターン(重複箇所)は `code-quality-assessment.md` に一元記載。API の面は `api-documentation.md`
