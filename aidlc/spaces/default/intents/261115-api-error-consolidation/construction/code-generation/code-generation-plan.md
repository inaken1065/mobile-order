# Code Generation Plan: ApiError の共通化とエラーハンドラの集約

## Summary

- Builds: 共通の `ApiError` と、`app.ts` の全体エラーハンドラ1つ。web の失敗の受け取り方もそれに合わせる(応答と表示文言は変えない)
- Touches: `contracts/api-error.ts`(新規)、`server/src/app.ts`、`server/src/routes/{customer,kitchen,manager}.ts`、`web/src/shared/`、`web/src/{customer,kitchen,manager}/`、`package.json`、`tsconfig.json`
- Tests: 新規 約17本(web 約9本、server 約8本)。変更前に web の現状を固定する分を先に追加し、既存テスト(契約27、ユニット69、E2E 14)は書き換えない

## 入力と方針

- 入力: `requirements.md`(FR1〜FR3、NFR1〜NFR4)、`functional-spec.md`、`rules.md`(BR1.1〜BR4.6)、`entities.md`、`frontend-components.md`、現状のコード調査(`code-quality-assessment.md`)
- ユニット分割は無く、1つのまとまりとして1回で実装します
- 既存のファイルはその場で変更します(複製を作りません)。`README.md`、`aidlc-docs/` などの元からあるファイルは、必要がない限り触りません
- 進め方の順序は、利用者の指示(FR3)に従い、「変更前の確認 → 現状を固定するテスト → 変更 → 変更後のテスト」とします。テスト戦略は Minimal、ordering は test-after(下の Testing Contract)です。変更前に固定する分は、既存の動きを対象にした新しいテストで、変更後の実装でも同じ内容のまま通ります
- ブラスト半径: 変更するファイルの利用側は、サーバーの3ルートプラグインと3つの画面です。サーバーの書き込み SQL の位置は変えません(契約テスト 0b)。影響は、エラー処理を通る応答すべて(中)ですが、応答は設計どおり変えません

## Testing Contract

```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "org",
  "ordering": "implement each applicable testable layer, then write and run that layer's tests.",
  "scope": "refactor",
  "test_strategy": "minimal",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    }
  ],
  "obligations": {
    "strategy": "minimal",
    "strategy_volume": [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "test-after",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - implement.",
      "Data model / database behavior - write and run its tests after implementation.",
      "Repository / data access - implement.",
      "Repository / data access - write and run its tests after implementation.",
      "Business logic - implement.",
      "Business logic - write and run its tests after implementation.",
      "API / endpoint - implement.",
      "API / endpoint - write and run its tests after implementation.",
      "Frontend behavior - implement.",
      "Frontend behavior - write and run its tests after implementation.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:06c12367ad8c44802c849bfad1d351bad9312bf5dfa96742a3ea92f337cd806c",
  "contract_sha256": "sha256:be24de49065e6c54a26024b4a9117dabfa3bc2a5a7d4774a9ade02b7d86b1894"
}
```

データモデル(DB)とリポジトリ(データ取得)の層は、この変更では変わらないので対象外です。対象の層は、ビジネスロジック(エラー型と変換)、API(全体ハンドラとルート)、フロントエンド(失敗の受け取りと表示文言)、構成(テストの実行方法)です。

## 実装ステップ

### 変更前の確認

- [x] Step 1: 変更前の基準を取る(BR4.1、FR3.1)。`npm test`、`npm run typecheck`、`node --import tsx --test "e2e/*.test.ts"` を実行し、本数と結果を記録する(`code-summary.md` に残す)。落ちるテストがあれば、変更に入らず報告する。コミットは行わない
- [x] Step 2: web 側のテストを動かす土台を整える(BR4.5、FR3.2)。`package.json` に `test:web`(`node --import tsx --test "web/test/*.test.ts"`)を追加し、`npm test` を contracts、units、web の順にする。`web/test/` を作り、ルートの `tsconfig.json` の include に `web/test` を加える。既存のテストランナー(`node:test`)を使い、新しい依存は追加しない。単体の実行コマンドは `unit-test-instructions.md` に記録する。この時点では web のテストが0本でも `npm test` が失敗しない形にする(テストファイルが無いときの扱いを確認する)

### 変更前に動きを固定する(フロントエンド)

- [x] Step 3: 画面から、エラーの判定と文言の組み立てを、動きを変えずに小さな関数へ切り出す(Q3: A、BR3.1、BR3.2)。`web/src/shared/error-text.ts`(新規、描画する部分は読み込まない)に、客画面の判定(現状の `parseApiError` と同じ動き)、厨房画面の文言(`String(e)`)、店長画面の文言(`Error` なら `message`、それ以外は `String(e)`)を置き、`web/src/customer/index.tsx`、`web/src/kitchen/index.tsx`、`web/src/manager/MenuPanel.tsx`、`web/src/manager/SalesPanel.tsx` から呼ぶ。画面の表示は変えない。`npm run typecheck` が通ることを確認する
- [x] Step 4: 現状を固定するテストを書き、変更前のコードで通す(BR4.2、FR3.2)。`web/test/error-text.test.ts`(客の 404/409/status 無し、`sold out: ` の除去、`detail` が空のときの文言、厨房の `"Error: ..."`、店長の `Error`/非 `Error`)と `web/test/api.test.ts`(`fetch` を差し替え、失敗応答で投げられるエラーの `message` が `<METHOD> <path> -> <status> <error>`、本文が読めない・`error` が無いときは末尾の空白なし、成功応答は本文を返す)。この2ファイルは、Step 7 の置き換え後も、内容を変えずに通ることを条件にする。`npm run test:web` と `npm test` が通ることを確認する
- [ ] 区切り A: ここまでで `npm test`、`npm run typecheck`、E2E が全部通る。通ったらコミットする(`refactor/error-handling` へ)

