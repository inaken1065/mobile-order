# Requirements: ApiError の共通化とエラーハンドラの集約

## Intent analysis

Initial description: 既存のモバイルオーダーアプリに対して、バックログ2件（ApiError の共通化、エラーハンドラの集約）を対応したい

目的は、エラー処理の重複と不統一をなくし、保守しやすくすることです。利用者から見た動き(API の応答、画面の表示文言)は変えません。

- バックログ #11(`ApiError` の共通化): サーバー側の `HttpError` と、web 側の文字列化された `Error` を、共通のエラー型にまとめる。出典は `business-overview.md` の「本 intent に関わる背景」にある Issue #11
- バックログ #12(エラーハンドラの集約): 3つのルートプラグインに重複する `setErrorHandler` を、`app.ts` の全体ハンドラ1つにまとめる。出典は同 Issue #12
- 現状の重複箇所は `code-quality-assessment.md` に一元記載されています。構成は `architecture.md`、ファイル配置は `code-structure.md` を参照しました
- 進め方の方針(エラーの形を変えない、変更前にテストを固めるなど)は、Reverse Engineering 承認時にいただいた指示と、質問 Q1〜Q4 の回答が出典です。質問と回答は `requirements-analysis-questions.md` にあります

## Functional requirements

### FR1. 共通エラー型 `ApiError`

- FR1.1: `contracts/` に実行時クラス `ApiError`(`status` と `message` を持つ)を、新規ファイルで追加する。サーバーと web の両方がここから import する。`web/tsconfig.json` の include を、この新規ファイルを含むよう更新してよい (Q1: A)
- FR1.2: サーバーの客ルート(`server/src/routes/customer.ts`)の `HttpError` を `ApiError` に置き換える。投げる status(400/404/409)とメッセージは現状と同じにする (Q1: A)
- FR1.3: web の `web/src/shared/api.ts` は、HTTP が失敗したとき `ApiError` を投げる。`ApiError.status` に HTTP の status を持たせる。`message` は現状の文字列(`<METHOD> <path> -> <status> <error>`)と同じにする (Q1: A, Q4: A)
- FR1.4: 客画面(`web/src/customer/index.tsx`)の `parseApiError` による正規表現での status 取り出しをやめ、`ApiError.status` で判定する。404 のときは保存済みの注文 ID を破棄し、409 のときは売り切れ処理をする、という現状の動きは変えない (Q1: A, Q4: A)
- FR1.5: 厨房画面と店長画面に表示されるエラー文言は、現状と同じにする。厨房画面の `String(e)` の結果(先頭の "Error: " を含む)と、店長画面の `e.message` の結果が、置き換え前後で一致する (Q4: A)
- FR1.6: ドメインエラー(`OrderNotFoundError`、`InvalidTransitionError`)は `ApiError` の派生にしない (Q1: A)

### FR2. エラーハンドラの集約

- FR2.1: `server/src/app.ts` に、全体の `setErrorHandler` を1つ置く (Q2: A)
- FR2.2: 客・厨房・店長の各ルートプラグインにある `setErrorHandler`(`customer.ts`、`kitchen.ts`、`manager.ts`)を削除する。3つのプラグインの応答は、全体ハンドラの結果になる (Q2: A)
- FR2.3: 全体ハンドラは、status が 400〜499 のエラーでは、その status と `{ error: <エラーのメッセージ> }` を返す。それ以外のエラーでは、500 と `{ error: "internal server error" }` を返し、ログは `req.log.error` で出す (Q3: A)
- FR2.4: 全体ハンドラは `OrderNotFoundError` を 404、`InvalidTransitionError` を 409 に変換する。`kitchen.ts` の `try/catch` による変換は削除する。応答の status とメッセージは現状と同じにする (Q2: A)

### FR3. 回帰を防ぐ進め方

- FR3.1: 変更に入る前に `npm test` を実行し、全テストが通ることを確認する。本数と結果を記録する(`README.md` の記載は契約27、ユニット69、E2E 14)
- FR3.2: テストのない web 側のエラー分岐(客画面の 404/409 分岐、厨房画面と店長画面のエラー表示)について、現状の動きを固定するテストを、変更より先に追加する。追加したテストは、変更前のコードで通ることを確認する
- FR3.3: `e2e/e2e.test.ts` を含む既存テストは書き換えずに通す
- FR3.4: 契約テスト 0b(書き込み SQL の位置の静的検査)を通す。変更はエラー処理に限り、書き込み担当の分離は崩さない

## Non-functional requirements

- NFR1: 互換性。全 API のエラー応答の本文は `{ error: string }` のまま、status も変えない。存在しないルートの 404 は Fastify の標準形式のままとし、`e2e/e2e.test.ts:251` が無修正で通る。例外は、Fastify 内部が返す 500 以外の 5xx(例: 503)で、客ルートでは 500 に変わる (Q3: A)。この例外を除き、応答が変わるケースは0件
- NFR2: 検証可能性。変更後に `npm test` が全件通り、失敗0件、スキップは変更前と同数。追加した web 側テストも含む
- NFR3: 型の健全性。変更後に `npm run typecheck` がエラー0件で終わる
- NFR4: 保守性。変更後は、`setErrorHandler` の定義が `server/src` に1か所(`app.ts`)だけで、`ApiError` の定義が1か所だけである。どちらも `grep` で数えて確認できる

## Constraints

- 共通エラー型は `contracts/` に置く。サーバーと web の共有に使えるのは `contracts/` だけで、`web/tsconfig.json` は `src` と `../contracts/types.ts` だけを include している(`dependencies.md`)。include の更新は認められている
- 既存の応答の形 `{ error: string }` は、OpenAPI、契約テスト、サーバーのユニットテスト、README が前提にしている
- ESLint、Prettier、CI は未導入で、確認手段は `npm run typecheck` と `npm test` に限られる(`code-quality-assessment.md`)
- `contracts/types.ts`、`app.ts`、`web/src/shared/api.ts` には「Wave 1 中は読み取り専用」というコメントが残っている。Wave 1 は終了済みなので、これらのファイルの変更は可能。コメントの扱いは後続ステージで決める

## Assumptions

- `ApiError` の `name` は既定の `Error` のままにする。厨房画面の `String(e)` が、現状と同じ "Error: ..." という文字列になるため(FR1.5)
- Fastify はルートプラグインの前に登録したエラーハンドラを、子のプラグインに引き継ぐ。`app.ts` では、ルートプラグインの登録より前に全体ハンドラを設定する前提で設計する。検証は後続ステージで行う

## Out of scope

- 厨房画面の "Error: " 接頭辞の除去: 表示が変わるため、今回は行わない。Issue #15 として登録済み
- 存在しないルートの 404 の形式の変更
- ルート内にある、`reply.code(N).send({ error })` を直接呼ぶ箇所(`server/src/routes/` に計18か所)の書き換え
- ESLint・Prettier・CI の導入
- API の応答の本文(`{ error: string }`)の変更

## Open questions

- web 側にはテストの仕組みがない。FR3.2 のテストを動かす方法(新しいテストツールの追加の要否など)は、後続の設計で決める必要がある
- 上記の18か所の直接送信を、今回は触らない前提で進める。変更したい場合は、後続ステージの前に知らせてもらう
- 変更前の `npm test` の実測値は、FR3.1 の実施後に記録する。この調査では実行していない
