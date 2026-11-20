# 品質ゲート: mobile-order の Google Cloud デプロイ

## Sources

- `[Q1]` 3 ジョブの成功をマージの必須条件にする。`[Q3]` Terraform の検査は `fmt -check` と `validate` のみ。`ci-pipeline-questions.md` の人間の回答
- `[memory:M1]` `ci-config.md`(ジョブの定義)、`infrastructure-design/cicd-pipeline.md`(ゲートの表)
- `[memory:M2]` `requirements.md` の FR1.3、FR5.1、NFR2.4、NFR2.5、NFR2.7、NFR2.9
- `[memory:M3]` `team.md` の Testing Posture(インフラに行カバレッジの下限なし、アプリは 80% を維持、マージ前に CI の通過を必須)、`project.md` の ALWAYS / NEVER ルール
- `[scope]` Workflow-selected scope: infra

## ゲート一覧

すべてマージ前(PR)のゲートで、`main` の保護ルールが必須のステータスチェックとして強制する。

| ID | ゲート | ジョブ | 合格条件 | 失敗時 | 要件 |
|---|---|---|---|---|---|
| G1 | Terraform の整形 | `terraform` | `terraform fmt -check -recursive` の終了コードが 0 | マージ不可 | FR1.3 |
| G2 | Terraform の検証 | `terraform` | `terraform init -backend=false` と `terraform validate` の終了コードが 0 | マージ不可 | FR1.3 |
| G3 | 型チェック | `app` | `npm run typecheck` の終了コードが 0 | マージ不可 | FR5.1 |
| G4 | 既存のテスト | `app` | `npm test` の終了コードが 0(契約、サーバー、画面) | マージ不可 | FR5.1 |
| G5 | 画面のビルド | `app` | `npm run build:web` の終了コードが 0 | マージ不可 | FR5.1 |
| G6 | 秘密情報の検査 | `secrets` | `gitleaks` が履歴全体で 0 件 | マージ不可 | NFR2.4 |
| G7 | tfvars の混入 | `secrets` | `git ls-files` に `*.tfvars` がない(`terraform.tfvars.example` を除く) | マージ不可 | NFR2.7 |
| G8 | サービスアカウントキー | `secrets` | `"type": "service_account"` を含む追跡ファイルがない | マージ不可 | NFR2.4 |
| G9 | 課金操作と認証の混入 | `secrets` | ワークフローに `terraform apply` がなく、`ci.yml` に `google-github-actions/auth` と `id-token` がない | マージ不可 | NFR2.5、NFR2.9 |
| G10 | アクションの固定 | `secrets` | ワークフローの `uses:` がすべて 40 桁の SHA で固定されている | マージ不可 | `[Q2]` |
| G11 | `main` の保護 | リポジトリの設定 | PR 必須、上の 3 ジョブの成功必須、squash のみ、直接 push と強制 push の禁止 | 設定の不備は所有者が直す | `[Q1]` |

## Build and Test の記録との対応

この intent は infra スコープで、コード生成とビルド・テストの段階は設計上スキップされている。そのため、ビルド・テストの段階が記録したコマンドはない。代わりに、既存の `package.json` のスクリプト(`typecheck`、`test`、`build:web`)を、CI が強制するビルドとテストのコマンドとする(G3〜G5)。コマンドの追加や変更はしない。

## 保留(今回は強制しない)

| 項目 | 状態 | 理由 | 次の対応 |
|---|---|---|---|
| アプリの 80% 行カバレッジ | 強制しない | `team.md` は 80% の維持を定めているが、カバレッジの計測ツールが未導入で、導入はこの intent のインフラの範囲外(`team.md` Q6、Q9) | 計測ツールを導入する別の作業で、`app` ジョブにゲートを追加する。下限は弱めない |
| Prettier と ESLint | 強制しない | `team.md` の Code Style(Q9)。導入はこの intent の範囲外 | 導入する別の作業で、`app` ジョブにゲートを追加する |
| Terraform の `tflint` と静的な検査 | 追加しない | `[Q3]` で「`fmt` と `validate` のみ」を選択 | 必要になったら再度決める |
| インフラの行カバレッジ | 設けない | `team.md` の Testing Posture | なし |
| `mutation:check` と `e2e/` | CI に含めない | 既存の `npm test` に含まれない。この intent では範囲外 | なし |

## デプロイ前後のゲート(参考。Deployment Pipeline で設計)

| ゲート | 内容 | 設計の場所 |
|---|---|---|
| `build` の確認 | ランナーで `node server.mjs` を起動し `GET /menu` が 200 | `cicd-pipeline.md` ワークフロー 2 |
| スモークテスト | VM 上で 60 秒以内に `GET /` と `GET /api/menu` が 200 | `cicd-pipeline.md` `deploy.sh` |
| 自動ロールバック | 失敗時に前の版へ戻し、120 秒以内に同じスモークテストが合格 | `cicd-pipeline.md` `deploy.sh` |
| `terraform apply` | 毎回、人間が `plan` と見積もりを確認して承認し、手動で実行 | `project.md` の ALWAYS ルール |

## Assumptions & Open Questions

- `[assumption]` A1: G4 の `npm test` が、既存のテストの現在の状態で成功する。実装の最初の PR で確認し、失敗する場合は、ゲートを弱めずに、原因を別途人間に報告する。
- `[assumption]` A2: G10 の検査は、ワークフローの `uses:` を正規表現で調べる簡単な検査で足りる(ローカルのアクションは使わない)。
- 未確定: アプリの 80% 行カバレッジの強制の時期は、計測ツールを導入する作業と合わせて人間が決める。
