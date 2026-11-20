# CD 設定: mobile-order の Google Cloud デプロイ

## Sources

- `[Q1]` esbuild は `devDependencies` に版を固定して加え、`package-lock.json` を更新する(A)。`deployment-pipeline-questions.md` の人間の回答
- `[Q2]` デプロイのジョブは GitHub Environment `production` を使い、`GCP_*` のシークレットをそこに置く。承認者は設定しない(A)
- `[Q3]` `aidlc/`、`aidlc-docs/`、`infra/`、Markdown だけを変えた `main` への push はデプロイしない。`paths-ignore` はデプロイの `push` トリガーにだけ付け、PR の必須チェックには付けない(A、人間の補足つき)
- `[Q4]` `workflow_dispatch` で、リリース ID(コミットの SHA)を入力して再デプロイできるようにする(A)
- `[Q5]` 失敗時の GitHub の既定のメール通知に加え、ジョブの要約に結果を出す(A)
- `[memory:M1]` `construction/ci-pipeline/ci-config.md`(版の固定、SHA 固定、Dependabot、成果物の 7 日保持、`main` の保護)、`construction/ci-pipeline/quality-gates.md`(デプロイ前のゲート G1〜G11)
- `[memory:M2]` `construction/infrastructure-design/cicd-pipeline.md`(ワークフロー 2 と `deploy.sh` の設計)、`construction/infrastructure-design/infrastructure-specification.md`(WIF、IAM、配置パス、変数)
- `[memory:M3]` `requirements.md` の FR5.2〜FR5.4、FR6、NFR2.4、NFR2.5、NFR5.3、NFR5.4、NFR6.6、NFR7.5。`reliability-design.md` 3 節
- `[memory:M4]` `team.md` の Deployment(`main` へのマージで自動デプロイ、`terraform apply` は毎回手動で承認)、`project.md` の ALWAYS / NEVER ルール
- `[scope]` Workflow-selected scope: infra

## 方針

- CD は `.github/workflows/deploy.yml` の 1 つ。`terraform apply` は置かない(NFR2.9、ALWAYS ルール)。
- Google Cloud への認証は Workload Identity Federation だけ。キーは使わない(NFR2.4、NEVER ルール)。
- ビルドはランナーで行い(R-09 の決定)、VM には成果物(`server.mjs`、`schema.sql`、`web/`)だけを送る。VM には `node_modules` も TypeScript も入れない。
- 成果物の出どころの保証は「`main` だけが WIF で認証できる」ことと、デプロイ前の CI の必須チェックである(`cicd-pipeline.md`)。
- この文書は設計である。ワークフローの実ファイルは、実装の段階で、ここの内容どおりに作る。

## トリガー

| 項目 | 内容 |
|---|---|
| `push` | 対象は `main`。`paths-ignore`: `aidlc/**`、`aidlc-docs/**`、`infra/**`、`**/*.md`(`[Q3]`)。この絞り込みは `deploy.yml` にだけ置き、`ci.yml`(PR の必須チェック)には置かない(`ci-config.md` のとおり) |
| `workflow_dispatch` | 入力 `release_id`(必須。40 桁の小文字の 16 進。`[Q4]`)。`paths-ignore` の影響を受けない。`main` のワークフローからだけ認証できる(WIF の許可条件)。`main` 以外のブランチから実行しても、`deploy` ジョブの認証で失敗する |
| 同時実行 | `concurrency: group: deploy`、`cancel-in-progress: false`。デプロイが同時に 2 つ走らず、待たされる |
| 権限 | ワークフロー全体は `permissions: contents: read`。`id-token: write` は `deploy` ジョブだけに付ける |

`infra/` を変えただけのマージではアプリを入れ替えない。インフラの反映は、人間の承認のあとの手動の `terraform apply` が担当する(`infrastructure-specification.md`)。

## リリース ID と対象のコミット

- リリース ID は、デプロイするコミットの SHA(40 桁)。成果物の名前、VM 上の `releases/<ID>/`、アーティファクト名 `mobile-order-<ID>` のすべてに同じ値を使う。
- `push` では `github.sha`。`workflow_dispatch` では入力 `release_id`。
- `workflow_dispatch` の入力は、次の検査を最初のステップで行う。どれかに失敗したらジョブを失敗として終了する。
  - `^[0-9a-f]{40}$` に一致すること(`deploy.sh` の入力検査と同じ規則)。
  - `git fetch` した `origin/main` の履歴に含まれるコミットであること(`git merge-base --is-ancestor <ID> origin/main`)。`main` に入っていないコミットをデプロイしない。
- `actions/checkout` は、そのリリース ID のコミットをチェックアウトする。

## ジョブ

### `build`(Google Cloud に触れない)

| 項目 | 内容 |
|---|---|
| 権限 | `contents: read` のみ |
| 環境 | Node.js は VM と同じ固定の版(`node_version`。NFR7.5)。`actions/setup-node` の `cache: npm` |

