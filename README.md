# Mobile Order

飲食店向けモバイルオーダーの **AI-DLC 学習用サンプル**。「ユニット分割」と「Bolt の並列実行」を体験することが目的。

- 客: スマホでメニューを見て注文し、調理状況を確認する
- 厨房: 注文を受け取り、調理中 → 完成とステータスを進める
- 店長: メニュー・価格・売り切れを管理し、売上を確認する

現在は **B0〜B3 と B0.1(契約・共通ファイルの修正)が完了**した状態。客・厨房・店長の API と UI が揃っている。残りは B4(結合確認・E2E)。

計画の詳細は `aidlc-docs/inception/`(`01-intent-and-stories.md` / `02-units.md` / `03-bolt-plan.md`)、各 Bolt の結果は `aidlc-docs/construction/BOLT-REPORT-*.md`。

## 前提

- **Node.js 24 以上**(動作確認は 24.x)。SQLite は Node 組込みの `node:sqlite` を使うため、ネイティブビルドは不要。起動時に「SQLite は実験的」という警告が出るが問題ない
- npm 10 以上
- 外部の DB やサービスは不要(SQLite のファイル `data/app.db` を使う)

## インストールと起動

```bash
npm install          # 依存関係のインストール
npm run db:reset     # DB を作成してシードデータ(メニュー12品、各ステータスの注文)を投入
npm run dev:server   # API サーバーを起動(ターミナル 1)
npm run dev:web      # Web を起動(ターミナル 2)
```

`db:reset` は `data/app.db` を作り直す(既存データは消える)。実行しなくても、空の DB で `dev:server` を起動すれば自動でシードされる。

## 起動後に開く URL

| 画面 | URL |
|------|-----|
| トップ(各画面へのリンク) | http://localhost:5173/ |
| 客画面 | http://localhost:5173/customer |
| 厨房画面 | http://localhost:5173/kitchen |
| 店長画面 | http://localhost:5173/manager |
| API(直接) | http://localhost:3000(例: http://localhost:3000/menu) |
| API(Web 経由) | http://localhost:5173/api/...(例: http://localhost:5173/api/menu) |

Web は `/api` を API サーバーへプロキシする(`/api/menu` → `GET /menu`)。

動作確認の流れ: 客画面でメニューを選んで「注文を確定する」 → 呼出番号が表示される → 厨房画面(2秒ごとに更新)の「受付」に注文が現れる → 「調理開始」「完成」で進める(客画面のステータスも更新される) → 店長画面の「売上」に完成した注文が反映される。

### 環境変数

| 変数 | 既定値 | 対象 |
|------|--------|------|
| `PORT` | `3000` | API の待受ポート |
| `DB_PATH` | `data/app.db` | API / `db:reset` の SQLite ファイル(`:memory:` 可) |
| `WEB_PORT` | `5173` | Web の dev ポート |
| `API_PORT` | `3000` | Web のプロキシ先 API ポート |

Bolt を並列実行するときは、Bolt ごとにこれらを変えて干渉を避ける(例: UA は `PORT=3001 DB_PATH=data/ua.db`、Web は `API_PORT=3001 WEB_PORT=5174`)。

## テスト

```bash
npm test                 # 契約テスト + ユニットテスト + Web のテスト(下の3つをまとめて実行)
npm run test:contracts   # 契約テスト 0〜3(27件)
npm run test:units       # サーバーのテスト(server/test/<role>/ の各ユニットの受入テストと、server/test/app/ の全体エラーハンドラのテスト、78件)
npm run test:web         # Web のテスト(web/test/、エラーの受け取りと表示文言、13件)
npm run mutation:check   # 契約テストが壊れた実装を検出できるかの確認(22変異)
npm run typecheck        # サーバー・契約・Web の型チェック
npm run build:web        # Web のビルド(web/dist)
```

契約テストは `contracts/test/` にあり、ユニット間の暗黙の結合を検証する。

| テスト | 検証内容 |
|--------|---------|
| 0 | 書き込み担当表の強制(DB トリガー・ルートの静的検査・OpenAPI の `x-owner`)と、API 読み取り依存(`x-read-by`)の宣言漏れ検出 |
| 1 | UA ↔ UC: `menu_items` の列定義と、メニュー変更の反映 |
| 2 | UA → UB: `orders.status` の値と初期状態、厨房一覧の並び |
| 3 | UB → UC: 売上は `READY` の注文だけを `completed_at` の日付で集計 |

**各 Bolt は、完了前にこれが全部緑であることを確認する。赤になったらテストではなく実装を直す。**

## ディレクトリ構成と編集してよい範囲

```
contracts/                 U0: 型、OpenAPI、書き込み担当(ownership.ts)、契約テスト、共通のエラー型(api-error.ts)
server/src/app.ts          U0: サーバー骨格(全体のエラーハンドラとルートの登録)
server/src/db/             U0: スキーマ(トリガー込み)、シード、共有クエリ、transitionOrder
server/src/routes/
  customer.ts              UA: 客のルート
  kitchen.ts               UB: 厨房のルート
  manager.ts               UC: 店長のルート
server/test/{customer,kitchen,manager}/   各ユニットの受入テスト
server/test/app/           全体エラーハンドラのテスト
web/                       U0: Vite + React のシェル(main.tsx、shared/api.ts、shared/error-text.ts、設定)
web/test/                  Web のテスト(エラーの受け取りと表示文言)
web/src/customer/          UA: Customer UI
web/src/kitchen/           UB: Kitchen UI
web/src/manager/           UC: Manager UI
e2e/                       B4: 結合確認(B4 で作成)
scripts/                   U0: ミューテーション検査
aidlc-docs/                計画と Bolt 報告書
```

