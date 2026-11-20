# Evidence

## Sources

- `aidlc/spaces/default/intents/261115-gcp-deploy/project-description.json` [desc]
- git 履歴(`git log`、10 件。単一著者 `inaken1065`、PR 番号付きのスカッシュマージ)
- `package.json`、`.gitignore`、`aidlc.settings.json`、リポジトリ直下の構成
- `aidlc/spaces/default/codekb/mobile-order/technology-stack.md`、`code-quality-assessment.md`
- `aidlc-docs/retrospective.md`、`README.md`
- `aidlc/spaces/default/memory/org.md`(既定。`team.md` / `project.md` は空で再実行の基準なし)
- `practices-discovery-questions.md`(Q1〜Q9 の人間の回答、サマリー確認済み)[Q1]〜[Q9]

## 検査した内容と推定

| 領域 | 検査 | 推定 | 確度 |
|------|------|------|------|
| Way of Working | git 履歴のグラフ、コミット件名 | 線形履歴、PR 番号付きスカッシュマージ、単独開発 | 高(Q1 で確認) |
| Walking Skeleton | 履歴 `B0: ... Walking Skeleton (U0)`、振り返り | 過去に実践済み | 高(Q3 で確認) |
| Testing Posture | `package.json` scripts、`code-quality-assessment.md` | `node:test`、実装後に整備、カバレッジ計測なし | 高(Q4 で確認) |
| Deployment | `.github/` なし、デプロイ設定なし、初期説明 | 現状は未整備。方針は初期説明に由来 | 高 |
| Code Style | ESLint・Prettier・`.editorconfig` の不在、`tsc` strict | リンタ未導入、命名は camelCase | 高 |

## 確定した人間の制約(初期説明より)

Terraform + GCS state、VM 1 台、SQLite を永続ディスク、GitHub Actions + WIF、最小コスト、所有者 IP のみ、課金操作は事前承認。`discovered-rules.md` に反映済み。

## インタビュー判断

| 質問 | 回答 | 判断 |
|------|------|------|
| Q1 ブランチ | A | `feature/*` で作業し、PR 経由で `main` へ squash マージする |
| Q2 規約 | A | ブランチ名・コミットメッセージの規約なし |
| Q3 スケルトン | A | 薄い一周分(最小 VM と Terraform)を先に作り、CI/CD と IP 制限を後から足す |
| Q4 方法論 | A | test-after |
| Q5 インフラ検証 | A | `terraform fmt -check` と `terraform validate` |
| Q6 カバレッジ・CI | A | アプリは 80% 行カバレッジ、インフラに下限なし、マージ前に CI 必須 |
| Q7 環境数 | A | 本番相当の 1 環境のみ |
| Q8 デプロイ | A | アプリは `main` マージ時に自動、`terraform apply` は毎回承認後に手動 |
| Q9 アプリ側の静的解析 | B | アプリ側に Prettier/ESLint を導入する |

## 実装範囲に関する注記

アプリ側の 80% 行カバレッジと、アプリ側への Prettier/ESLint 導入は、実践として記録するのみで、このインフラスコープでは実装しない(code-generation と build-and-test はスキップされるため)。実施する場合は別の intent で扱う。
