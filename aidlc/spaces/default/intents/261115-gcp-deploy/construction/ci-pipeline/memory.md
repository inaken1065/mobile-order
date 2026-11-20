<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-21T00:00:00Z — Q1 の「3 ジョブ」は terraform、app、secrets と解釈し、cicd-pipeline.md の「構成の検査」は secrets ジョブに含めた。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-21T00:00:00Z — infra スコープでコード生成とビルド・テストの成果物がないため、Step 5 の追跡ファイル確認は対象外とし、既存の package.json のスクリプトをゲートの基準にした。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-21T00:00:00Z — gitleaks-action ではなくバイナリを SHA-256 で固定して取得する設計にした(ライセンス条件と供給元の固定のため)。

## Open questions
- 2026-11-21T00:00:00Z — esbuild が package.json の依存にない。Deployment Pipeline で、依存に加えるか、ビルドジョブで取得するかを人間に確認する。
- 2026-11-21T00:00:00Z — アプリの 80% カバレッジは計測ツール未導入のため強制していない(quality-gates.md の保留)。
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
