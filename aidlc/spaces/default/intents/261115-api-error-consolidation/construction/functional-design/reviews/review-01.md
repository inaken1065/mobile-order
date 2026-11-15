## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-15T07:39:59Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261115-api-error-consolidation/construction/functional-design/functional-spec.md > 2. 変更前後の応答の違い、および rules.md > BR2.6 | 「表にない応答は変更前後で同じ」「存在しないルートは標準の 404 のまま」とあるが、不完全。実測(Fastify 5.x、ルート未定義の POST /nope に壊れた JSON を送る)では、変更前は Fastify 標準の `{"statusCode":400,"code":"FST_ERR_CTP_INVALID_JSON_BODY","error":"Bad Request","message":...}`、ルート直下に全体ハンドラを置いた後は `{"error":"Body is not valid JSON ..."}` に変わる(同じく 415 など、本文解析・ハンドラ前に起きる 4xx も同様)。存在しないルートの 404 自体は標準形式のまま(e2e/e2e.test.ts:251 は通る)。この差分は 2 章の表にも NFR1 の例外にも無い | 2 章の表に「存在しないルートへの、壊れた JSON や非対応の content-type のリクエスト」を追加し、BR2.6 の「エラーハンドラを通らない」を「404 そのものは通らない」に限定して書き直す。許容するか(NFR1 の例外に足す)、守るか(404 ハンドラ側で現状の形を保つ)を決めて書く | New |
| R-02 | Major | aidlc/spaces/default/intents/261115-api-error-consolidation/construction/functional-design/frontend-components.md > 検証、および rules.md > BR4.2 | web テストの置き場所と実行経路が決まっていない。現状の `npm test` は `contracts/test/*.test.ts` と `server/test/*/*.test.ts` だけを走らせる。`web/tsconfig.json` は `types: ["vite/client"]` で `src` を include するため、`web/src` 下に `node:test` のテストを置くと `npm run typecheck`(NFR3)に影響しうる。ルートの tsconfig は `contracts`、`server`、`scripts` だけを対象にし、`web` を含まない。Q3 の回答は「`npm test` に `test:web` を加える」とあるが、rules.md や frontend-components.md には反映がない。NFR2 の「追加した web テストも含む」を満たせるか判断できない | BR4.2 または frontend-components.md に、テストの置き場所の方針(`npm test` に含まれる位置、web の typecheck で型エラーにならないこと)と、`package.json` の `test:web` 追加をルールとして書く。新規 `contracts/` ファイルを `web/tsconfig.json` の include に足す要否(ファイルは import 経由で解決される)も明記する | New |
| R-03 | Minor | aidlc/spaces/default/intents/261115-api-error-consolidation/construction/functional-design/functional-spec.md > 2. 変更前後の応答の違い、行「メッセージが空の 4xx」 | 「客・店長ルート」だけが変わるとあるが、厨房も変わる。`kitchen.ts:26` は `e.message ?? 'bad request'` で、空文字列("")はそのまま返る。全体ハンドラの BR2.2 は空も "bad request" にするため、厨房でも空メッセージの 4xx が変わる(未定義の場合のみ従来どおり) | 表の対象に厨房(メッセージが空文字列の場合)を加える | New |
| R-04 | Minor | aidlc/spaces/default/intents/261115-api-error-consolidation/construction/functional-design/rules.md > BR3.2、frontend-components.md > エラー文言の関数 | 店長画面の文言が `e instanceof Error ? e.message : e` の 1 種類として書かれているが、実コードは `MenuPanel.tsx:118` が `e instanceof Error ? e.message : String(e)`(`setError` は文字列を取る)、他 3 か所(`MenuPanel.tsx:91`、`SalesPanel.tsx:19`)は文字列に埋め込む形。「e をそのまま返す」関数にすると `MenuPanel.tsx:118` の型と合わない | 店長画面の文言関数は「Error なら message、それ以外は文字列化」と定義し、挙動が同じことを注記する | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| aidlc engine sensor-traceability --stage functional-design | `{"pass":true,"gaps":[],"orphans":[],"missing_from_table":[],"missing_from_upstream_ids":[],"invalid_entries":[],"invalid_targets":[],"findings_count":0}` | FR1.1〜FR3.4 の対応に漏れ、孤立 BR、不正な参照は無い |
| 実測(scratchpad の probe.mjs、Fastify 5 で変更前後のハンドラ構成を再現) | 子プラグインは親のハンドラを引き継ぐ(ルート内の 503 は 500 になる)。未定義ルートの 404 は標準形式のまま。未定義ルートへの壊れた JSON は 400 の形が変わる | R-04 の引き継ぎの前提は成立。上の Major 1 件目の根拠 |

### Summary

要件との対応、BR の意味、`ApiError`・`detail` の扱い(`String(ApiError)` は "Error: ..."、客画面の文言は `parseApiError` と同じ)、契約テスト 0b との整合は実コードと一致した。主な懸念は、未定義ルートへの壊れた JSON の応答差が表に無いことと、web テストの置き場所・実行経路が未定義であること(Major 2 件。Critical 0 件のため READY)。実装前にこの 2 点を設計に書き足すこと。
