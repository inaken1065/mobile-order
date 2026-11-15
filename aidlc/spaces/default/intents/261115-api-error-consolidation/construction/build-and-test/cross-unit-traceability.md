# Cross-Unit Traceability: ApiError の共通化とエラーハンドラの集約

この変更はユニットを分けていません(ゼロユニット)。1つのまとまりとして、要件ごとに、実装かテストのファイルが対応しているかを確認しました。出典は、`aidlc engine sensor-traceability --stage build-and-test` の出力と、`code-generation` の `traceability.json`、`code-summary.md` です。

## 判定

**合格(pass)**。対応する実装かテストが見つからない要件は、0件です。

## 要件ごとの対応

| ID | 内容 | 担当 | 対応するファイル |
|---|---|---|---|
| FR1.1 | `contracts/` に `ApiError` を追加 | code-generation | `contracts/api-error.ts` |
| FR1.2 | サーバーの `HttpError` を `ApiError` に置き換え | code-generation | `server/src/routes/customer.ts` |
| FR1.3 | web が失敗した応答から `ApiError` を投げる | code-generation | `web/src/shared/api.ts` |
| FR1.4 | 客画面の判定を `ApiError.status` で行う | code-generation | `web/src/shared/error-text.ts` |
| FR1.5 | 厨房・店長画面の表示文言は変えない | code-generation | `web/test/error-text.test.ts` |
| FR1.6 | ドメインエラーは `ApiError` の派生にしない | code-generation | `server/src/app.ts` |
| FR2.1 | `app.ts` に全体の `setErrorHandler` を1つ置く | code-generation | `server/src/app.ts` |
| FR2.2 | 3つのプラグインのハンドラを削除する | code-generation | `server/src/routes/kitchen.ts`(客・店長も同様に削除) |
| FR2.3 | 4xx はそのまま、4xx 以外は 500 の `internal server error` | code-generation | `server/test/app/error-handler.test.ts` |
| FR2.4 | ドメインエラーの 404/409 変換を全体ハンドラが行う | code-generation | `server/test/app/error-handler.test.ts` |
| FR3.1 | 変更前に `npm test` で全テストを確認する | code-generation | `code-summary.md`(変更前の基準) |
| FR3.2 | web 側の現状を固定するテストを先に追加する | code-generation | `web/test/api.test.ts`(`web/test/error-text.test.ts` も) |
| FR3.3 | 既存テストは書き換えずに通す | code-generation | `e2e/e2e.test.ts`(既存の全テスト、差分0) |
| FR3.4 | 契約テスト 0b を通す | code-generation | `contracts/test/test0-write-ownership.test.ts` |
| NFR1 | 応答の形と status を変えない(受け入れ済みの変更を除く) | code-generation | `server/test/app/error-handler.test.ts` |
| NFR2 | `npm test` が全件通る | code-generation | `package.json`(`test` と `test:web`) |
| NFR3 | `npm run typecheck` がエラー0件 | code-generation | `tsconfig.json`(`web/test` を検査対象に追加) |
| NFR4 | `setErrorHandler` と `ApiError` の定義が1か所 | code-generation | `server/src/app.ts` |

## 業務ルール(機能設計の BR)との対応

`code-generation` の `traceability.json` に、BR1.1〜BR4.6 の37件(要件と合わせた全ID)の対応を記録し、`aidlc engine sensor-traceability` が `pass: true`(未対応0件、孤立0件)を返しています。

## 対応のない要素

なし。
