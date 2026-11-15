## Developer Code Scan Results

### Scan Coverage
- **Analyzed deeply**:
  - `contracts/` (types.ts, ownership.ts, openapi.json, test/)
  - `server/` (src/app.ts, src/index.ts, src/db/, src/routes/, test/)
  - `web/` (index.html, src/, tsconfig.json, vite.config.ts)
  - `e2e/`
  - `scripts/`
  - `package.json`, `tsconfig.json`, `README.md`
  - `aidlc-docs/` (inception, construction, retrospective: 背景確認のため backlog 該当箇所のみ grep)
- **Skimmed only**: `package-lock.json`(依存の版数確認のみ。中身は未精査)
- **Left out**: `node_modules/`, `data/`(.gitignore 対象の SQLite 実体), `web/dist/`(存在せず), AI-DLC 自身のインストール(`.claude/`, `aidlc/`, `aidlc.settings.json`, `.gitignore` の AI-DLC マーカー区間)

### Packages Found
- mobile-order(ルート) — npm パッケージ(`"type": "module"`, private) — TypeScript — API サーバー + Web + 契約 + E2E を 1 パッケージに同居(workspaces なし)
- `server/` — Fastify 5 API — TypeScript — 客(UA)・厨房(UB)・店長(UC)の 3 ルートプラグイン + SQLite(`node:sqlite`)
- `web/` — Vite + React 19 SPA — TypeScript/TSX — `/customer` `/kitchen` `/manager` の 3 画面
- `contracts/` — 共有契約 — TypeScript/JSON — 型・書き込み担当表・OpenAPI・契約テスト(server と web の両方が import)

### Build System
- **Type**: npm scripts(tsx / vite / tsc)
- **Config Files**: `package.json`, `tsconfig.json`(server/contracts/scripts), `web/tsconfig.json`, `web/vite.config.ts`
- **Build Dependencies**: web → contracts/types.ts(型のみ import)。server → contracts/types.ts。契約テスト → server(`buildApp`)。e2e → 実プロセスの server

### APIs Discovered
- REST(Fastify) — `server/src/routes/customer.ts` — 3 本(GET /menu, POST /orders, GET /orders/:id)
- REST(Fastify) — `server/src/routes/kitchen.ts` — 2 本(GET /kitchen/orders, PATCH /kitchen/orders/:id/status)
- REST(Fastify) — `server/src/routes/manager.ts` — 4 本(POST /manager/menu, PUT /manager/menu/:id, PATCH /manager/menu/:id/availability, GET /manager/sales/daily)
- 契約: `contracts/openapi.json`(OpenAPI 3.0.3。エラー形式は `components.schemas.Error = { error: string }`)

