# Code Generation 計画: mobile-order の Google Cloud デプロイ

## Summary

- Builds: Terraform(`infra/terraform/`)、VM の起動スクリプトとデプロイスクリプト、GitHub Actions(`ci.yml`、`deploy.yml`、Dependabot)、`HOST` の最小変更
- Touches: `infra/`、`.github/`、`scripts/`、`server/src/index.ts`(1 行)、`package.json` と `package-lock.json`(esbuild の追加とスクリプト 2 つ)、既存の `.gitignore` は変更しない
- Tests: 新規の自動テスト約 21 件(HOST の結合 3、CI のガード 6、デプロイスクリプト 9、シェルの構文 3)と `terraform fmt -check` / `validate`。既存のテストは書き換えない

## Sources

- `[scope]` Workflow-selected scope: infra。この実行は `/aidlc --stage code-generation --single` による単独実行で、Unit はなく(ゼロ Unit)、成果物は `construction/code-generation/` に置く
- `[memory:M1]` `construction/infrastructure-design/infrastructure-specification.md`(Terraform のファイル構成、IAM、VM 上の設定、Caddyfile)、`construction/infrastructure-design/cicd-pipeline.md`(`deploy.sh` の設計)
- `[memory:M2]` `construction/ci-pipeline/ci-config.md`、`construction/ci-pipeline/quality-gates.md`、`operation/deployment-pipeline/cd-config.md`、`operation/deployment-pipeline/deployment-strategy.md`、`operation/deployment-pipeline/rollback-runbook.md`
- `[memory:M3]` `construction/nfr-design/performance-design.md`、`construction/nfr-design/security-design.md`、`construction/nfr-design/reliability-design.md`(`mobile-order.service` の定義が唯一の正)
- `[memory:M4]` `inception/requirements-analysis/requirements.md`(FR1〜FR7、NFR1〜NFR7)
- `[memory:M5]` `project.md` の Forbidden / Mandated / Corrections(アプリのコード変更は `HOST` の最小変更だけが例外)、`team.md` の Testing Posture と Code Style

## 前提と範囲

- 実行しないこと: `terraform apply`、`terraform plan`(Google Cloud への認証が要るため)、`gcloud` の操作、GitHub の設定変更、`git commit` と push。課金に関わる操作と外部への反映は、この計画に含めない(ALWAYS / NEVER ルール)。
- 作ること: コードと設定のファイルだけ。実際のプロビジョニングは Environment Provisioning の段階で、人間の承認のもとで行う。
- アプリのコード変更は `server/src/index.ts` の待ち受けアドレスだけ(未指定時は従来どおり `0.0.0.0`)。既存のテストは書き換えない。
- サービスアカウントキー、`*.tfvars`、秘密情報、実際のプロジェクト ID、IP アドレス、メールアドレスは、どのファイルにも書かない。値は変数とシークレットで渡す。
- 具体的な版(Terraform の provider、Node.js、esbuild、各アクション、gitleaks)は、公式のリリースを調べて固定する。調べられないものは、推測した値を書かず、`TODO(版の固定)` と理由を付け、`code-summary.md` に列挙する。

## 計画の手順

- [x] Step 1: プロジェクトの骨格と本番の設定。`infra/terraform/`、`infra/terraform/files/`、`infra/test/`、`scripts/test/`、`.github/workflows/` を作る。`.gitignore` は変更しない(`*.tfvars` などは既に除外済み)。
- [x] Step 2: 既存のテストランナーの確認と、新しいテストのコマンドの記録。`package.json` の `test:*`(`node --import tsx --test`)に合わせ、新規テストのコマンドを `unit-test-instructions.md` のとおりに記録し、実行できることを確認する。
- [x] Step 3: データモデルとデータアクセス。該当なし(DB のスキーマとアプリのデータ層は変えない。DB は `/mnt/data/app.db` に置く設定だけ)。
- [x] Step 4: ビジネスロジック。該当なし(アプリのロジックは変えない)。
- [x] Step 5: API とエンドポイント層の実装: `server/src/index.ts` の `host` を `process.env.HOST ?? '0.0.0.0'` にする(1 行。`[Q]` NFR 要件のレビューで認めた唯一の例外)。
- [x] Step 6: API 層のテストを書いて実行: `server/test/app/host-binding.test.ts`(HOST 指定、未指定、不正な指定)。既存のテストは変更しない。
- [x] Step 7: Terraform の実装(Terraform のファイルの構成は `infrastructure-specification.md`):
  - [x] 7a: `versions.tf`、`backend.tf`(`backend "gcs" {}` のみ。バケット名は `-backend-config` で渡す)、`variables.tf`(`project_id`、`region`、`zone`、`allowed_ip_cidr`、`github_repository`、`owner_email`、`node_version`、`node_sha256`)、`terraform.tfvars.example`(プレースホルダーだけ)、`outputs.tf`
  - [x] 7b: `network.tf`(専用 VPC、サブネット、ファイアウォール 2 つ)
  - [x] 7c: `compute.tf`(データディスク `prevent_destroy`、VM、`metadata_startup_script` の `templatefile`、VM 用サービスアカウント)
  - [x] 7d: `iam.tf`(デプロイ用サービスアカウント、カスタムロール、所有者の権限、WIF のプールとプロバイダ、`google_project_service`)
  - [x] 7e: `.terraform.lock.hcl` を `terraform init -backend=false` で生成する(コミットする)
