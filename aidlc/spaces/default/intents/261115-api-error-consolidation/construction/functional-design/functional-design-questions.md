# Functional Design Questions

対象: ApiError の共通化とエラーハンドラの集約(要件は `requirements.md` の FR1〜FR3、NFR1〜NFR4)。
この変更には、新しいデータモデルや業務ルールはありません。設計するのは、エラー型の形、エラーから応答への変換ルール、web 側の判定です。

要件定義のレビューで挙がった軽微な指摘のうち、設計で決める必要があるものを質問にしました。

## Q1. [開発] `ApiError` の status を表すフィールド名

`ApiError` は `status` を持つと要件(FR1.1)に書きました。一方、Fastify 自身のエラー(`HttpError` を含む)は `statusCode` を持ち、現状のハンドラは `err.statusCode` を読んでいます。全体ハンドラが、どちらをどう読むかを決める必要があります。

A. `ApiError` は `status` だけを公開する。全体ハンドラは「`ApiError` なら `status`、それ以外のエラーなら Fastify の `statusCode`」を読む。web は `err.status === 409` のように判定する(バックログ #11 の提案と同じ書き方)
B. `ApiError` は `statusCode` だけを公開する(Fastify と同じ名前)。全体ハンドラは `statusCode` だけを読めばよい。web は `err.statusCode === 409` と判定する
C. `ApiError` は `status` と `statusCode` の両方を公開する(同じ値)
X. Other (please specify)

[Answer]: A

## Q2. [開発] メッセージが無い 4xx エラーの応答

現状の `kitchen.ts:26` は、4xx のエラーにメッセージが無いとき `'bad request'` を返します。customer と manager のハンドラにはこの代替がありません。全体ハンドラに統一するとき、この扱いを決める必要があります。

A. 全体ハンドラでも、メッセージが空または未定義の 4xx には `'bad request'` を返す(現状の厨房の動きを、3画面すべてに適用する)
B. 代替は設けない(メッセージが無ければ空のまま。厨房の `'bad request'` はなくなる)
X. Other (please specify)

[Answer]: A

## Q3. [開発] web 側のエラー分岐テストの実行方法

web にはテストの仕組みがありません。既存のテストは、Node 標準の `node:test`(`node --import tsx --test`)で動いています(`package.json` の `test:contracts`、`test:units`)。変更前に、現状の動きを固定するテストを追加する必要があります(FR3.2)。

A. 新しい依存を追加せず、`node:test` で書く。`web/src/shared/api.ts` は `fetch` を差し替えて、投げられるエラーの `message` と status を確認する。客画面の 404/409 の判定と、厨房・店長画面のエラー文言の組み立ては、画面から小さな関数に切り出してテストする(切り出しは、変更前に動きを変えずに行う)。`npm test` に `test:web` を加える
B. Vitest と Testing Library を追加し、画面を描画して確認する(開発用の依存が増える)
X. Other (please specify)

[Answer]: A

## Q4. [開発] 「Wave 1 中は読み取り専用」コメントの扱い

`contracts/types.ts`、`app.ts`、`web/src/shared/api.ts` には、Wave 1 のときの「読み取り専用」というコメントが残っています。Wave 1 は終了済みです。今回の変更で、`app.ts` と `web/src/shared/api.ts` は書き換えます。

A. 今回書き換えるファイル(`app.ts`、`web/src/shared/api.ts`)のコメントだけ、実態に合わせて直す。`contracts/types.ts` は触らない
B. コメントは直さない
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Q1: `ApiError` は `status` だけを公開する。全体ハンドラは「`ApiError` なら `status`、それ以外のエラーなら Fastify の `statusCode`」を読む。web は `err.status === 409` のように判定する
- Q2: 全体ハンドラでも、メッセージが空または未定義の 4xx には `'bad request'` を返す(厨房の現状の動きを3画面すべてに適用する。customer と manager では、この場合の応答が変わる)
- Q3: 新しい依存は追加せず、`node:test` で web 側のテストを書く。`api.ts` は `fetch` を差し替えて確認し、客画面の 404/409 の判定と、厨房・店長画面のエラー文言の組み立ては、動きを変えずに小さな関数へ切り出してテストする。`npm test` に `test:web` を加える
- Q4: 今回書き換える `app.ts` と `web/src/shared/api.ts` のコメントだけ実態に合わせて直す。`contracts/types.ts` は触らない

Does this all look correct before I generate the functional design artifacts?

- Looks correct
- Request changes

[Answer]: Looks correct