| Bolt | 編集してよい場所 |
|------|----------------|
| B0 / B0.1(U0) | `contracts/`、`server/src/app.ts`、`server/src/db/`、`web/` のシェル、`package.json`、`README.md`、`aidlc-docs/` |
| B1(UA 客) | `server/src/routes/customer.ts`、`server/test/customer/`、`web/src/customer/` |
| B2(UB 厨房) | `server/src/routes/kitchen.ts`、`server/test/kitchen/`、`web/src/kitchen/` |
| B3(UC 店長) | `server/src/routes/manager.ts`、`server/test/manager/`、`web/src/manager/` |
| B4(結合) | 各ユニットのバグ修正のみ(修正箇所と原因を記録)、`e2e/` |

並列実行中は、`contracts/`・`schema.sql`・`app.ts`・`web/` のシェルは**読み取り専用**。変更が必要になったら該当 Bolt を止めて B0(B0.1 のように別 Issue・別 PR)に差し戻す。

### DB の書き込み担当(要約)

| テーブル | 書き込める | ルール |
|---------|-----------|--------|
| `menu_items` | UC のみ | UA・UB は読み取りのみ |
| `orders` | INSERT は UA、status / completed_at の UPDATE は UB | INSERT 時は `PLACED`。更新は `transitionOrder()` 経由のみ。他の列は不変、DELETE 不可 |
| `order_lines` | UA が INSERT のみ | 注文時点の名前・単価のスナップショット。UPDATE / DELETE 不可 |

UC は `orders` / `order_lines` に書き込まない(集計は SELECT のみ)。強制はトリガーと静的検査で行う。正本は `aidlc-docs/inception/02-units.md`。

### API の読み取り依存

**UC(Manager UI)は、メニュー一覧の取得に UA 所有の `GET /menu` を読み取りで使う**(店長用の一覧 API は持たない)。そのため `GET /menu` は**売り切れを含む全件**を返す契約で、UA は絞り込み・除外をしてはならない。この依存は `contracts/ownership.ts` の `API_READ_DEPENDENCIES` と OpenAPI の `x-read-by` に宣言され、契約テスト 0d・1c が守っている。保証を変えるときは B0 に差し戻す。

## API 規約

エンドポイント一覧とスキーマの正本は `contracts/openapi.json`。

| エンドポイント | 担当 | 備考 |
|---------------|------|------|
| `GET /menu` | UA | 売り切れを含む**全件**を返す(UC が読み取りで依存) |
| `POST /orders` | UA | 売り切れ商品を含むと 409。重複行は合算 |
| `GET /orders/{id}` | UA | |
| `GET /kitchen/orders?status=` | UB | 古い順 |
| `PATCH /kitchen/orders/{id}/status` | UB | 1段階ずつ進める。不正な遷移は 409 |
| `POST /manager/menu`、`PUT /manager/menu/{id}`、`PATCH /manager/menu/{id}/availability` | UC | メニュー管理・売り切れ設定 |
| `GET /manager/sales/daily?date=` | UC | `READY` の注文のみ集計 |

- **形式**: リクエスト・レスポンスとも JSON(`content-type: application/json`)。認証はない(学習用)
- **名前**: フィールドは snake_case で、DB の列名と同じ。例外として `is_available` は API では boolean(DB は 0/1)
- **一覧のレスポンス**: 配列をそのまま返さずオブジェクトで包む。`{ "items": [...] }`(メニュー)、`{ "orders": [...] }`(注文)
- **金額**: 税込の円。整数
- **日時**: ISO 8601・JST の文字列。例 `2026-11-15T12:00:00+09:00`。日次集計の「日付」は先頭10文字(`YYYY-MM-DD`)で判定する
- **ステータス**: `PLACED` → `COOKING` → `READY` のみ。逆戻り・飛ばしは不可。`completed_at` は `READY` への遷移と同時にのみ設定され、それ以外は `null`
- **エラー形式**: `{ "error": "<メッセージ>" }`

  | ステータス | 意味 |
  |-----------|------|
  | 200 / 201 | 成功 / 作成成功 |
  | 400 | 入力不正(必須項目なし、数量不正、未知の `menu_item_id`、メニュー入力の検証エラー、不正な `status` / `date`) |
  | 404 | 対象が存在しない(`id` が整数でない場合も 404) |
  | 409 | 状態が許さない(逆戻り・飛ばし・同一状態のステータス遷移、売り切れ商品の注文) |
  | 5xx | `{ "error": "internal server error" }`(内部情報は返さない) |

  ルートで起きるエラー(壊れた JSON を含む)は、上の `{ "error": ... }` 形式に揃えている。`server/src/app.ts` の全体エラーハンドラ1つが、客・厨房・店長のすべてのルートに適用される。HTTP の失敗を表すエラー型は `contracts/api-error.ts` の `ApiError`(`status`、`message`、`detail`)で、サーバーが投げるときと、Web が失敗した応答から作るときの両方で使う。**存在しないルートへのリクエスト(404)だけは Fastify 標準の形式**(`{ message, error, statusCode }`)のまま。ただし、存在しないルートに壊れた JSON を送ったときの 400 は、`{ "error": ... }` の形になる。メッセージの無い 4xx は `"bad request"`、4xx 以外は 500 の `"internal server error"` になる。
- **注文時点のスナップショット**: `order_lines` の `name` と `unit_price` は注文時点の値で、後でメニューを変更しても変わらない
- **売上**: `READY` の注文だけを `completed_at` の日付で集計する。数量・金額は注文時点のスナップショット単価で計算する
- **呼出番号**: 当日(JST)内で 1 から採番(日次リセット)
- **Wave 1 で確定した決定事項**の一覧は `aidlc-docs/inception/02-units.md`(「Wave 1 で確定した決定事項」)
