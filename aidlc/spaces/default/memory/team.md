# Team-Level Rules

> This team's affirmed practices and corrections. Loaded after `org.md` as
> strict-additive guidance; contradictions with broader policy are rejected.
> Populated by the practices-discovery affirmation gate. Edit at the gate,
> not directly.

## Way of Working

- 開発は単独。AI-DLC の Bolt 単位で作業する。
- ブランチ運用: `feature/*` ブランチで作業し、PR を作成して `main` へ squash マージする(トランクベース、線形履歴)。(Q1 確定)
- 今回の作業ブランチは `feature/gcp-deploy`(`main` から分岐済み)。
- ブランチ名・コミットメッセージに固定の規約は設けない(これまで通り自由。日本語・英語の混在可)。(Q2 確定)
- 課金が発生する操作(`terraform apply` など)は実行前に人間の承認を必須とする。

## Walking Skeleton

- 薄い一周分(ウォーキングスケルトン)を先に作る。最小の VM と Terraform の骨格を先に動かして疎通を確認し、その後に CI/CD と IP 制限を足す。(Q3 確定)
- 過去にも `B0: Contracts + Walking Skeleton (U0)` で同じ進め方を実践している。

## Testing Posture

- **Methodology**: test-after
- **Methodology evidence**: Q4 で人間が test-after を選択した(`custom` と `tdd` は不採用)。既存アプリも各 Bolt で実装後にテストを整備しており、`org.md` の既定とも一致する。
- **Ordering**: 各テスト可能な層を実装した後に、その層のテストを書いて実行する。
- テスト基盤: `node:test` + `node:assert/strict`、Fastify `inject`。
- インフラの検証手段: `terraform fmt -check` と `terraform validate` を CI で実行する。インフラに行カバレッジの下限は設けない。(Q5・Q6 確定)
- アプリのカバレッジ: アプリのコードは 80% 行カバレッジを維持する。マージ前に CI の通過を必須とする。(Q6 確定。現状カバレッジ計測ツールは未導入)

## Guard Policy

<!-- Affirmed by the team. Mode: strict, relaxed, or off. Strict here holds for every intent, whatever one person asks in chat; relaxed or off here applies to every intent whose policy came from its scope, unless project.md or the person sets another; changing this line changes it. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment

- 方針(初期説明に由来): Google Cloud、Terraform(state は GCS バケット)、Compute Engine VM 1 台、SQLite は永続ディスク、GitHub Actions + Workload Identity Federation(サービスアカウントキー不使用)、アクセスは所有者の IP のみ、最小コスト。
- 環境は本番相当の 1 つのみ。(Q7 確定)
- アプリのデプロイは `main` へのマージ時に自動で実行する。`terraform apply` は毎回、人間の承認後に手動で実行する。(Q8 確定)
- ロールバック手順とスモークテスト(`operation.md` の要件)は後続ステージで設計する。

## Code Style

- TypeScript(strict、ESM)、命名は言語の慣習(camelCase)。コメントは日本語で意図を書く。
- Terraform は `terraform fmt` を標準とし、CI で `fmt -check` を行う。(Q5 確定)
- アプリ側に Prettier と ESLint を導入する。(Q9 確定。現時点では未導入で、導入は本 intent のインフラスコープ外)
## Forbidden

<!-- Team-specific forbidden patterns -->

## Mandated

<!-- Team-specific mandates -->

## Corrections

<!-- Self-learning loop appends here. -->