- [x] Step 8: VM 上のスクリプトと設定の実装: `startup.sh.tpl`、`files/mobile-order-deploy.sh`、`files/Caddyfile`、`files/mobile-order.service`、`files/caddy-order.conf`、`files/journald-mobile-order.conf`、`files/sysctl-mobile-order.conf`。`deploy.sh` は `cicd-pipeline.md` の設計どおり(入力の検査、root 所有の作業ディレクトリでの照合、`tar` の一覧の検査、切り替え、`free -m` の計測、スモークテスト、ロールバック、未マウントの例外)。パスは先頭の定数にまとめ、`MO_TEST_ROOT` による上書きは、root 以外のときだけ受け付ける(`sudo` では環境変数が引き継がれないが、二重に防ぐ)。
- [x] Step 9: Terraform とスクリプトのテストを書いて実行: `terraform fmt -check`、`terraform init -backend=false`、`terraform validate`、`infra/test/deploy-script.test.ts`(下の「テスト」)、`infra/test/shell-syntax.test.ts`(`bash -n`)。
- [x] Step 10: CI と CD の実装: `.github/workflows/ci.yml`、`.github/workflows/deploy.yml`、`.github/dependabot.yml`、`scripts/ci-guards.sh`(G7〜G10 を実装する。`ci.yml` の `secrets` ジョブが実行する)。`package.json` に `esbuild` を版を固定して `devDependencies` へ加え(`npm install --save-dev --save-exact esbuild`)、`build:server` と `test:infra` のスクリプトを追加し、`package-lock.json` を更新する。
- [x] Step 11: CI のガードのテストを書いて実行: `scripts/test/ci-guards.test.ts`。あわせて `deploy.yml` のビルドの手順(`npm run build:server` で `server.mjs` を作り、`node_modules` なしで起動して `GET /menu` が 200)を、この環境で実際に実行して確認する。
- [x] Step 12: ビルドと環境の設定: `ci-config.md` と `quality-gates.md` に、`test:infra` を `app` ジョブの手順として加える(G4 の追加)。設計文書の更新はこの 1 点だけ。
- [ ] Step 13: ドキュメントと追跡: `code-summary.md`(作ったファイル、版を固定できなかったもの、実行しなかったもの、カバレッジの扱い)、`traceability.json`、`source-manifest.json` は書かない(ゼロ Unit)。

## 作るファイルとテスト

| 区分 | ファイル | 内容 |
|---|---|---|
| アプリ | `server/src/index.ts` | `host: process.env.HOST ?? '0.0.0.0'`(1 行) |
| Terraform | `infra/terraform/*.tf`、`terraform.tfvars.example`、`.terraform.lock.hcl` | 7a〜7e |
| VM | `infra/terraform/startup.sh.tpl`、`infra/terraform/files/*` | 8 |
| CI/CD | `.github/workflows/ci.yml`、`deploy.yml`、`.github/dependabot.yml`、`scripts/ci-guards.sh` | 10 |
| 設定 | `package.json`、`package-lock.json` | esbuild、`build:server`、`test:infra` |
| テスト | `server/test/app/host-binding.test.ts`、`scripts/test/ci-guards.test.ts`、`infra/test/deploy-script.test.ts`、`infra/test/shell-syntax.test.ts` | 下の表 |

