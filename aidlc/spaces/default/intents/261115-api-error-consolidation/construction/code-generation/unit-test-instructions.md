# Unit Test Instructions: ApiError の共通化とエラーハンドラの集約

テスト戦略は Minimal(要件ごとに1本、コンポーネントごとに正常系1本)、方法は test-after です。新規は約17本です。

## テストの仕組み

- テストランナー: Node 標準の `node:test` を、`tsx` 経由で動かします(`node --import tsx --test`)。既存のテストと同じです。新しい依存は追加しません
- web のテストは `web/test/` に置きます。`web/src/` の外に置くのは、`web/tsconfig.json` が `src` だけを検査し、`types` が `vite/client` で `node:test` の型が合わないためです(BR4.5)
- web のテストは、`web/src/shared/api.ts` と `web/src/shared/error-text.ts` だけを読み込み、画面(`.tsx`)は読み込みません
- 型検査: `web/test/` はルートの `tsconfig.json` の検査対象に加えます。型が合わない場合は、`web/test/` 専用の `tsconfig.json` を作り、`npm run typecheck` にその検査を加えます

## この変更のテストを動かすコマンド(単体)

変更に関わるテストだけを動かします。

```bash
node --import tsx --test "web/test/*.test.ts"
node --import tsx --test "server/test/app/*.test.ts"
```

`package.json` には、前者を `npm run test:web` として追加します。

## 全体(変更前の基準と、変更後の確認)

Build and Test と、Step 1、Step 9 の確認では、プロジェクト全体を動かします。

```bash
npm test
npm run typecheck
node --import tsx --test "e2e/*.test.ts"
```

`npm test` は、contracts、units、web の順に実行します。E2E は `npm test` に含まれないので、別に実行します。

## 追加するテスト

| ファイル | 内容 | 本数の目安 |
|---|---|---|
| `web/test/error-text.test.ts` | 客画面の判定(404、409、status 無しのエラー、`sold out: ` の除去、`detail` が空のときの文言)、厨房画面の文言(`"Error: ..."`)、店長画面の文言(`Error` と、`Error` でないもの) | 約5本 |
| `web/test/api.test.ts` | `fetch` を差し替えて、失敗応答で投げられるエラーの `message`(`<METHOD> <path> -> <status> <error>`)、本文が読めない・`error` が無いときの文言、成功応答の本文 | 約3本 |
| `web/test/api-error.test.ts` | `ApiError` の `status`、`detail`、`String(e)` が `"Error: <message>"` になること | 約1本 |
| `server/test/app/error-handler.test.ts` | 全体ハンドラの status と本文(`ApiError`、空メッセージの 4xx、4xx 以外、Fastify 内部の 503)、DomainError の 404/409、存在しないルートの 404 が標準の形式、壊れた JSON(400)と非対応の content-type(415)が `{ error }` の形 | 約8本 |

最初の2ファイル(`error-text`、`api`)は、変更前のコードで通る内容で書き、置き換え後も内容を変えずに通ることを条件にします。既存のテスト(`contracts/test`、`server/test/*`、`e2e`)は書き換えません。

## 期待するカバレッジ

- この変更には、カバレッジの下限は定められていません(`refactor` 範囲は、追加の下限なしで、既存のテストを通すこと)
- 変更した箇所の分岐を、上の表のテストが通ることを目標にします(エラー型、全体ハンドラの各分岐、web の失敗の受け取り)
- カバレッジの計測設定は、このプロジェクトにありません。追加もしません。しきい値を下げる、無効にする、ということはしません

## モック・スタブの方針

- web の `fetch` は、テスト内で `globalThis.fetch` を差し替えます。テストの終了時に元へ戻します
- サーバーは、既存の `freshApp()`(`contracts/test/helpers.ts`)と同じように、メモリ上の DB で `app.inject` を使います。実際のネットワークは使いません
- Fastify 内部が返す 503 のような、通常は到達しないエラーは、テスト用のルートを `app` に追加して投げさせて確認します(本番のコードにテスト用の経路は足しません)

## テストデータ

- サーバーのテストは、既存の `seed` を使います(今日の日付は `contracts/test/helpers.ts` の `TODAY`)
- web のテストのデータは、テスト内の小さな固定値だけです。ファイルや外部のデータは使いません

## 実行できないテスト

- 画面の描画テストとブラウザ操作は行いません(Q3: A。ブラウザ自動化の依存を追加しないため)。画面の動きは、切り出した関数と `api.ts` のテストで固定します
