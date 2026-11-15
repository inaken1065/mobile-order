# Frontend Components: エラー表示まわり

画面の見た目や配置は変えません。変えるのは、エラーを受け取って判定・表示する部分だけです(BR3.1、BR3.2)。

## コンポーネントの構成

| 部品 | 役割 | 変更 |
|---|---|---|
| 共通の API 呼び出し(`web/src/shared/api.ts`) | 失敗した応答から `ApiError` を作って投げる(BR1.2)。コメントを実態に合わせて直す(Q4) | あり |
| 客画面(`web/src/customer/index.tsx`) | 復元時の 404、注文確定時の 409 を判定する。`parseApiError` の正規表現をやめ、`ApiError.status` と `detail` を使う(BR3.1) | あり |
| 厨房画面(`web/src/kitchen/index.tsx`) | 失敗を `String(e)` で表示する(BR3.2) | 表示は変えない |
| 店長画面(`web/src/manager/MenuPanel.tsx`、`SalesPanel.tsx`) | `e instanceof Error ? e.message : e` で表示する(BR3.2) | 表示は変えない |
| エラー文言の関数(新規、`web/src/shared/` 内) | 画面から切り出した、エラーの判定と文言の組み立て。テストの対象にする(Q3: A) | 新規 |

## エラー文言の関数

画面を描画せずにテストできるよう、判定と文言の組み立てを小さな関数に切り出します(Q3: A)。切り出しは、変更前に動きを変えずに行います(BR4.2)。

| 関数 | 入力 | 出力 | 使う画面 |
|---|---|---|---|
| 客画面のエラーの判定 | 投げられたもの | status(無ければ無し)と、表示用の文言 | 客画面 |
| 厨房画面のエラー文言 | 投げられたもの | `String(e)` と同じ文字列 | 厨房画面 |
| 店長画面のエラー文言 | 投げられたもの | `Error` なら `message`、それ以外は `String(e)`(文字列) | 店長画面 |

- 客画面の判定は、`ApiError` なら `status` と、`detail`(空なら `message`)を返します。`ApiError` でなければ status は無しで、文言は `Error` の `message`(`Error` でなければ文字列化したもの)です(BR3.1)。
- 店長画面は、文字列に埋め込む箇所(`MenuPanel.tsx:91`、`SalesPanel.tsx:19`)と、`setError` に文字列として渡す箇所(`MenuPanel.tsx:118` は `String(e)` を使っている)があります。`Error` でないものを文字列に埋め込むと `String(e)` と同じ結果になるので、「`Error` なら `message`、それ以外は `String(e)`」の1つの関数で、3か所とも置き換え前と同じ文字列になります(BR3.2)。
- 切り出した関数の置き場所と名前は、Code Generation の計画で決めます。`web/src/shared/` に置き、描画する部分(`.tsx`)を読み込まない形にします。

## 操作の流れと表示

| 場面 | 現状の動き(変えない) |
|---|---|
| 客画面の起動時に、保存済みの注文を取得して 404 | 保存 ID を捨て、通常の画面を出す |
| 客画面でメニュー取得に失敗 | 文言を読み込みエラーとして出す |
| 客画面で注文を確定して 409 | メニューを取り直し、「売り切れの商品がありました(…)。カートを確認してください。」を出す |
| 客画面で注文を確定して 409 以外 | 「注文できませんでした: …」を出す |
| 厨房画面で一覧の取得に失敗 | 「注文を取得できません: …」を出す |
| 厨房画面で状態の更新に失敗 | 一覧を取り直し、「#<呼出番号> を更新できませんでした: …」を出す |
| 店長画面でメニューや売上の取得に失敗 | 「メニューを取得できませんでした: …」、「売上を取得できませんでした: …」を出す |

「…」の部分は、置き換え前後で同じ文字列になります(BR3.2、NFR1)。

## API との接点

| 呼び出し | 失敗したとき |
|---|---|
| 客のメニュー、注文、注文の取得 | `ApiError`(400/404/409/5xx) |
| 厨房の一覧、状態の更新 | `ApiError`(404/409/5xx) |
| 店長のメニュー、売上 | `ApiError`(400/404/5xx) |

## 検証

- 画面の分岐は、上の関数と `api.ts` の単体テストで固定します(`node:test`、BR4.2)。
- 画面そのものの描画テストは行いません(Q3: A)。

### web テストの置き場所と実行方法(BR4.5)

| 項目 | 内容 |
|---|---|
| 置き場所 | `web/test/`(`web/src/` の外) |
| 実行 | `npm run test:web`(`node --import tsx --test "web/test/*.test.ts"`)を `package.json` に追加し、`npm test` が contracts、units、web の順に実行する |
| 読み込むもの | `web/src/shared/api.ts` と、切り出した関数だけ。画面(`.tsx`)は読み込まない |
| 型検査 | `web/tsconfig.json` は `src` だけを検査し、`types` が `vite/client` なので、テストを `src` に置くと `node:test` の型が合いません。そのため `web/test/` はルートの `tsconfig.json` の検査対象に加えます |
| 型が合わない場合の対処 | ルートの型設定で `api.ts` や切り出した関数に型エラーが出るなら、`web/test/` 専用の `tsconfig.json` を作り、`npm run typecheck` にその検査を加えます。どちらでも `npm run typecheck` は 0 件で終わります |
| `contracts/` の新しいファイル | `web/tsconfig.json` の include は、import で読み込まれるファイルを自動で検査するため、更新は不要な見込みです。`npm run typecheck` が通らない場合だけ更新します(更新は許可済み) |

## Assumptions & Open Questions

None.
