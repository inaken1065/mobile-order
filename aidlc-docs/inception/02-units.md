# ユニット分割(ロール単位の縦割り版)

## 分割方針
- **縦割り**: 1ユニット = 1ロールの機能を API ルートから UI まで通しで持つ
- **単一デプロイ**: API サーバー 1つ、DB 1つ(SQLite)。ロールごとにルートモジュールを分ける
- **並列性の源泉**: U0 が実 API サーバー・実 DB・シードデータを先に用意するため、モックなしで B1〜B3 が同時に動ける
- 売上は `orders` から `status = READY` を DB 集計する(イベント・結果整合性なし)

## ユニット一覧

| ID | ユニット | 持つもの | ストーリー |
|----|---------|---------|-----------|
| U0 | Contracts + Walking Skeleton | 共通型、OpenAPI、DB スキーマ、シード、サーバー骨格、Web シェル、最小貫通 | (土台) |
| UA | 客 | メニュー閲覧 API、注文作成 API、注文照会 API + Customer UI | C1, C2, C3 |
| UB | 厨房 | 注文一覧 API、ステータス更新 API + Kitchen UI | K1, K2, K3 |
| UC | 店長 | メニュー管理 API、売り切れ設定 API、売上集計 API + Manager UI | M1, M2, M3 |

## U0: Contracts + Walking Skeleton

**成果物**
- `contracts/`: 型(MenuItem, Order, OrderLine, OrderStatus)、OpenAPI(下記全エンドポイント)
- `server/src/db/schema.sql` + シードスクリプト(メニュー十数品、各ステータスの注文、完成済み注文の履歴)
- `server/src/app.ts`: Fastify 骨格。`routes/customer.ts` `routes/kitchen.ts` `routes/manager.ts` を登録するだけ(中身は各ユニットが書く)
- `web/`: Vite + React のシェル。`/customer` `/kitchen` `/manager` の3ルート、各 `src/<role>/` はプレースホルダ

**ウォーキングスケルトン(最小貫通)**
客画面のボタン → `POST /orders` → orders テーブルに INSERT → 厨房画面が `GET /orders` で表示。
バリデーション、売り切れ判定、スタイル、エラー処理はすべて省略。UA/UB が自分の領域のスタブを本実装に置き換える。

## エンドポイントと所有ルート

| ルートモジュール | エンドポイント | 担当 |
|----------------|---------------|------|
| `routes/customer.ts` | `GET /menu` ・ `POST /orders` ・ `GET /orders/{id}` | UA |
| `routes/kitchen.ts` | `GET /kitchen/orders?status=` ・ `PATCH /kitchen/orders/{id}/status` | UB |
| `routes/manager.ts` | `POST /manager/menu` ・ `PUT /manager/menu/{id}` ・ `PATCH /manager/menu/{id}/availability` ・ `GET /manager/sales/daily?date=` | UC |

## DB 書き込み担当表(U0 契約)

列名は B0 で確定する。**新しい列を足す場合も、この表に担当を書かなければ追加できない**。
「U0」はスキーマ作成・シード投入のみ(実行時の書き込みではない)。

### `menu_items`

| 列 | INSERT | UPDATE | DELETE | 読み取り |
|----|--------|--------|--------|---------|
| `id` | UC | 不可(不変) | UC | UA, UB, UC |
| `name` / `category` / `price` | UC | UC | UC | UA, UC |
| `is_available`(売り切れ) | UC | **UC のみ** | — | UA, UC |
| `created_at` / `updated_at` | UC | UC | — | UC |

→ **UA・UB は `menu_items` に書き込めない**(売り切れ判定は読むだけ)。
→ UC の UI は、メニュー一覧の**読み取りに UA 所有の `GET /menu` を使う**(UC は書き込み専用のルートしか持たない)。これは読み取り依存として次々節「API 読み取り依存」に明記する。

### `orders`

| 列 | INSERT | UPDATE | 読み取り |
|----|--------|--------|---------|
| `id` / `call_number` / `created_at` / `total` | UA | 不可(不変) | UA, UB, UC |
| `status` 初期値 `PLACED` | **UA のみ**(INSERT 時に固定) | — | UA, UB, UC |
| `status` `PLACED→COOKING`、`COOKING→READY` | — | **UB のみ**(逆戻り・飛ばしは不可) | UA, UB, UC |
| `completed_at` | NULL 固定 | **UB のみ**。ただし **READY への遷移と同時にのみ設定**(READY 以外の status では常に NULL)。READY 後は変更不可 | UC(集計の日付基準) |

