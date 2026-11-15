<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-15T06:23:22Z — `ApiError` という名前の型は repo に存在しなかったため、相当物(HttpError / ドメインエラー / api.ts の文字列 Error / parseApiError)を重複として記録した

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-15T06:23:22Z — Minimal 深度のため、エラー重複の記述は code-quality-assessment.md に一元化し、他の成果物からは相互参照にした

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-15T06:23:22Z — 共通 ApiError の置き場(contracts/ か web 側のみか)と、未定義 404 の形式を変えるか(e2e の特性テスト更新が必要)は後続ステージで決める必要がある