| テストファイル | 件数 | 内容 |
|---|---|---|
| `host-binding.test.ts` | 3 | `HOST=127.0.0.1` で `127.0.0.1` に待ち受ける、未指定で従来どおり、不正な `HOST` で起動に失敗してエラーを出す |
| `ci-guards.test.ts` | 6 | 正常は 0 件、`*.tfvars` の混入、`service_account` の JSON、`terraform apply` の混入、`ci.yml` の `auth` と `id-token`、SHA で固定されていない `uses:` |
| `deploy-script.test.ts` | 9 | 不正なリリース ID、SHA-256 の不一致、`tar` のシンボリックリンクと `..`、成功時の切り替えと古い版の削除、スモークテスト不合格でロールバック、未マウントでロールバックしない、初回の失敗でロールバックしない、同じ ID の再デプロイ、root のとき `MO_TEST_ROOT` を拒否 |
| `shell-syntax.test.ts` | 3 | 起動スクリプトの描画後、`deploy.sh`、`ci-guards.sh` の `bash -n` |
| Terraform | - | `terraform fmt -check -recursive`、`terraform validate` |

## 品質目標と未達の扱い

- アプリの 80% 行カバレッジと、Testing Contract の 80% の下限は、カバレッジの計測ツールが未導入のため、この実行では計測できない。目標を弱めず、`code-summary.md` に「未計測」と理由を書き、Build and Test と、ツールを導入する作業で扱う。Terraform とシェルには行カバレッジの下限を設けない(`team.md` の Testing Posture)。
- 実行できない検査(`gitleaks`、`shellcheck`、GitHub 上の CI、WIF と Environment の組み合わせ、実際の VM)は、実行したことにしない。`code-summary.md` に「実行していないテストと理由」として書く。

## Testing Contract

```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "team",
  "ordering": "各テスト可能な層を実装した後に、その層のテストを書いて実行する。",
  "scope": "infra",
  "test_strategy": "standard",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "- **Methodology**: test-after\n- **Methodology evidence**: Q4 で人間が test-after を選択した(`custom` と `tdd` は不採用)。既存アプリも各 Bolt で実装後にテストを整備しており、`org.md` の既定とも一致する。\n- **Ordering**: 各テスト可能な層を実装した後に、その層のテストを書いて実行する。\n- テスト基盤: `node:test` + `node:assert/strict`、Fastify `inject`。\n- インフラの検証手段: `terraform fmt -check` と `terraform validate` を CI で実行する。インフラに行カバレッジの下限は設けない。(Q5・Q6 確定)\n- アプリのカバレッジ: アプリのコードは 80% 行カバレッジを維持する。マージ前に CI の通過を必須とする。(Q6 確定。現状カバレッジ計測ツールは未導入)"
    }
  ],
  "obligations": {
    "strategy": "standard",
    "strategy_volume": [
      "Five to eight tests per component.",
      "Unit tests plus integration tests for key boundaries.",
      "Add E2E, performance, or security tests when requirements demand them."
    ],
    "scope_floor": [
      "Meet an 80% line-coverage floor.",
      "Run the selected tests in CI before merge."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "test-after",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - implement.",
      "Data model / database behavior - write and run its tests after implementation.",
      "Repository / data access - implement.",
      "Repository / data access - write and run its tests after implementation.",
      "Business logic - implement.",
      "Business logic - write and run its tests after implementation.",
      "API / endpoint - implement.",
      "API / endpoint - write and run its tests after implementation.",
      "Frontend behavior - implement.",
      "Frontend behavior - write and run its tests after implementation.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:70145476dd4a9bf866567962db85cce52b240c29b792c0b084f89894d8f2dcf6",
  "contract_sha256": "sha256:5a5357aa194df77ba0336c30b66e0497a7df8829ccec1c1d586095c24d956fb4"
}
```

## Assumptions & Open Questions

- `[assumption]` A1: 開発環境にある Terraform(`/usr/bin/terraform`)で `init -backend=false` が provider を取得でき、`validate` まで実行できる。取得できない場合は、`validate` を実行していないと `code-summary.md` に書く。
- `[assumption]` A2: `npm install --save-dev --save-exact esbuild` がこの環境で実行できる。この計画の承認が、この依存の追加の承認を含む(アプリのコードではなく設定の変更として示している)。
- `[assumption]` A3: `scripts/` と `infra/` の TypeScript のテストは、既存の `tsconfig.json` の `include` に入らない。入る場合は、型エラーを出さない書き方にする。
- 未確定: `deploy.sh` の `tar` の一覧の検査は、GNU tar の `-tvf` の出力形式に依存する(VM は Debian 12)。テストでは同じ形式を使う。
- 未確定: 各アクションと provider の版は、公式の情報で確認できたものだけを固定する(上の「前提と範囲」)。