- `orders` の DELETE は誰も不可
- 日時は ISO 8601・JST(`2026-11-15T12:00:00+09:00`)の文字列で保存。日次集計の「日付」は先頭10文字で判定する

### `order_lines`

| 列 | INSERT | UPDATE | DELETE | 読み取り |
|----|--------|--------|--------|---------|
| 全列(`order_id` / `menu_item_id` / `name` / `unit_price` / `qty`) | UA(注文と同一トランザクション) | 不可 | 不可 | UA, UB, UC |

- `name` と `unit_price` は注文時点のスナップショット。以後 UC が価格を変えても動かない
- ステータス遷移ルールは U0 の共有関数 `transitionOrder()` に置き、UB はそれ経由でのみ更新する
- UC は `orders` / `order_lines` に**一切書き込まない**(集計は SELECT のみ)
- スキーマ変更は **U0(B0)の責務**。並列期間中に必要になったら Bolt を止めて差戻す

### 担当表の強制方法(B0 で実装)
1. **DB トリガー**:
   - `orders` は `status` と `completed_at` 以外の列の UPDATE を拒否(`id` / `call_number` / `total` / `created_at` は不変)
   - INSERT は `status = PLACED` かつ `completed_at IS NULL` のみ許可
   - `status` の UPDATE は隣接遷移(`PLACED→COOKING`、`COOKING→READY`)のみ許可
   - `completed_at` は「READY になる UPDATE で必ず設定され、READY 以外では必ず NULL、READY 後は変更不可」
   - `orders` の DELETE、`order_lines` の UPDATE/DELETE を拒否
2. **静的検査**: ルートファイルごとの書き込み SQL/リポジトリ関数の許可リスト(下記テスト 0)
3. 実行時のユニット識別は行わない(1プロセス・1DB のため)。ユニット境界はトリガーと静的検査で守る

## API 読み取り依存(U0 契約)

DB の書き込み担当表とは別に、「他ユニットが所有するルートを読み取りで使う」関係を明示する。
機械可読な正本は `contracts/ownership.ts` の `API_READ_DEPENDENCIES` と OpenAPI の `x-read-by`。

| 利用側 | 所有側 | ルート | 所有側が守る保証 | 強制 |
|--------|--------|--------|-----------------|------|
| **UC**(Manager UI) | **UA** | `GET /menu` | 売り切れ(`is_available=false`)を**含む全件**を返す。絞り込み・除外をしない | 契約テスト 0d(宣言の一致)・1c(全件を返す) |

- UC は店長用のメニュー一覧 API(`GET /manager/menu`)を持たず、UA の `GET /menu` を**読み取りのみ**で使う。UC の画面はこの保証に依存している
- 書き込みは従来どおり UC の `PUT/POST/PATCH /manager/menu...` だけ。UA のルートへの書き込み依存はない
- 保証を変えたい場合(例: UA が売り切れを非表示にする)は UA 単独で変えず、**B0 に差し戻して**契約と UC の追随を決める
- この依存を増やす場合は、`API_READ_DEPENDENCIES` と OpenAPI の `x-read-by` の両方に追記する(片方だけだと契約テスト 0d が赤になる)

## ユニット間の暗黙の結合(縦割りで残るもの)
1. UA ↔ UC: `menu_items` の列定義(UC が書き、UA が読む)
2. UA → UB: `orders.status` の初期値 `PLACED` と、UB が見る status の値
3. UC ← UA/UB: 売上は `READY` の注文のみ。UB が READY にしないと UC の数字が動かない
4. UC → UA(API): UC の UI が UA 所有の `GET /menu` の「全件を返す」保証に依存している(前節)

→ いずれも U0 のスキーマ・書き込み担当表・契約テストで固定する(次節)。

## Wave 1 で確定した決定事項(契約)

B1〜B3 の実装中に各ユニットが決めた事項のうち、他ユニットや B4 に影響するものを契約として固定する(OpenAPI にも記載)。

