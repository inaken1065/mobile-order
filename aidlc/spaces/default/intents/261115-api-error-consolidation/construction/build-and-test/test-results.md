# Test Results: ApiError の共通化とエラーハンドラの集約

実行日: 2026-11-15。ブランチ `refactor/error-handling`(コード: `e26aaec`、文書を含む最新: `4d10560`)。
手順は `build-instructions.md`、単体テストの手順は `unit-test-instructions.md`、実装の内容は `code-summary.md` にあります。

## ビルド

| コマンド | 結果 |
|---|---|
| `npm run build:web` | 成功(終了コード 0)。26モジュールを変換し、`web/dist/` に `index.html`、CSS、JS を出力 |
| `npm run typecheck` | 成功(終了コード 0)。ルートと `web/tsconfig.json` の2つとも、エラー0件 |

## テスト

| 対象 | コマンド | 本数 | 通過 | 失敗 | スキップ |
|---|---|---|---|---|---|
| 契約テスト | `npm test`(`test:contracts`) | 27 | 27 | 0 | 0 |
| ユニットテスト | `npm test`(`test:units`) | 78(既存69 + 新規9) | 78 | 0 | 0 |
| web テスト | `npm test`(`test:web`) | 13(すべて新規) | 13 | 0 | 0 |
| E2E | `node --import tsx --test "e2e/*.test.ts"` | 14 | 14 | 0 | 0 |
| 契約テスト 0(書き込み担当の静的検査) | `node --import tsx --test "contracts/test/test0-write-ownership.test.ts"` | 13 | 13 | 0 | 0 |

`npm test` の終了コードは 0 です。契約テスト 0 は、契約テストの27本に含まれています。

## 変更前との比較

| 対象 | 変更前(Code Generation の Step 1) | 変更後 |
|---|---|---|
| 契約テスト | 27本、すべて通過 | 27本、すべて通過 |
| ユニットテスト | 69本、すべて通過 | 78本、すべて通過(新規9本) |
| web テスト | (なし) | 13本、すべて通過(新規) |
| E2E | 14本、すべて通過 | 14本、すべて通過 |
| 型検査 | エラー0件 | エラー0件 |

既存のテスト(`contracts/test`、`server/test/customer`、`server/test/kitchen`、`server/test/manager`、`e2e`)は、元の `main`(`acb1b58`)から書き換えていません。`git diff acb1b58 HEAD` の差分は0件です。回帰はありません。

## 失敗の詳細

なし。

## カバレッジ

このプロジェクトには、カバレッジの計測設定も下限もありません(`refactor` 範囲は、追加の下限なしで、既存のテストを通すこと)。計測は行っていません。

## 保守性の確認(NFR4)

| 確認 | 結果 |
|---|---|
| `grep -rn "setErrorHandler" server/src` | 1か所(`server/src/app.ts:27`) |
| `grep -rn "class ApiError" contracts server web` | 1か所(`contracts/api-error.ts:3`) |

## Target Verification Matrix の最終結果

`build-and-test-summary.md` の表に、同じ内容を記録しています。`Pending` は残っていません。

## Loop-Back Log

なし(失敗がなかったため、戻りは発生していません)。

## ブラウザの動作について

画面の動きは、Node 上で、`fetch` を差し替えたテストと、画面から切り出した関数のテストで確認しています。実際のブラウザ(Chromium など)では動かしていません。ブラウザでの確認が必要な要件はありません(画面の表示文言と分岐は、置き換え前と同じ文字列を返す関数のテストで固定しています)。
