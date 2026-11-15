## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-15T07:51:48Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261115-api-error-consolidation/construction/functional-design/functional-spec.md > 2. 変更前後の応答の違い、および rules.md > BR2.6 | 「表にない応答は変更前後で同じ」「存在しないルートは標準の 404 のまま」とあるが、不完全。実測(Fastify 5.x、ルート未定義の POST /nope に壊れた JSON を送る)では、変更前は Fastify 標準の `{"statusCode":400,"code":"FST_ERR_CTP_INVALID_JSON_BODY","error":"Bad Request","message":...}`、ルート直下に全体ハンドラを置いた後は `{"error":"Body is not valid JSON ..."}` に変わる(同じく 415 など、本文解析・ハンドラ前に起きる 4xx も同様)。存在しないルートの 404 自体は標準形式のまま(e2e/e2e.test.ts:251 は通る)。この差分は 2 章の表にも NFR1 の例外にも無い | 2 章の表に「存在しないルートへの、壊れた JSON や非対応の content-type のリクエスト」を追加し、BR2.6 の「エラーハンドラを通らない」を「404 そのものは通らない」に限定して書き直す。許容するか(NFR1 の例外に足す)、守るか(404 ハンドラ側で現状の形を保つ)を決めて書く | Resolved (reviewer) |
| R-02 | Major | aidlc/spaces/default/intents/261115-api-error-consolidation/construction/functional-design/frontend-components.md > 検証、および rules.md > BR4.2 | web テストの置き場所と実行経路が決まっていない。現状の `npm test` は `contracts/test/*.test.ts` と `server/test/*/*.test.ts` だけを走らせる。`web/tsconfig.json` は `types: ["vite/client"]` で `src` を include するため、`web/src` 下に `node:test` のテストを置くと `npm run typecheck`(NFR3)に影響しうる。ルートの tsconfig は `contracts`、`server`、`scripts` だけを対象にし、`web` を含まない。Q3 の回答は「`npm test` に `test:web` を加える」とあるが、rules.md や frontend-components.md には反映がない。NFR2 の「追加した web テストも含む」を満たせるか判断できない | BR4.2 または frontend-components.md に、テストの置き場所の方針(`npm test` に含まれる位置、web の typecheck で型エラーにならないこと)と、`package.json` の `test:web` 追加をルールとして書く。新規 `contracts/` ファイルを `web/tsconfig.json` の include に足す要否(ファイルは import 経由で解決される)も明記する | Resolved (reviewer) |
| R-03 | Minor | aidlc/spaces/default/intents/261115-api-error-consolidation/construction/functional-design/functional-spec.md > 2. 変更前後の応答の違い、行「メッセージが空の 4xx」 | 「客・店長ルート」だけが変わるとあるが、厨房も変わる。`kitchen.ts:26` は `e.message ?? 'bad request'` で、空文字列("")はそのまま返る。全体ハンドラの BR2.2 は空も "bad request" にするため、厨房でも空メッセージの 4xx が変わる(未定義の場合のみ従来どおり) | 表の対象に厨房(メッセージが空文字列の場合)を加える | Resolved (reviewer) |
| R-04 | Minor | aidlc/spaces/default/intents/261115-api-error-consolidation/construction/functional-design/rules.md > BR3.2、frontend-components.md > エラー文言の関数 | 店長画面の文言が `e instanceof Error ? e.message : e` の 1 種類として書かれているが、実コードは `MenuPanel.tsx:118` が `e instanceof Error ? e.message : String(e)`(`setError` は文字列を取る)、他 3 か所(`MenuPanel.tsx:91`、`SalesPanel.tsx:19`)は文字列に埋め込む形。「e をそのまま返す」関数にすると `MenuPanel.tsx:118` の型と合わない | 店長画面の文言関数は「Error なら message、それ以外は文字列化」と定義し、挙動が同じことを注記する | Resolved (reviewer) |
| R-05 | Minor | aidlc/spaces/default/intents/261115-api-error-consolidation/construction/functional-design/functional-spec.md > 2. 変更前後の応答の違い(3行目「メッセージが未定義または空の 4xx」) | 客・店長の変更前のハンドラは `err.message` をそのまま `send({ error: ... })` に渡す(customer.ts:46、manager.ts:67)。メッセージが未定義だと `error` キーが落ちて本文が `{}` になるが、表は「空のメッセージ」とだけ書いている。変更後は `{ error: "bad request" }` なので、この場合は本文の構造も変わる。実際に到達する経路は Fastify 内部のエラーでは見当たらないため影響は小さいが、「形が変わる唯一の変更」という文言とは厳密には合わない。 | 3行目の変更前を「`{}`(未定義の場合)または空文字列」に直すか、1行目の「唯一」を「実際に到達する経路での唯一」と限定する。実装には影響しない。 | New |

> R-01 Reviewer note: functional-spec.md の表の1行目と W1 手順8、rules.md の BR2.6(例外の明記)と新設の BR2.7、新しいテスト BR4.6 が揃った。実際に Fastify で確認した結果、存在しないルートへの壊れた JSON は変更前の標準形から `{ error }` 形に変わり、status は同じ。現在の3つのプラグインのハンドラはすべて `{ error }` 形を返しており、それ以外に応答の構造(本文のキー構成)が変わる行は見つからなかった。「応答の形が変わる唯一の変更」という文言は、後述の Minor 1点(メッセージ未定義)を除き、ソースに照らして成り立つ。不正な URL(FST_ERR_BAD_URL)は全体ハンドラを通らず、変更前後で標準形のまま(確認済み)。

> R-02 Reviewer note: web/test/ に置き、`test:web`(`node --import tsx --test`)を追加し、`npm test` を contracts、units、web の順にする設計が BR4.5、frontend-components.md、spec 4 節で一致した。ルートの tsconfig は `types: ["node"]` で lib 指定なし(既定で DOM を含む)のため、`api.ts` の `fetch` を読み込んでも型は通る見込み。web/tsconfig.json は `src` と `../contracts/types.ts` のみで、`types` が `vite/client` という記述も実物と一致。型が合わない場合の専用 tsconfig の逃げ道も記載済み。

> R-03 Reviewer note: 表の4行目に、厨房の `e.message ?? 'bad request'` が空文字列を通すこと(kitchen.ts:26 付近、実物で確認)が記録された。

> R-04 Reviewer note: BR3.2 と frontend-components.md が、MenuPanel.tsx:118 の `String(e)`(実物で確認)と、91 行と SalesPanel の埋め込み箇所を区別して記述している。

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| aidlc engine sensor-traceability --stage functional-design | `{"pass":true,"gaps":[],"orphans":[],"missing_from_table":[],"missing_from_upstream_ids":[],"invalid_entries":[],"invalid_targets":[],"findings_count":0}` | FR1.1〜FR3.4 の全件が正引きで対応づいており、BR2.7、BR4.5、BR4.6 は逆引きの N/A 行として根拠つきで登録されている。rules.md、functional-spec.md、frontend-components.md の BR の範囲(BR1.1〜BR4.6)とも一致する。 |

### Summary

前回の4件はいずれも解消済みで、表、ルール、フロントエンド設計、トレーサビリティは互いに一致している。web テストの置き場所と実行経路も実物の設定に照らして成り立つ。残るのは、メッセージ未定義時の本文が `{}` になることを表に書いていない軽微な点のみで、実装を妨げない。
