# CI 設定: mobile-order の Google Cloud デプロイ

## Sources

- `[Q1]` `main` の保護ルール: PR 必須、3 ジョブの成功必須、squash のみ、直接 push と強制 push の禁止(A)。`ci-pipeline-questions.md` の人間の回答
- `[Q2]` アクションはコミットの SHA で固定し、Dependabot(週 1 回)で更新(A)
- `[Q3]` Terraform の検査は `fmt -check` と `validate` のみ(A)
- `[Q4]` デプロイ用の成果物を GitHub Actions のアーティファクトに 7 日保持(A)
- `[memory:M1]` `infrastructure-design/cicd-pipeline.md`(ワークフロー 1 と 2、`deploy.sh` の設計)、`infrastructure-specification.md`(Terraform のファイル構成、変数)
- `[memory:M2]` `requirements.md` の FR1.3、FR5.1〜FR5.4、NFR2.4、NFR2.5、NFR2.7、NFR2.9
- `[memory:M3]` `team.md` の Way of Working(`feature/*` から PR で `main` へ squash)、Testing Posture、`project.md` の ALWAYS / NEVER ルール
- `[scope]` Workflow-selected scope: infra。コード生成とビルド・テストの段階は設計上スキップされているため、既存の `package.json` のスクリプトを基準にした

## 方針

- CI ツールは GitHub Actions。ワークフローは `.github/workflows/ci.yml`(PR の検証)の 1 つを、この段階の対象とする。`deploy.yml`(`main` へのマージ)は次の段階(Deployment Pipeline)で設計する。ただし、ビルドの手順はここで決めた版の固定と同じ規則に従う。
- PR の CI は Google Cloud に認証しない(NFR2.5)。`terraform apply` はワークフローに置かない(NFR2.9、ALWAYS ルール)。
- この文書は設計である。ワークフローと設定ファイルの実ファイルは、実装の段階で、ここの内容どおりに作る。

## ブランチ運用とトリガー

| 項目 | 内容 |
|---|---|
| ブランチ運用 | `feature/*` で作業し、PR で `main` へ squash マージ(トランクベース。`team.md`) |
| トリガー | `pull_request`(対象ブランチは `main`)。`push` の CI は走らせない(`main` への push は `deploy.yml` の担当) |
| パスの絞り込み | しない。必須のステータスチェックは、絞り込みで走らなかった場合に PR が止まるため、全 PR で 3 ジョブとも走らせる |
| 同時実行 | `concurrency` のグループを `ci-${{ github.ref }}`、`cancel-in-progress: true`(古い実行を捨てる) |
| 権限 | ワークフロー全体で `permissions: contents: read` のみ。`id-token` は付けない(NFR2.5) |
| 環境 | Node.js は VM と同じ版(`node_version` と同じ値)に固定する。Terraform は `versions.tf` の `required_version` に合わせた版に固定する |

## ジョブ

3 ジョブは互いに独立で、並列に走る。ジョブ名は、`main` の保護ルールが必須とするステータスチェックの名前と一致させる。

### `terraform`

| 順 | ステップ | 内容 |
|---|---|---|
| 1 | checkout | SHA で固定したアクション |
| 2 | setup | `hashicorp/setup-terraform`(SHA で固定)。`terraform_wrapper: false` |
| 3 | fmt | `terraform fmt -check -recursive -diff`(作業ディレクトリ `infra/terraform`) |
| 4 | init | `terraform init -backend=false -input=false`(state のバケットに触れない) |
| 5 | validate | `terraform validate` |

合否: いずれかの終了コードが 0 でなければ失敗(FR1.3)。`tflint` と静的な検査は追加しない(`[Q3]`)。`plan` は CI で実行しない(Google Cloud の認証が必要になるため)。

### `app`

| 順 | ステップ | 内容 |
|---|---|---|
| 1 | checkout、setup-node | SHA で固定したアクション。`node-version` は固定、`cache: npm` |
| 2 | install | `npm ci` |
| 3 | 型チェック | `npm run typecheck`(`tsc -p tsconfig.json && tsc -p web/tsconfig.json`) |
| 4 | テスト | `npm test`(契約、サーバーの単体、画面の各テスト)と、続けて `npm run test:infra`(HOST、CI のガード、`deploy.sh`、シェルの構文。Code Generation で追加) |
| 5 | 画面のビルド | `npm run build:web`(ビルドが壊れていないことの確認。成果物は残さない) |

合否: いずれかの終了コードが 0 でなければ失敗(FR5.1)。新しいテストの追加は範囲外。`mutation:check` と `e2e/` は、この intent の CI に含めない(既存のスクリプトのうち `package.json` の `test` に含まれるものだけを必須とする)。

### `secrets`(秘密情報と構成の検査)