| 順 | ステップ | 内容 | 要件 |
|---|---|---|---|
| 1 | checkout と入力検査 | 上の「リリース ID と対象のコミット」。`fetch-depth: 0` | `[Q4]` |
| 2 | 依存の取得 | `npm ci`(esbuild は `devDependencies` にあり、ロックファイルで版と整合性が固定される。`[Q1]`) | NFR5.4 |
| 3 | 画面のビルド | `npm run build:web`(出力は `web/dist`) | FR5.2 |
| 4 | サーバーのまとめ | `npm run build:server`(esbuild 0.28.2 を `devDependencies` に固定。`esbuild server/src/index.ts --bundle --platform=node --format=esm --target=node24 --banner:js=<createRequire> --outfile=build/server.mjs` のあと、`server/src/db/schema.sql` を `build/schema.sql` へコピー)。`node:` の組み込みは外部扱い。ESM に `createRequire` の banner が要る。`schema.sql` は、アプリが起動時に `server.mjs` と同じ場所から読むため、同梱する。ソースマップは付けない | FR5.2、NFR5.4 |
| 5 | 起動の確認 | ランナーで `node build/server.mjs` を、`node_modules` のない場所から、`HOST=127.0.0.1 PORT=3000 DB_PATH=<一時ファイル>` で起動し、`GET /menu` が 200(最大 30 秒待つ)。動かなければここで失敗にする。終了後にプロセスを止める | NFR5.4 |
| 6 | 成果物の作成 | `build/server.mjs`、`build/schema.sql`、`web/dist` の中身を `web/` として、1 つの tar にまとめる(最上位は `server.mjs`、`schema.sql`、`web/` だけ)。`tar --sort=name --owner=0 --group=0 --numeric-owner` で作り、`gzip` する。ファイル名は `<ID>.tar.gz`。SHA-256 を `<ID>.sha256` に書く | `cicd-pipeline.md` |
| 7 | 成果物の保存 | `actions/upload-artifact`(SHA で固定)。名前 `mobile-order-<ID>`、`retention-days: 7`、対象は `<ID>.tar.gz` と `<ID>.sha256` だけ | `[Q4]`(CI)、`ci-config.md` |

ビルドの手順 4 の `server/src/index.ts` は既存のエントリポイントである(`package.json` の `dev:server`)。ビルドの手順 5 で `GET /menu` が通らない場合は、`--format=cjs` への切り替えを検討する(`performance-design.md`)。この判断は、ウォーキングスケルトンの最初の合格条件で行う。

### `deploy`(`needs: build`)

| 項目 | 内容 |
|---|---|
| 権限 | `id-token: write` と `contents: read` |
| Environment | `production`(`[Q2]`)。承認者は設定しない。ブランチの制限は `main` だけにする(Environment のデプロイブランチの設定) |
| シークレット | Environment `production` の `GCP_PROJECT_ID`、`GCP_WIF_PROVIDER`、`GCP_DEPLOY_SA`、`GCP_ZONE`、`GCP_VM_NAME`。値は `terraform output` から入れる。サービスアカウントキーは置かない |

| 順 | ステップ | 内容 | 要件 |
|---|---|---|---|
| 1 | 成果物の取得 | `actions/download-artifact`(SHA で固定)。`build` が保存した `<ID>.tar.gz` と `<ID>.sha256` | |
| 2 | 照合 | ランナー上で `sha256sum -c`。転送前の破損の検出用 | NFR5.4 |
| 3 | 認証 | `google-github-actions/auth`(SHA で固定)。`workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}`、`service_account: ${{ secrets.GCP_DEPLOY_SA }}`。キーは使わない | NFR2.4、NFR2.5、FR6.1 |
| 4 | gcloud | `google-github-actions/setup-gcloud`(SHA で固定) | |
| 5 | 受け取り用のディレクトリ | `gcloud compute ssh "$GCP_VM_NAME" --zone "$GCP_ZONE" --project "$GCP_PROJECT_ID" --tunnel-through-iap --quiet -- mkdir -p incoming`(`incoming/` は起動スクリプトが作成済みで、ホームは root 所有。ここでは何も変わらないが、ssh の疎通の確認を兼ねる。失敗したら起動スクリプトの再実行へ進む。ウォーキングスケルトンでは、(1) 起動後の `getent passwd sa_<unique_id>`、(2) ホームの所有者が root のままであること、(3) 初回の `scp` が通ること、を順に確認する) | `[Q2]`(インフラ設計) |
| 6 | 転送 | `gcloud compute scp --tunnel-through-iap`(同じ `--zone` と `--project`)で、`<ID>.tar.gz` と `<ID>.sha256` を `~/incoming/` に置く | `cicd-pipeline.md` |
| 7 | 実行 | `gcloud compute ssh ... --tunnel-through-iap --quiet -- sudo /usr/local/sbin/mobile-order-deploy <ID>`。引数はリリース ID だけ。出力はジョブのログに残す | `cicd-pipeline.md`、NFR6.6 |
| 8 | 結果 | `deploy.sh` の終了コード、`free -m` の記録の判定、スモークテストの出力を、ジョブの要約(`$GITHUB_STEP_SUMMARY`)に出す(`[Q5]`)。終了コードが 0 でなければジョブを失敗にする | `[Q5]`、NFR5.3 |

