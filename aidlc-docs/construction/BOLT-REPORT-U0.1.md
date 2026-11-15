# BOLT REPORT: B0.1 (U0 契約・共通ファイルの修正)

Issue: #10 / ブランチ: `bolt/b0-1-contracts` / 前提: PR #7・#8・#9 マージ済み(`main` = 29124f4)

Wave 1(B1〜B3)から出た共通ファイル・契約への変更要望を、U0 の持ち物として一括で処理した。ユニットの実装ファイル(`routes/*`、`web/src/<role>/`、`server/test/<role>/`)は変更していない。

## 完了条件の結果

| 条件 | 結果 |
|------|------|
| 契約テストが緑(0d を含む) | `npm run test:contracts` 27件 全通過(B0 の 25件 + 0d の 2件) |
| ミューテーション全検出 | `npm run mutation:check` 22変異すべて検出(B0 の 19件 + 0d 関連 3件) |
| 統合状態でユニットテスト | `npm run test:units` 69件 全通過(UA 15 + UB 14 + UC 40)。`npm test` で契約 + ユニットを一括実行 |
| 型チェック / ビルド | `npm run typecheck` / `npm run build:web` 成功 |
| 実装ファイルを変更していない | 変更は `contracts/`、`package.json`、`README.md`、`scripts/`、`aidlc-docs/` のみ |

## Wave 1 から出た要望の分類(「B0 に足りなかったもの」の記録)

| # | 要望 | 出典 | 分類 | 対応 |
|---|------|------|------|------|
| 1 | `package.json` にユニットテスト用スクリプト | B1・B2・B3 | 開発基盤の不足(B0 は契約テストしか想定していなかった) | **B0.1 で対応**(`test:units`、`test`) |
| 2 | OpenAPI に 400 レスポンス未定義(kitchen・manager 系、`GET /kitchen/orders`) | B2・B3 | 契約の記述漏れ(B0 時点では実装がなく書けなかった) | **B0.1 で対応** |
| 3 | UC が UA の `GET /menu` に依存(店長用一覧 API なし) | B3 | 設計上の暗黙依存(B0 の「暗黙の結合」3点に含まれていなかった) | **B0.1 で対応**: `GET /menu` が全件を返すことを契約化し、担当表・`API_READ_DEPENDENCIES`・OpenAPI `x-read-by`・テスト 0d に記載 |
| 4 | `ApiError` の共通化(`web/src/shared/api.ts`) | B1 | 共通基盤の品質(動作はしている) | backlog(Issue #11)。3 ユニットの UI 改修が必要 |
| 5 | エラーハンドラの `app.ts` への集約 | B1・B2 | 共通基盤の品質(各ユニットで重複) | backlog(Issue #12)。3 ユニットのルート改修が必要 |

加えて、各ユニットが決めた事項(呼出番号の日次リセット、重複行の合算、同一状態遷移の 409 など)を `02-units.md` の「Wave 1 で確定した決定事項」と OpenAPI に昇格させた。

### 振り返りメモ
- 要望 3 が最も本質的。DB の書き込み担当表では防げない「API を介した暗黙の読み取り依存」が縦割りで生じた。B0 の契約テストは DB 経由の結合(3 点)しか見ておらず、API 経由の結合は想定外だった
- 要望 1・2 は B0 時点では原理的に書けなかった(実装がまだない)。契約の「後から埋まる部分」を B0 完了条件で明示しておけば、差戻しではなく計画内の作業にできた
- Wave 1 を止めずに済んだのは、いずれも「後から追加可能」な変更だったため。契約の**変更**が必要な差戻し(スキーマ変更など)は発生しなかった

## 変更内容
- `package.json`: `test:units`、`test`
- `contracts/openapi.json`: 400 の追記、`GET /menu` の全件保証と `x-read-by: ["UC"]`、各操作の説明(合算・日次リセット・id 不正は 404 など)
- `contracts/ownership.ts`: `API_READ_DEPENDENCIES`
- `contracts/test/test0-write-ownership.test.ts`: テスト 0d(宣言の双方向一致、保証の検証)
- `scripts/mutation-check.ts`: 0d 関連の変異 3 件
- `aidlc-docs/inception/02-units.md`: API 読み取り依存、暗黙の結合 4、Wave 1 の決定事項、テスト 0d
- `aidlc-docs/inception/03-bolt-plan.md`: B0.1 の行、観察ポイント
- `README.md`: 実装状況・テスト手順・API 規約・読み取り依存

## 未対応(backlog)
- #11 `ApiError` の共通化、#12 エラーハンドラの集約

## B4 への申し送り
- 未定義ルートの 404 は Fastify 標準の形式のまま
- UI の自動テストはない(E2E で扱う)
- 契約テスト 1(c)(売り切れ商品の 409)は UA の受入テストが検証済み。B4 で結合状態で再確認