| 順 | ステップ | 内容 | 要件 |
|---|---|---|---|
| 1 | checkout | `fetch-depth: 0`(履歴全体を検査するため) | NFR2.4 |
| 2 | gitleaks | リリースのバイナリを取得し、固定した SHA-256 で照合してから、履歴全体を検査する。0 件であること | NFR2.4 |
| 3 | tfvars | `git ls-files` に `*.tfvars` が 1 つもない(`terraform.tfvars.example` だけは許可) | NFR2.7 |
| 4 | キーの JSON | `git ls-files` の対象に、`"type": "service_account"` を含むファイルがない | NFR2.4 |
| 5 | 構成の検査 | `.github/workflows/` に `terraform apply`(コメントを除く)がない。`ci.yml` に `google-github-actions/auth` と `id-token` がない | NFR2.5、NFR2.9 |

`gitleaks-action` は使わず、バイナリを直接取得する(組織向けのライセンス条件を避け、取得物を SHA-256 で固定するため)。

## ワークフローの骨格(実装の基準)

実装の段階で、次の形でファイルを作る。`<SHA>` と `<版>` は、実装の時点で公式のリリースから調べて固定する(この文書では推測した値を書かない)。

```yaml
name: ci
on:
  pull_request:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  terraform:
    runs-on: ubuntu-24.04
    defaults:
      run:
        working-directory: infra/terraform
    steps:
      - uses: actions/checkout@<SHA> # v<版>
      - uses: hashicorp/setup-terraform@<SHA> # v<版>
        with:
          terraform_version: <版>
          terraform_wrapper: false
      - run: terraform fmt -check -recursive -diff
      - run: terraform init -backend=false -input=false
      - run: terraform validate
  app:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@<SHA> # v<版>
      - uses: actions/setup-node@<SHA> # v<版>
        with:
          node-version: <VM と同じ版>
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build:web
  secrets:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@<SHA> # v<版>
        with:
          fetch-depth: 0
      # gitleaks のバイナリの取得と SHA-256 の照合、履歴全体の検査
      # tfvars、service_account の JSON、apply と auth の検査(上の表のとおり)
```

## `main` の保護ルール(`[Q1]`)

GitHub のリポジトリの設定(ブランチ保護またはルールセット)で、`main` に次を設定する。これはコードではなく、リポジトリの設定で、所有者が手動で設定する(実装の手順書に書く。API で設定する場合も、実行前に内容を人間が確認する)。

| 項目 | 設定 |
|---|---|
| PR を必須にする | はい(承認者の人数は 0。単独開発のため) |
| 必須のステータスチェック | `terraform`、`app`、`secrets` の 3 つ。マージ前にブランチを最新にすることも必須(`strict`) |
| マージ方法 | squash のみ許可(マージコミットと rebase は無効) |
| 直接の push | 禁止(管理者にも適用) |
| 強制 push と `main` の削除 | 禁止 |
| 会話の解決 | 必須にしない(単独開発のため) |

管理者にも適用するため、CI の設定自体が壊れて必須のチェックが通らなくなった場合は、所有者が設定でルールを一時的に外して直す(手順書に書く)。

## サードパーティのアクションの固定と更新(`[Q2]`)

- すべてのアクションは、コミットの SHA(40 桁)で固定し、行末のコメントに版を書く。
- `.github/dependabot.yml` で、`github-actions` のエコシステムを週 1 回更新する。更新は PR として届き、通常の CI を通ってからマージする。
- 実装の時点で、ワークフローに SHA でないアクションの指定(`@v4` など)が残っていないことを、構成の検査(`secrets` ジョブ)に加える。

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

## 成果物(`[Q4]`)

| 項目 | 内容 |
|---|---|
| 対象 | `deploy.yml` の `build` ジョブが作る、デプロイ用の成果物(`server.mjs`、`schema.sql`、`web/` の tar と、その SHA-256 のファイル)だけ |
| 保持 | GitHub Actions のアーティファクトに 7 日(`retention-days: 7`)。再現用 |
| 名前 | `mobile-order-<リリース ID>`(リリース ID はコミットの SHA) |
| `ci.yml` | アーティファクトを残さない(検証のみ) |
| レジストリ | 使わない(コンテナも、パッケージの公開もない) |
| VM 側 | 直前の 1 世代だけ残す(`cicd-pipeline.md`) |

## 範囲外

- `deploy.yml`、デプロイの転送と実行、スモークテスト、ロールバックの手順の詳細: Deployment Pipeline(次の段階)
- アプリの Prettier と ESLint の導入、カバレッジの計測ツールの導入: この intent のインフラの範囲外(`team.md` の Code Style、`quality-gates.md` の「保留」)

## Assumptions & Open Questions

- `[assumption]` A1: `package.json` の `typecheck`、`test`、`build:web` が、ランナーの Node.js 上で成功する(型チェックとテストは既存のもの。`requirements.md` の FR5.1)。実装の段階で、最初の PR で確認する。
- `[assumption]` A2: リポジトリは GitHub 上にあり、所有者が `main` の保護ルールを設定できる権限を持つ。
- 未確定: 各アクション、Terraform、Node.js、gitleaks の具体的な版と SHA は、実装の段階で公式のリリースから調べて固定する。
- 未確定: `deploy.yml` の `build` ジョブが使う esbuild は、`package.json` の依存に入っていない。依存に加えるか、`build` ジョブで版を固定して取得するかは、Deployment Pipeline で決める(アプリのコード変更は `HOST` の最小変更だけが例外のため、依存の追加の可否も、そこで人間に確認する)。
