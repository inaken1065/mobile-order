# Code Generation Plan Approval

AI-DLC writes this file when it asks you to approve the plan. To answer here
instead of in chat, write your answer after `[Answer]:` and tell me in chat when you are done.

## Plan Approval

Approve the code plan?

- Builds: 共通の `ApiError` と、`app.ts` の全体エラーハンドラ1つ。web の失敗の受け取り方もそれに合わせる(応答と表示文言は変えない)
- Touches: `contracts/api-error.ts`(新規)、`server/src/app.ts`、`server/src/routes/{customer,kitchen,manager}.ts`、`web/src/shared/`、`web/src/{customer,kitchen,manager}/`、`package.json`、`tsconfig.json`
- Tests: 新規 約17本(web 約9本、server 約8本)。変更前に web の現状を固定する分を先に追加し、既存テスト(契約27、ユニット69、E2E 14)は書き換えない

Full plan: aidlc/spaces/default/intents/261115-api-error-consolidation/construction/code-generation/code-generation-plan.md
Test instructions: aidlc/spaces/default/intents/261115-api-error-consolidation/construction/code-generation/unit-test-instructions.md

[Approval Fingerprint]: sha256:v3:25934df5091bd69351dba10610d80651d47a414dffc62a16305be76ac00768a5
[Planned Source]: 3d06e8a86d8ce87e59973e9bb8cd65379ab7bcfa5f53bef87782b1ce61f7aaab

- A. Approve Plan
- B. Request Changes
- C. I'll edit the files

[Answer]: A. Approve Plan