### エラー型と全体ハンドラ(ビジネスロジック、API)

- [ ] Step 5: ビジネスロジック。`contracts/api-error.ts`(新規)に `ApiError`(`status`、`message`、`detail`。`name` は既定のまま、BR1.1)を追加する(FR1.1)。`web/tsconfig.json` の include は、`npm run typecheck` が通らない場合だけ更新する(許可済み)
- [ ] Step 6: API。`server/src/app.ts` に全体の `setErrorHandler` を、ルートプラグインの登録より前に1つ置く(BR2.1〜BR2.5、FR2.1)。`DomainError`(`OrderNotFoundError` → 404 `order not found`、`InvalidTransitionError` → 409 `invalid transition: <from> -> <to>`)、`ApiError`、それ以外の `statusCode`(400〜499 なら通し、メッセージが未定義または空なら `bad request`、それ以外は 500 と `internal server error` を `req.log.error` で記録)の順に判定する。`server/src/routes/customer.ts` の `HttpError` を `ApiError` に置き換え(BR1.3、FR1.2)、3つのルートプラグインの `setErrorHandler` を削除する(FR2.2)。`server/src/routes/kitchen.ts` の `try/catch` による変換を削除し、`transitionOrder` の結果をそのまま返す(BR2.4、FR2.4)。書き込み SQL の位置は動かさない(BR4.4、FR3.4)。`app.ts` の「Wave 1 中は読み取り専用」コメントを実態に合わせて直す(Q4: A)。`contracts/types.ts` は触らない
- [ ] Step 7: フロントエンド。`web/src/shared/api.ts` が、失敗した応答から `ApiError` を投げる(BR1.2、FR1.3)。`status` は応答の status、`detail` は応答本文の `error`(読めなければ空)、`message` は「`<METHOD> <path> -> <status> <detail>`」の前後の空白を除いたもの。コメントを実態に合わせて直す(Q4: A)。`web/src/shared/error-text.ts` の判定を、正規表現ではなく `ApiError` の `status` と `detail` を使うように置き換える(BR3.1、FR1.4)。厨房・店長の文言の関数は、置き換え前と同じ文字列を返す(BR3.2、FR1.5)。Step 4 の2つのテストファイルを、書き換えずに通す

### 変更後のテスト

- [ ] Step 8: 変更後の動きを確認するテストを追加する(BR4.6、FR3.2)。`server/test/app/error-handler.test.ts`(新規。`server/test/*/*.test.ts` に一致する置き場所)に、次を入れる。全体ハンドラの status と本文(`ApiError` の 400/404/409)、メッセージが空の 4xx で `bad request`、4xx 以外が 500 と `internal server error`(Fastify 内部の 503 を含む)、`OrderNotFoundError` と `InvalidTransitionError` の 404/409、存在しないルートの 404 が標準の形式のままであること、存在しないルートに壊れた JSON を送ると 400 で `{ error }` の形、非対応の content-type を送ると 415 で `{ error }` の形(受け入れ済みの変更の固定)。`ApiError` 自体(`String(e)` が `"Error: ..."` になる、`status` と `detail` を持つ)は `web/test/api-error.test.ts`(新規)で確認する
- [ ] Step 9: 全体を確認する。`npm test`、`npm run typecheck`、`node --import tsx --test "e2e/*.test.ts"` が、既存テストを書き換えずに全部通ること(FR3.3、NFR2、NFR3)。`setErrorHandler` が `server/src` に1か所だけ、`ApiError` の定義が1か所だけであることを `grep` で確認する(NFR4)。同じコードを3つのプラグインが引き継ぐこと(R-04 の確認)は、既存テストの結果で確認する
- [ ] 区切り B: ここまでで全部通る。通ったらコミットする

### まとめ

- [ ] Step 10: 文書とトレーサビリティ。`code-summary.md`(変更したファイル、変更前の基準の結果、実行できなかったテストとその理由)と `traceability.json` を作る。実装コードや `README.md` などの元からあるファイルへの文書の追加は、必要がなければ行わない

## 要件との対応

| 要件 | 対応する Step |
|---|---|
| FR1.1 | 5 |
| FR1.2 | 6 |
| FR1.3 | 7 |
| FR1.4 | 3、7 |
| FR1.5 | 3、4、7 |
| FR1.6 | 5、6(ドメインエラーは `ApiError` の派生にしない) |
| FR2.1 | 6 |
| FR2.2 | 6 |
| FR2.3 | 6、8 |
| FR2.4 | 6、8 |
| FR3.1 | 1 |
| FR3.2 | 2、4、8 |
| FR3.3 | 9 |
| FR3.4 | 6、9 |
| NFR1 | 6、8、9 |
| NFR2 | 9 |
| NFR3 | 2、9 |
| NFR4 | 9 |
