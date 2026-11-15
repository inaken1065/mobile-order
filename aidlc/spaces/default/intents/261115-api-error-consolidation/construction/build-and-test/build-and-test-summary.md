# Build and Test Summary: ApiError の共通化とエラーハンドラの集約

入力は、Code Generation の `code-generation-plan.md`、`unit-test-instructions.md`、`code-summary.md` です。実行結果の詳細は `test-results.md`、手順は `build-instructions.md` にあります。

## 全体の状態

| 項目 | 結果 |
|---|---|
| ビルド(`npm run build:web`) | 成功 |
| 型検査(`npm run typecheck`) | エラー0件 |
| 契約テスト | 27本、すべて通過 |
| ユニットテスト | 78本(既存69 + 新規9)、すべて通過 |
| web テスト | 13本(新規)、すべて通過 |
| E2E | 14本、すべて通過 |
| 既存テストの書き換え | なし |

## テスト種別の一覧

| 種別 | 作ったもの |
|---|---|
| 単体テスト | web 13本、server 9本(Code Generation で作成) |
| 統合テスト・性能テスト・セキュリティテスト | 作っていない(Minimal 戦略のため。追加の手順書は不要) |
| 既存の契約テスト、ユニットテスト、E2E | そのまま実行(書き換えなし) |

## カバレッジの期待

プロジェクトにカバレッジの計測設定と下限はありません。`refactor` 範囲は追加の下限なしで、既存のテストを通すことが条件です。

## Target Verification Matrix

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| TC-SUITE | Testing Contract: scope_floor「既存のテストを通す」 | 既存の契約27、ユニット69、E2E 14 が、書き換えなしで通る | 27/27、69/69、14/14 通過。既存テストの差分は0 | `test-results.md`、`git diff acb1b58 HEAD -- contracts/test server/test/customer server/test/kitchen server/test/manager e2e` が空 | build-and-test | Met |
| TC-VOLUME | Testing Contract: strategy_volume「要件ごとに1本、検証できる最小の層で」 | FR1.1〜FR3.4 の各要件に、検証するテストか確認がある | 新規22本。`cross-unit-traceability.md` のとおり、全要件に対応する実装かテストがある | `cross-unit-traceability.md` | build-and-test | Met |
| TC-HAPPY | Testing Contract: strategy_volume「コンポーネントごとに正常系1本以上」 | `ApiError`、全体ハンドラ、web の失敗の受け取り、エラー文言の関数、それぞれに正常系のテスト | `web/test/api-error.test.ts`、`server/test/app/error-handler.test.ts`、`web/test/api.test.ts`、`web/test/error-text.test.ts` に各1本以上 | `test-results.md`(web 13本、server 新規9本の通過) | build-and-test | Met |
| NFR1 | `requirements.md` NFR1(互換性) | 応答の形と status は、受け入れ済みの変更を除いて変わらない。存在しないルートの 404 は標準の形式で、`e2e/e2e.test.ts:251` が無修正で通る | E2E 14/14、既存の客・厨房・店長のテスト78本中の既存69本が通過。受け入れ済みの変更(壊れた JSON、503、空メッセージの 4xx)は新しいテストで固定 | `test-results.md`、`server/test/app/error-handler.test.ts` | build-and-test | Met |
| NFR2 | `requirements.md` NFR2(検証可能性) | `npm test` が全件通る(失敗0件、スキップは変更前と同数)。web のテストを含む | 失敗0件、スキップ0件(変更前もスキップ0件) | `test-results.md` | build-and-test | Met |
| NFR3 | `requirements.md` NFR3(型の健全性) | `npm run typecheck` がエラー0件 | エラー0件 | `test-results.md` | build-and-test | Met |
| NFR4 | `requirements.md` NFR4(保守性) | `setErrorHandler` の定義が `server/src` に1か所、`ApiError` の定義が1か所 | どちらも1か所(`server/src/app.ts:27`、`contracts/api-error.ts:3`) | `test-results.md` の「保守性の確認」 | build-and-test | Met |

CI の実行は、`refactor` 範囲の Testing Contract に求められていません。このため、対象の行はありません。カバレッジの下限もありません。

## 準備状況

| 観点 | 状態 |
|---|---|
| ビルド | 準備できている(`npm run build:web` と `npm run typecheck` が成功) |
| テスト | 準備できている(全テストが通る) |
| デプロイ | この変更は、API の応答の形と画面の表示を、受け入れ済みの変更を除いて変えていません。デプロイの手順は、後続のステージで扱います |

## 既知の制限と残っている項目

- 画面の描画テストとブラウザ操作は行っていません(Q3: A の方針)。画面の分岐は、`fetch` を差し替えたテストと、切り出した関数のテストで固定しています
- 5xx のログ出力(`req.log.error`)を確かめるテストがありません(Code Generation のレビュー指摘 R-01)。バックログ Issue #17 として登録済みです
- 厨房画面の "Error: " 接頭辞の除去は、今回の対象外で、Issue #15 として登録済みです
- `README.md` に書かれている本数(契約27、ユニット69、E2E 14)は、今回のテスト追加(ユニット78、web 13)に合わせて更新していません。`README.md` は元からあるファイルで、依頼がないため触っていません
- `npm test` は E2E を含みません。E2E は別のコマンドで実行します(`build-instructions.md` 参照)
