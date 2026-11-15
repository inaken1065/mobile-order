# Component Inventory

## contracts
責務: 共通型・書き込み担当表・OpenAPI。依存: なし(server と web が import)。

## server-app
責務: `server/src/app.ts` の `buildApp`(プラグイン登録)。依存: 3 ルート。全体エラーハンドラ・NotFound ハンドラなし。

## customer-routes
責務: UA の API(`server/src/routes/customer.ts`)。内包: `HttpError`、`parseLines`、プラグイン内 `setErrorHandler`。依存: `db/db`, `db/queries`, `db/time`。

## kitchen-routes
責務: UB の API(`server/src/routes/kitchen.ts`)。内包: プラグイン内 `setErrorHandler`、ドメインエラーの HTTP 変換。依存: `db/transition`, `db/queries`。

## manager-routes
責務: UC の API(`server/src/routes/manager.ts`)。内包: `parseMenuInput`、プラグイン内 `setErrorHandler`。依存: `db/time`。

## db-layer
責務: `server/src/db/`(接続・`tx`・読み取りクエリ・`transitionOrder`・ドメインエラー 2 種・シード)。

## web-api-client
責務: `web/src/shared/api.ts`(型付き fetch、失敗時 `Error` を throw)。依存: ブラウザ fetch。利用元: 3 画面すべて。

## customer-ui
責務: `web/src/customer/`(注文・追跡)。内包: `parseApiError`(status を正規表現で復元)。

## kitchen-ui
責務: `web/src/kitchen/index.tsx`(注文カンバン)。エラー表示は `String(e)`。

## manager-ui
責務: `web/src/manager/`(MenuPanel, SalesPanel)。エラー表示は `e.message`。

## tests
責務: `contracts/test/`、`server/test/`、`e2e/`。