| 領域 | 決定 | 決めた Bolt |
|------|------|------------|
| 呼出番号 | 当日(JST)内で `MAX + 1`(日次リセット)。UNIQUE 制約はなく、`BEGIN IMMEDIATE` のトランザクションで重複を防ぐ | B1 |
| 注文の明細 | 同一 `menu_item_id` の重複行は1行に合算。`qty` の上限なし | B1 |
| 注文の原子性 | 売り切れ判定・採番・INSERT は同一トランザクション。400 / 409 では `orders` / `order_lines` に何も残らない | B1 |
| 注文照会 | `id` が整数でなければ 404 | B1 |
| ステータス更新 | 同一状態への遷移も 409。`id` が整数でなければ 404。`status` の欠落・不正値・型違いは 400(404 より先に評価) | B2 |
| メニュー入力 | `name` / `category` は trim 後に非空、`price` は 0 以上の整数、`is_available` は boolean。PUT で `is_available` 省略時は現在値を維持、POST で省略時は販売中。`id` が整数でなければ 404 | B3 |
| 売上の集計 | `date` 形式不正・存在しない日付は 400。数量・金額は `order_lines` のスナップショット単価で集計(後から価格を変えても過去売上は不変) | B3 |
| エラー形式 | ユニットのルート内のエラー(壊れた JSON を含む)は `{ "error": メッセージ }`。5xx は内部情報を出さず `internal server error`。未定義ルートの 404 のみ Fastify 標準の形式(Issue #12) | B1〜B3 |

テストでの担保: 各決定は B1〜B3 の受入テスト(`server/test/<role>/`)で検証されている。契約テストの対象は他ユニットが依存するもの(DB の担当、`GET /menu` の全件保証、status 値、売上の対象)に限る。

## U0 契約テスト(`contracts/test/`)

B0 の完了条件。Wave 1 中は読み取り専用で、**B1〜B3 は自分の Bolt 完了前にこれが全部通ることを確認する**。B4 でも再実行する。
UA/UC が未実装の B0 時点では、スケルトンのスタブとシードに対して実行する(売上エンドポイントは READY のみを集計する最小スタブを `routes/manager.ts` に置く。UC が置換)。

| # | 検証する結合 | テスト内容 |
|---|-------------|-----------|
| 0 | 担当表そのもの | (a) トリガー: `orders` の `status` / `completed_at` 以外の列の UPDATE、`order_lines` の UPDATE/DELETE、`orders` の DELETE、`PLACED` 以外での INSERT、`PLACED→READY` / `READY→COOKING` 等の不正遷移が全て DB に拒否される(全 status 組合せを `ORDER_TRANSITIONS` と突き合わせ)。`status` と `completed_at` の正当な更新は通る。**`completed_at` は READY 遷移と同時にのみ設定される**: READY 以外で値を持つ UPDATE、READY への遷移で NULL のままの UPDATE、READY 後の変更は拒否され、`transitionOrder()` は COOKING では NULL、READY では指定時刻を設定する。(b) 静的検査: `routes/customer.ts` は `menu_items` への書き込みなし・`orders` は INSERT のみ、`routes/kitchen.ts` は `orders.status/completed_at` 以外への書き込みなし、`routes/manager.ts` は `orders` / `order_lines` への書き込みなし |
| 0d | API 読み取り依存 | `ownership.ts` の `API_READ_DEPENDENCIES` と OpenAPI の `x-read-by` が双方向で一致する(宣言漏れ・過剰宣言を検出)。依存先のルートが存在し、`x-owner` が所有ユニットと一致する。保証(`GET /menu` が売り切れを含む全件を返す)が守られている |
| 1 | UA ↔ UC `menu_items` | (a) スキーマの列名・型・NULL 可否が `contracts` の `MenuItem` 型と一致。(b) UC 相当の書き込み(価格変更・`is_available=0`)後、`GET /menu` に反映される。(c) 売り切れ商品を含む `POST /orders` が拒否される(スケルトンでは判定省略のため、B0 では `is_available` が `/menu` に出ることのみ検証し、拒否は B1 の受入に回す。B1 で実装済みで、UA の受入テストが検証する。B4 で再確認)。(d) 注文後に価格を変えても、既存注文の `order_lines.unit_price` は不変 |
| 2 | UA → UB `orders.status` | (a) status の取りうる値が、`contracts` の列挙・OpenAPI・DB の CHECK 制約で完全一致。(b) `POST /orders` で作った注文は `PLACED` で、`GET /kitchen/orders?status=PLACED` に出る。(c) 厨房一覧が古い順に並ぶ |
| 3 | UB → UC 売上 | シードに `PLACED` / `COOKING` / `READY` を混ぜ、売上は `READY` のみ集計。`transitionOrder()` で `COOKING→READY` にすると売上が当該注文の `total` ちょうど増える。`PLACED` / `COOKING` では増えない。`completed_at` の日付で日次集計される |

テスト 1(c) と 3 の一部は、UA/UC の本実装後でないと検証できない。その分は B1/B3 の受入テストに引き継ぎ、B4 の E2E で再確認する。

## 横割り(前版)との比較メモ
- 良い点: ロールごとにストーリーが完結し、デモ可能な単位になる。結合が API 境界でなくテーブル境界に寄る
- 代償: UI 共通部品・DB スキーマが共有物になり、U0 に責務が集中する。ルートモジュール内でも共有テーブルへの書き込み権限の線引きが必要