### Frameworks & Libraries
- fastify — ^5.12.8 — HTTP サーバー
- react / react-dom — ^19.3.1 — UI
- vite ^8.3.8 / @vitejs/plugin-react ^6.3.0 — Web ビルド・dev サーバー(`/api` プロキシ)
- tsx ^4.23.15 / typescript ^7.0.2 / @types/* — 実行・型検査
- `node:sqlite`(Node 24+ 組込み)、`node:test`(テストランナー)

### Test Coverage
- **Test Directories**: `contracts/test/`(4 ファイル, 契約テスト), `server/test/{customer,kitchen,manager}/`(3 ファイル), `e2e/e2e.test.ts`
- **Test Frameworks**: `node:test` + `node:assert/strict`、Fastify `app.inject`
- **Coverage Config**: absent(カバレッジ計測なし)。`scripts/mutation-check.ts` で手動の変異検査あり
- Web(React)側のテストはなし

### Code Quality Indicators
- **Linting**: なし(ESLint/Prettier 設定ファイルなし)。`npm run typecheck`(tsc strict)のみ
- **CI/CD**: なし(`.github/` なし)
- **Documentation**: README.md が詳細(起動手順・API・エラー形式)。`aidlc-docs/` に計画・Bolt 報告・振り返り。コード内コメント(日本語)は良好

### Technical Debt Signals
- **`ApiError` という名前のクラス/型はリポジトリに存在しない**。バックログ #11 の「ApiError」は未実装の目標像(`aidlc-docs/construction/BOLT-REPORT-UA.md:43`)。現状の相当物は下記 3 系統
- サーバー側のエラー型が 3 箇所に分散・重複:
  - `server/src/routes/customer.ts:10` `class HttpError extends Error { statusCode }`(客ルート専用・非 export)
  - `server/src/db/transition.ts:8,14` `OrderNotFoundError` / `InvalidTransitionError`(厨房用・export。厨房ルートが `instanceof` で 404/409 に手動変換 `kitchen.ts:49-53`)
  - `manager.ts` は独自エラークラスなし(`reply.code(...).send({ error })` を直接呼ぶ。`Parsed` 判別共用体で検証エラーを返す)
- `setErrorHandler` が 3 つのプラグインスコープに重複(`app.ts` には無い):
  - `customer.ts:43-48`(4xx はメッセージを通し、5xx は `internal server error`。`app.log.error`)
  - `kitchen.ts:19-28`(同等だが `req.log.error`、`e.message ?? 'bad request'` のフォールバックあり)
  - `manager.ts:61-69`(`statusCode` 400–499 のみ通し、それ以外は 500。`app.log.error`)
  - 細部の差(ログ呼び出し、`statusCode` 範囲判定、メッセージのフォールバック)が 3 実装でバラバラ
- 未定義ルートの 404 はハンドラ無しのため Fastify 標準形式 `{ message, error, statusCode }`(`e2e/e2e.test.ts:251` に特性テストで固定。README:152 に既知と明記)。`app.ts` に `setNotFoundHandler` なし
- ルート内のインライン `reply.code(N).send({ error })` が 18 箇所(`server/src/routes/*`)
- クライアント側のエラー表現と解析の重複:
  - `web/src/shared/api.ts:9-11` が `new Error("<METHOD> <path> -> <status> <error>")` と文字列化(status/本文が構造化されていない)
  - `web/src/customer/index.tsx:38-42` `parseApiError` が正規表現 `/-> (\d{3}) ?(.*)$/` で status を復元(使用箇所: 55, 98, 141 行)
  - 他画面は別方式: `kitchen/index.tsx:111,133` は `String(e)`("Error: ..." 接頭辞が付く)、`manager/MenuPanel.tsx:91,118` と `manager/SalesPanel.tsx:19` は `e instanceof Error ? e.message : e`
  - 事実上 `customer.tsx` だけが status を使う(404 で保存 ID を破棄、409 で売り切れ処理)
- 契約・テストとの結合: `contracts/openapi.json` の `Error` スキーマ、`server/test/manager/manager.test.ts:44-45` などが `{ error: string }` を検査。`contracts/ownership.ts` + 契約テスト 0b が `routes/customer|kitchen|manager` の接頭辞でファイル単位に SQL 書き込みを検査するため、共通ファイル新設・移動時はパス前提(`server/src` 相対)に注意
- `contracts/types.ts` と `app.ts` / `web/src/shared/api.ts` は「U0 契約: 変更は B0 に差し戻す」と明記された共通ファイル(コメントは「Wave 1 中は読み取り専用」)。現在は Wave 1 終了後でバックログ対応対象
- 型検査の経路が 2 つ(`tsconfig.json` は contracts/server/scripts、`web/tsconfig.json` は web/src + contracts/types.ts のみ)。web から server 側ファイルは import できず、`contracts/` が共通化先の唯一の候補
- Lint/CI/カバレッジ未整備、`web/` にテストなし

## Handoff Summary
- **Intent-relevant finding**: 「ApiError」は未存在で、(a) サーバー: `HttpError`(`server/src/routes/customer.ts:10`)+ `OrderNotFoundError`/`InvalidTransitionError`(`server/src/db/transition.ts:8,14`)、(b) クライアント: `web/src/shared/api.ts:9-11` の文字列 `Error` と `web/src/customer/index.tsx:38` `parseApiError` の正規表現復元、に分散。エラーハンドラは `customer.ts:43` / `kitchen.ts:19` / `manager.ts:61` の 3 重複で、`server/src/app.ts` には全体ハンドラも `setNotFoundHandler` も無い
- **Risks / follow-up**: (1) 共通 `ApiError` を server・web 双方が import できる場所は `contracts/`(web tsconfig は `../contracts/types.ts` のみ include のため、新ファイル追加時は `web/tsconfig.json` の include 更新が必要)。(2) 未定義 404 形式を変えると `e2e/e2e.test.ts:251` の特性テスト更新が必須。(3) エラー応答形式 `{ error: string }` は OpenAPI・契約テスト・README と整合させる必要がある(wire 形式は維持が前提)。(4) 契約テスト 0b は `server/src/routes/{customer,kitchen,manager}` のパスと SQL 書き込み位置を静的検査するので、エラー処理のみの移動でも書き込み SQL の位置は変えないこと。(5) 回帰検出は `npm test`(契約 27 + ユニット 69)と E2E 14 に依存し、web にテストは無い
