# Code Summary: ApiError の共通化とエラーハンドラの集約

計画(`code-generation-plan.md`)の Step 1〜9 を実装しました。変更はブランチ `refactor/error-handling` にあります。

- 区切り A(現状を固定するテストまで): `a3ce758`
- 区切り B(エラー型と全体ハンドラ): `e26aaec`

## 変更前の基準(Step 1)

変更前のコードで、次のとおり全部通ることを確認しました。

| 項目 | 結果 |
|---|---|
| 契約テスト(`contracts/test`) | 27本、27本通過、失敗0 |
| ユニットテスト(`server/test`) | 69本、69本通過、失敗0 |
| E2E(`e2e/*.test.ts`) | 14本、14本通過、失敗0 |
| `npm run typecheck` | エラー0件 |

## 変更後の結果(Step 9)

| 項目 | 結果 |
|---|---|
| 契約テスト | 27本、27本通過(うち契約テスト 0 は13本、全部通過) |
| ユニットテスト | 78本(既存69 + 新規9)、78本通過 |
| web テスト | 13本(新規のみ。固定する11本 + 新規2本)、13本通過 |
| E2E | 14本、14本通過 |
| `npm run typecheck` | エラー0件 |
| 既存テストの書き換え | なし(`contracts/test`、`server/test/customer`、`server/test/kitchen`、`server/test/manager`、`e2e` の差分は0) |
| `setErrorHandler` の定義数 | `server/src` に1か所(`app.ts`) |
| `ApiError` の定義数 | 1か所(`contracts/api-error.ts`) |

## 変更したファイル

### 新規

| ファイル | 内容 |
|---|---|
| `contracts/api-error.ts` | 共通の `ApiError`(`status`、`message`、`detail`。`name` は既定の `Error`) |
| `web/src/shared/error-text.ts` | 画面から切り出した、エラーの判定と文言の関数(客画面の判定、厨房・店長画面の文言) |
| `web/test/error-text.test.ts` | 現状を固定するテスト(8本) |
| `web/test/api.test.ts` | `api.ts` が投げるエラーの文言を固定するテスト(3本) |
| `web/test/api-error.test.ts` | `ApiError` のテスト(2本) |
| `server/test/app/error-handler.test.ts` | 全体ハンドラのテスト(9本) |

### 変更

| ファイル | 内容 |
|---|---|
| `server/src/app.ts` | 全体の `errorHandler` を追加し、ルートプラグインの登録の前に設定。「Wave 1 中は読み取り専用」のコメントを直した |
| `server/src/routes/customer.ts` | `HttpError` を `ApiError` に置き換え、プラグインの `setErrorHandler` を削除 |
| `server/src/routes/kitchen.ts` | プラグインの `setErrorHandler` と、`transitionOrder` の `try/catch` を削除 |
| `server/src/routes/manager.ts` | プラグインの `setErrorHandler` を削除し、先頭のコメントを直した |
| `web/src/shared/api.ts` | 失敗した応答から `ApiError` を投げる。コメントを直した |
| `web/src/customer/index.tsx` | `parseApiError`(正規表現)を、`error-text.ts` の関数に置き換え |
| `web/src/kitchen/index.tsx`、`web/src/manager/MenuPanel.tsx`、`web/src/manager/SalesPanel.tsx` | エラー文言を `error-text.ts` の関数で組み立てる(表示は同じ) |
| `package.json` | `test:web` を追加し、`npm test` が contracts、units、web の順に実行する |
| `tsconfig.json` | include に `web/test` を追加 |

`web/tsconfig.json` は変更していません(`contracts/api-error.ts` は import で解決されました)。`contracts/types.ts` と、元からあるファイル(`README.md`、`aidlc-docs/` など)も触っていません。

## 実装上の主な判断

- 全体ハンドラは `app.ts` の `errorHandler` という名前付きの関数にしました。本番の `buildApp` と、テストが同じ関数を使うためです。判定の順は、`OrderNotFoundError`(404)、`InvalidTransitionError`(409)、`ApiError.status`、`statusCode`(数値)、500 です。400〜499 では `{ error: メッセージ }`(メッセージが空なら `bad request`)、それ以外はログを出して 500 の `internal server error` を返します。
- 客画面の判定は、`ApiError` なら `status` と、`detail`(空なら `message`)を使います。`ApiError` でないもの(通信の失敗など)は、status 無しで `message` を使います。
- 子プラグインがルート直下のエラーハンドラを引き継ぐことは、既存の客・厨房・店長・E2E のテストが、書き換えなしで通ったことで確認しました(要件定義のレビュー指摘 R-04)。
- 書き込み SQL の位置は動かしていません(契約テスト 0 は全部通過)。

## 計画からの差異

- **存在しないルートへの 415 の確認**: 計画 Step 8 では、「存在しないルートに非対応の content-type を送ると 415 で `{ error }` の形」を確認する予定でした。実際には、Fastify は存在しないルートに対して、content-type を調べる前に 404 を返しました。そのため、このテストは実在するルート(`POST /orders`)で行い、415 で `{ error }` の形(`statusCode` と `code` を含まない)になることを確認しています。存在しないルートに壊れた JSON を送ると 400 で `{ error }` の形になることは、予定どおり確認しました。
  - 機能設計(`functional-spec.md` の第2章、`rules.md` の BR2.7)は、存在しないルートへの「壊れた JSON や非対応の content-type」の 4xx が変わるとしていました。実際に変わるのは、このうち存在しないルートへの壊れた JSON の 400 だけです。非対応の content-type の 415 は、実在するルートでは変更前からプラグインのハンドラで `{ error }` の形だったので、変わりません。
- 上記以外に、設計の応答の表との違いは見つかりませんでした。

## 実行しなかったテスト

- 画面の描画テストとブラウザ操作は行っていません(計画どおり。ブラウザ自動化の依存を追加しないため)。画面の動きは、切り出した関数と `api.ts` のテストで固定しています。
- 画面を実際に開いての手動確認は、この段階では行っていません。
