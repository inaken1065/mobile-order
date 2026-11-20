# CI Pipeline: 質問

CI のツール(GitHub Actions)、ブランチ運用(`feature/*` から PR で `main` へ squash マージ)、マージ前の品質ゲート(Terraform の `fmt -check` と `validate`、既存の型チェックとテスト、秘密情報の検査)、成果物の置き場(GitHub Actions のアーティファクト)は、これまでの回答と `cicd-pipeline.md` で決まっています。ここでは、まだ決まっていない点だけを聞きます。

## Q1. [パイプライン] `main` の保護ルール

- A. PR を必須にし、CI の 3 つのジョブ(terraform、app、secrets)の成功を必須にする。squash マージだけを許可し、`main` への直接の push と強制 push を禁止する(推奨。`team.md` の「PR を作成して `main` へ squash マージ」を強制できる)
- B. PR を必須にするだけで、ジョブの成功は必須にしない
- X. Other (please specify)

[Answer]: A

## Q2. [パイプライン] サードパーティのアクションの固定と更新

- A. コミットの SHA で固定し、Dependabot(週 1 回)でアクションの更新の PR を出す(推奨。供給元の改ざんに強い)
- B. タグ(`v4` など)で固定し、手動で更新する
- X. Other (please specify)

[Answer]: A

## Q3. [パイプライン] Terraform の追加の検査

- A. `fmt -check` と `validate` だけ(FR1.3 のとおり。推奨)
- B. `tflint` を追加する
- C. 設定の静的な検査(`checkov` など)を追加する
- X. Other (please specify)

[Answer]: A

## Q4. [パイプライン] 成果物の保持

- A. GitHub Actions のアーティファクトに、デプロイ用の成果物(`server.mjs` と `web/` の tar)だけを 7 日保持する(推奨。再現用)
- B. 保持しない
- X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