要約に出す内容(`[Q5]`):

| 項目 | 内容 |
|---|---|
| リリース ID | デプロイしたコミットの SHA と、トリガーの種類(`push` / `workflow_dispatch`) |
| スモークテスト | `GET /` と `GET /api/menu` の結果(ステータスコードと、`items` の件数) |
| ロールバック | 自動ロールバックが動いたか、その後のスモークテストの結果、所要時間 |
| メモリ | `free -m` の記録の判定(スワップの最大と `available` の最小) |
| 失敗時 | 失敗した版の `server.mjs` の SHA-256 と、スモークテストの出力(原因調査用。`reliability-design.md` 3 節) |

失敗時は、GitHub の既定のメール通知(ワークフローの失敗)が、リポジトリの所有者に届く。追加のサービスや秘密情報は使わない。

## ワークフローの骨格(実装の基準)

`<SHA>` と `<版>` は、実装の時点で公式のリリースから調べて固定する。この文書では推測した値を書かない。

```yaml
name: deploy
on:
  push:
    branches: [main]
    paths-ignore:
      - "aidlc/**"
      - "aidlc-docs/**"
      - "infra/**"
      - "**/*.md"
  workflow_dispatch:
    inputs:
      release_id:
        description: "デプロイするコミットの SHA(40 桁、main に含まれるもの)"
        required: true
concurrency:
  group: deploy
  cancel-in-progress: false
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
    outputs:
      release_id: ${{ steps.id.outputs.release_id }}
    steps:
      - uses: actions/checkout@<SHA> # v<版>
        with:
          fetch-depth: 0
          ref: ${{ inputs.release_id || github.sha }}
      # id: リリース ID の決定と検査(40 桁、origin/main の履歴に含まれる)
      # npm ci、画面のビルド、esbuild、起動の確認、tar と SHA-256、upload-artifact
  deploy:
    needs: build
    runs-on: ubuntu-24.04
    environment: production
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/download-artifact@<SHA> # v<版>
      - uses: google-github-actions/auth@<SHA> # v<版>
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@<SHA> # v<版>
      # 受け取り用のディレクトリ、転送、実行、要約(上の表のとおり)
```

## `ci.yml` との関係とゲート

- `deploy.yml` は `ci.yml` のゲート(G1〜G11)を迂回しない。`main` への直接の push は禁止され、PR の必須チェックを通った変更だけが `main` に入る(`quality-gates.md` の G11)。
- `deploy.yml` の `build` ジョブの `permissions` と `uses:` の SHA 固定は、`ci.yml` の構成の検査(G9、G10)の対象になる。`deploy.yml` には `terraform apply` を置かない(G9)。
- `deploy.yml` にだけ `google-github-actions/auth` と `id-token: write` を許す。G9 の検査は、`ci.yml` について行う。

## Assumptions & Open Questions

- `[assumption]` A1: Environment `production` を使うと OIDC の `sub` が `repo:<owner>/<repo>:environment:production` になるが、WIF の `attribute_mapping` と `attribute_condition`(`repository` と `ref`)は `sub` に依存しないため、`main` のデプロイは認証できる。ウォーキングスケルトンで、`workflow_dispatch` を含めて確認する。
- `[assumption]` A2: Environment のデプロイブランチの制限を `main` だけにしても、`workflow_dispatch` を `main` 上のワークフローから実行する限り、ジョブは止まらない。ウォーキングスケルトンで確認する。
- `[assumption]` A3: `server/src/index.ts` が、esbuild で 1 つの ESM ファイルにまとめられる。動かない場合は `--format=cjs` に切り替える(`performance-design.md`)。
- `[assumption]` A4: OS Login のユーザー名は `sa_<unique_id>`、ホームは `/home/sa_<unique_id>`(`cicd-pipeline.md` の A1)。ウォーキングスケルトンで確認する。
- 未確定: esbuild、各アクション、Node.js の具体的な版と SHA は、実装の段階で公式のリリースから調べて固定する。`devDependencies` への esbuild の追加と `package-lock.json` の更新は、実装の段階で人間に内容を示してから行う(アプリのコード変更は `HOST` の最小変更だけが例外のため、依存の追加はコードではなく設定の変更として示す)。
- 未確定: Environment `production` の作成と、そのデプロイブランチの制限、`GCP_*` のシークレットの登録は、リポジトリの設定で所有者が手動で行う(手順書に書く)。
