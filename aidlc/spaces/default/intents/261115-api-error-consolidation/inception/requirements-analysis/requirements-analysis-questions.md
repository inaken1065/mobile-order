# Requirements Analysis Questions

対象: バックログ2件(ApiError の共通化 / エラーハンドラの集約)。
すでに確定している方針(Reverse Engineering の承認時にいただいたもの)は質問せず、そのまま要件にします。

- エラーの形 `{ error: string }` と、存在しないルートの 404 の形は変えない。`e2e/e2e.test.ts` を含む既存テストは書き換えずに通す
- 変更前に `npm test` で全テストが通ることを確認する。テストのない web 側のエラー分岐(顧客画面の 404/409 など)は、現状の動きを固定するテストを先に追加する
- 共通のエラー型は `contracts/` に置く。`web/tsconfig.json` の include 更新は認める

以下は、まだ決まっていない点です。

## Q1. [開発] 共通エラー型 `ApiError` の形と置き換え範囲

現状、リポジトリに `ApiError` という型はありません。サーバーには `HttpError`(`server/src/routes/customer.ts:10`)があり、web の `web/src/shared/api.ts:9-11` は status を持たない文字列の `Error` を投げています。どこまで `ApiError` に寄せるかで、変更するファイルの数が変わります。

A. `contracts/` に実行時クラス `ApiError`(status と message を持つ)を新規ファイルで追加し、サーバーの `HttpError` と web の `api.ts` が投げる `Error` を置き換える
B. A に加えて、ドメインエラー(`OrderNotFoundError`、`InvalidTransitionError`)も `ApiError` の派生にする(404/409 を型で持たせる)
C. `ApiError` は web 側だけに導入する(`api.ts` が status 付きで投げる)。サーバーの `HttpError` はそのまま
X. Other (please specify)

[Answer]: A

## Q2. [開発] エラーハンドラの集約先とドメインエラーの変換

`setErrorHandler` が `customer.ts:43-48`、`kitchen.ts:19-28`、`manager.ts:61-69` の3か所にあり、`server/src/app.ts` には全体のハンドラがありません。厨房ルートは `kitchen.ts:49-53` で、ドメインエラーを `try/catch` で 404/409 に変換しています。

A. `app.ts` に全体の `setErrorHandler` を1つ置き、3か所のハンドラを削除する。`ApiError` とドメインエラー2種の 404/409 変換も全体ハンドラが行い、`kitchen.ts` の `try/catch` は削除する
B. `app.ts` の全体ハンドラは `ApiError` と想定外エラーだけを扱う。ドメインエラーの 404/409 変換は `kitchen.ts` の `try/catch` に残す
C. 全体ハンドラは作らず、3つのハンドラが使う共通関数だけを1か所に切り出す
X. Other (please specify)

[Answer]: A

## Q3. [開発] 3つのハンドラのわずかな違い(ログと 4xx/5xx の扱い)の統一方法

3つのハンドラは、ログ呼び出しが `app.log.error`(customer、manager)と `req.log.error`(kitchen)に分かれています。4xx の判定も、`statusCode>=400` を通すもの(customer、kitchen)と 400-499 のみのもの(manager)があります。集約すると、どれかに寄せることになります。

A. 4xx(400-499)はメッセージをそのまま返し、それ以外は 500 と `internal server error` を返す。ログは `req.log.error`(リクエスト情報が付く)にする
B. customer の現状(`statusCode>=400` を通す、`app.log.error`)に合わせる
X. Other (please specify)

[Answer]: A
補足(ご依頼): 意図的に 5xx の `HttpError` を投げている箇所がないか確認し、あれば文言が変わるので報告する。
確認結果: `HttpError` の throw は 400/404/409 のみで、意図的な 5xx はありません(`server/src/routes/customer.ts` の 28,31,33,34,63,68,96 行)。ただし Fastify 自身が返す 5xx 相当のエラー(`statusCode` が 500 以外の 5xx)では、customer のハンドラだけがその status をそのまま返し(例: 503 は 503 のまま)、kitchen と manager は 500 にします。A に統一すると、customer ではその場合 500 に変わります。メッセージは、どのハンドラでも 5xx は `internal server error` で変わりません。

## Q4. [プロダクト] 画面に表示されるエラー文言

画面ごとに表示方法が違います。厨房画面は `String(e)` で "Error: ..." が付き(`kitchen/index.tsx:111,133`)、店長画面は `e.message` を使い(`manager/MenuPanel.tsx:91,118`、`SalesPanel.tsx:19`)、顧客画面は `parseApiError` で status を取り出しています(`customer/index.tsx:38-42`)。

A. 画面に表示される文言は現状のまま変えない。内部の実装だけを `ApiError` に置き換える(表示を固定するテストを先に追加する)
B. 3画面とも `ApiError` の message に統一する(厨房画面の "Error: " 接頭辞がなくなるなど、表示が少し変わる)
X. Other (please specify)

[Answer]: A
補足(ご依頼): 厨房画面の "Error: " 接頭辞を消す件は今回やらず、新しいバックログ Issue として登録する。
対応: https://github.com/inaken1065/mobile-order/issues/15 として登録しました。

## Consolidated Summary Confirmation

- 確定済みの方針: エラーの形 `{ error: string }` と存在しないルートの 404 は変えない。既存テストは書き換えずに通す。変更前に `npm test` で全テストを確認し、web 側のエラー分岐の現状を固定するテストを先に追加する。共通エラー型は `contracts/` に置き、`web/tsconfig.json` の include 更新を認める
- Q1: `contracts/` に実行時クラス `ApiError` を新規ファイルで追加し、サーバーの `HttpError` と web の `api.ts` が投げる `Error` を置き換える(ドメインエラーは `ApiError` の派生にしない)
- Q2: `app.ts` に全体の `setErrorHandler` を1つ置き、3か所のハンドラを削除する。`ApiError` とドメインエラー2種の 404/409 変換も全体ハンドラが行い、`kitchen.ts` の `try/catch` は削除する
- Q3: 4xx はメッセージをそのまま返し、それ以外は 500 と `internal server error` を返す。ログは `req.log.error`。意図的な 5xx の `HttpError` はない。Fastify 内部の 500 以外の 5xx(例: 503)は、customer で 500 に変わる
- Q4: 画面に表示される文言は変えない。厨房画面の "Error: " 接頭辞の除去は、新しいバックログ Issue #15 として登録済み

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
