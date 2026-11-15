# Bolt 計画

Bolt = 1ユニットを「ドメイン設計 → 論理設計 → コード → テスト」まで回す短いサイクル。

## 実行順

| Wave | Bolt | ユニット | 並列 | 完了条件 |
|------|------|---------|------|---------|
| 0 | B0 | U0 Contracts + Walking Skeleton | 単独 | 下記「B0 完了条件」をすべて満たす |
| 1 | B1 | UA 客 | ✅ | C1〜C3 の受入基準を満たす。API テスト合格。**契約テスト 0〜3 が緑** |
| 1 | B2 | UB 厨房 | ✅ | K1〜K3 の受入基準を満たす。遷移ルールのテスト合格。**契約テスト 0〜3 が緑** |
| 1 | B3 | UC 店長 | ✅ | M1〜M3 の受入基準を満たす。集計テスト合格。**契約テスト 0〜3 が緑** |
| 0.1 | B0.1 | U0 契約・共通ファイルの修正(Wave 1 からの差戻し。Issue #10) | 単独 | 契約テスト緑・ミューテーション全検出。Wave 1 の変更要望のうち対応するものを反映。ユニットの実装ファイルは変更しない。**B1〜B3 のマージ後、B4 の前に実施** |
| 2 | B4 | 結合確認 | 単独 | 契約テスト 0〜3 の全件再実行(B0 で保留した項目を含む)+ E2E: 客が注文 → 厨房が完成 → 店長の売上に反映。売り切れ設定が客に反映 |

### B0 完了条件(すべて必須)
1. 客画面のボタン → `POST /orders` → DB → 厨房画面に表示、が手動で動く
2. `contracts/` に型・OpenAPI・**DB 書き込み担当表**(`02-units.md`)が揃い、レビュー承認済み
3. スキーマ・シード・DB トリガー(不変列、遷移制限)が入っている
4. **契約テスト 0〜3 が実装され、緑**(`contracts/test/`。内容は `02-units.md`)
   - 0: 書き込み担当表の強制(トリガー + 静的検査)
   - 1: UA↔UC `menu_items` の列定義と反映
   - 2: UA→UB `orders.status` の値と初期状態
   - 3: UB→UC 売上は `READY` のみ
5. テストを意図的に壊して(例: 列名変更、`PLACED→READY` を許可、売上に `COOKING` を含める)赤になることを確認済み
6. `npm run test:contracts` 1コマンドで全件実行できる

B1〜B3 は編集ファイルが重ならないため同時実行できる。モックは不要(U0 の実サーバーとシードで動く)。

## 各 Bolt の編集範囲(これ以外は触らない)

| Bolt | 編集してよい場所 |
|------|----------------|
| B0 | `contracts/`(`contracts/test/` を含む)、`server/src/app.ts`、`server/src/db/`、`web/` のシェル、スケルトン用スタブ |
| B1 | `server/src/routes/customer.ts`、`server/test/customer/`、`web/src/customer/` |
| B2 | `server/src/routes/kitchen.ts`、`server/test/kitchen/`、`web/src/kitchen/` |
| B3 | `server/src/routes/manager.ts`、`server/test/manager/`、`web/src/manager/` |
| B4 | 各ユニットのバグ修正のみ(修正箇所と原因を記録)、`e2e/` |

## 並列実行の約束事
1. `contracts/`(契約テスト・書き込み担当表を含む)、`schema.sql`、`app.ts`、`web/` のシェルは Wave 1 中は**読み取り専用**。変更が要るなら当該 Bolt を止めて B0 に差戻し。契約テストが赤になったら、テストを直さず実装側を直す
2. 各 Bolt のテストは自分の DB ファイル(`data/test-<unit>.db`)で実行し、他 Bolt と干渉しない
3. 開発サーバーは共有しない。各 Bolt は自分のポートで API を起動(UA=3001, UB=3002, UC=3003)。Web は `web/` を各自の dev ポートで起動
4. 終了時に `aidlc-docs/construction/BOLT-REPORT-<unit>.md`(決定事項、契約への疑問、未解決)を残す

## ディレクトリ構成(予定)
```
contracts/
server/src/{app.ts, db/, routes/{customer,kitchen,manager}.ts}
server/test/{customer,kitchen,manager}/
web/src/{customer,kitchen,manager}/
e2e/
aidlc-docs/{inception,construction}/
```

## 観察ポイント
- B0 に何を入れすぎ/足りなかったか(B1〜B3 が差戻しを要求した回数)。Wave 1 では 5 件の要望が出て、B0.1 で 3 件を対応、2 件を backlog にした(分類は `BOLT-REPORT-U0.1.md`)
- B4 で見つかった不整合のうち、契約・スキーマで防げたもの
- 縦割りにしたことで B1〜B3 の作業量が均等になったか
