<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-21T00:00:00Z — Q3 の人間の補足は、paths-ignore を deploy.yml の push だけに付け、ci.yml の PR の必須チェックには付けない、と解釈した。ci-config.md の「パスの絞り込みはしない」と一致する。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-21T00:00:00Z — stage 定義の「機能フラグの設定」と「環境の昇格マトリクス」は、決定済み(機能フラグなし、環境は 1 つ)のため、deployment-strategy.md の表に「なし」と理由を書くだけにした。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-21T00:00:00Z — workflow_dispatch は main の履歴に含まれるコミットだけを受け付ける設計にした。任意のコミットのデプロイを防ぐ代わりに、PR 前のブランチの試験デプロイはできない。

## Open questions
- 2026-11-21T00:00:00Z — Environment production と WIF の組み合わせ(sub の形式、デプロイブランチの制限)は、ウォーキングスケルトンで workflow_dispatch を含めて確認する。
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
