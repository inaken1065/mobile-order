# Mobile Order

飲食店向けモバイルオーダーの **AI-DLC 学習用サンプル**。「ユニット分割」と「Bolt の並列実行」を体験することが目的。

- 客: スマホでメニューを見て注文し、調理状況を確認する
- 厨房: 注文を受け取り、調理中 → 完成とステータスを進める
- 店長: メニュー・価格・売り切れを管理し、売上を確認する

現在は **B0(U0 Contracts + Walking Skeleton)完了**の状態。客画面のボタン → `POST /orders` → DB → 厨房画面の表示までが最小限で通る。UA(客)・UB(厨房)・UC(店長)の本実装は B1〜B3 で行う。

計画の詳細は `aidlc-docs/inception/`(`01-intent-and-stories.md` / `02-units.md` / `03-bolt-plan.md`)、B0 の結果は `aidlc-docs/construction/BOLT-REPORT-U0.md`。

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
| 店長画面 | http://localhost:5173/manager(B0 ではプレースホルダ) |
| API(直接) | http://localhost:3000(例: http://localhost:3000/menu) |
| API(Web 経由) | http://localhost:5173/api/...(例: http://localhost:5173/api/menu) |

Web は `/api` を API サーバーへプロキシする(`/api/menu` → `GET /menu`)。

動作確認の流れ: 客画面でメニューの「注文する」を押す → 呼出番号が表示される → 厨房画面(2秒ごとに更新)に `PLACED` の注文が現れる。

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
npm run test:contracts   # 契約テスト 0〜3(25件)
npm run mutation:check   # 契約テストが壊れた実装を検出できるかの確認(19変異)
npm run typecheck        # サーバー・契約・Web の型チェック
npm run build:web        # Web のビルド(web/dist)
```

契約テストは `contracts/test/` にあり、ユニット間の暗黙の結合を検証する。

| テスト | 検証内容 |
|--------|---------|
| 0 | 書き込み担当表の強制(DB トリガー・ルートの静的検査・OpenAPI の `x-owner`) |
| 1 | UA ↔ UC: `menu_items` の列定義と、メニュー変更の反映 |
| 2 | UA → UB: `orders.status` の値と初期状態、厨房一覧の並び |
| 3 | UB → UC: 売上は `READY` の注文だけを `completed_at` の日付で集計 |

**Wave 1 の各 Bolt は、完了前にこれが全部緑であることを確認する。赤になったらテストではなく実装を直す。**

## ディレクトリ構成と編集してよい範囲

```
contracts/                 U0: 型、OpenAPI、書き込み担当(ownership.ts)、契約テスト
server/src/app.ts          U0: サーバー骨格(ルートの登録のみ)
server/src/db/             U0: スキーマ(トリガー込み)、シード、共有クエリ、transitionOrder
server/src/routes/
  customer.ts              UA: 客のルート
  kitchen.ts               UB: 厨房のルート
  manager.ts               UC: 店長のルート
server/test/{customer,kitchen,manager}/   各ユニットの自前テスト(B1〜B3 で作成)
web/                       U0: Vite + React のシェル(main.tsx、shared/api.ts、設定)
web/src/customer/          UA: Customer UI
web/src/kitchen/           UB: Kitchen UI
web/src/manager/           UC: Manager UI
e2e/                       B4: 結合確認(B4 で作成)
scripts/                   U0: ミューテーション検査
aidlc-docs/                計画と Bolt 報告書
```

| Bolt | 編集してよい場所 |
|------|----------------|
| B0(U0) | `contracts/`、`server/src/app.ts`、`server/src/db/`、`web/` のシェル、スケルトンのスタブ |
| B1(UA 客) | `server/src/routes/customer.ts`、`server/test/customer/`、`web/src/customer/` |
| B2(UB 厨房) | `server/src/routes/kitchen.ts`、`server/test/kitchen/`、`web/src/kitchen/` |
| B3(UC 店長) | `server/src/routes/manager.ts`、`server/test/manager/`、`web/src/manager/` |
| B4(結合) | 各ユニットのバグ修正のみ(修正箇所と原因を記録)、`e2e/` |

並列実行中(Wave 1)は、`contracts/`・`schema.sql`・`app.ts`・`web/` のシェルは**読み取り専用**。変更が必要になったら該当 Bolt を止めて B0 に差し戻す。

### DB の書き込み担当(要約)

| テーブル | 書き込める | ルール |
|---------|-----------|--------|
| `menu_items` | UC のみ | UA・UB は読み取りのみ |
| `orders` | INSERT は UA、status / completed_at の UPDATE は UB | INSERT 時は `PLACED`。更新は `transitionOrder()` 経由のみ。他の列は不変、DELETE 不可 |
| `order_lines` | UA が INSERT のみ | 注文時点の名前・単価のスナップショット。UPDATE / DELETE 不可 |

UC は `orders` / `order_lines` に書き込まない(集計は SELECT のみ)。強制はトリガーと静的検査で行う。正本は `aidlc-docs/inception/02-units.md`。

## API 規約

エンドポイント一覧とスキーマの正本は `contracts/openapi.json`。

| エンドポイント | 担当 | B0 の状態 |
|---------------|------|----------|
| `GET /menu` | UA | 実装済み(スタブ) |
| `POST /orders` | UA | 実装済み(スタブ。売り切れ判定なし) |
| `GET /orders/{id}` | UA | 実装済み |
| `GET /kitchen/orders?status=` | UB | 実装済み |
| `PATCH /kitchen/orders/{id}/status` | UB | 未実装(B2) |
| `POST /manager/menu`、`PUT /manager/menu/{id}`、`PATCH /manager/menu/{id}/availability` | UC | 未実装(B3) |
| `GET /manager/sales/daily?date=` | UC | 実装済み(スタブ) |

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
  | 400 | 入力不正(必須項目なし、数量不正、未知の `menu_item_id`、不正な `status` / `date`) |
  | 404 | 対象が存在しない |
  | 409 | 状態が許さない(不正なステータス遷移、売り切れ商品の注文。後者は UA の本実装で追加) |

  Fastify 自身が返すエラー(壊れた JSON など)は `{ statusCode, code, error, message }` という別の形になる。必要なら B1〜B3 で統一する。
- **注文時点のスナップショット**: `order_lines` の `name` と `unit_price` は注文時点の値で、後でメニューを変更しても変わらない
- **売上**: `READY` の注文だけを `completed_at` の日付で集計する
