# Code Generation のまとめ: mobile-order の Google Cloud デプロイ

## Sources

- `[scope]` Workflow-selected scope: infra。`/aidlc --stage code-generation --single` による単独実行(ゼロ Unit)
- `[memory:M1]` `code-generation-plan.md`(承認済み)、`unit-test-instructions.md`
- `[memory:M2]` 開発担当の最終報告(実行したコマンドと結果、版の固定、設計との差異)と、この文書を書く前にオーケストレーターが再実行した `npm run test:infra`(33 件合格。レビュー後の修正を含む)と `npm run typecheck`(エラーなし)
- `[memory:M3]` 設計の文書: `infrastructure-specification.md`、`cicd-pipeline.md`、`reliability-design.md`、`ci-config.md`、`quality-gates.md`、`cd-config.md`、`deployment-strategy.md`、`rollback-runbook.md`

## 作ったファイル

| 区分 | ファイル |
|---|---|
| アプリ(1 行) | `server/src/index.ts`(`host: process.env.HOST ?? '0.0.0.0'`) |
| 設定 | `package.json`(`esbuild` 0.28.2 を固定、`build:server`、`test:infra`)、`package-lock.json` |
| Terraform | `infra/terraform/` の `versions.tf`、`backend.tf`、`variables.tf`、`terraform.tfvars.example`、`outputs.tf`、`network.tf`、`compute.tf`、`iam.tf`、`.terraform.lock.hcl` |
| VM | `infra/terraform/startup.sh.tpl`、`infra/terraform/files/` の `mobile-order-deploy.sh`、`Caddyfile`、`mobile-order.service`、`caddy-order.conf`、`journald-mobile-order.conf`、`sysctl-mobile-order.conf` |
| CI/CD | `.github/workflows/ci.yml`、`.github/workflows/deploy.yml`、`.github/dependabot.yml`、`scripts/ci-guards.sh` |
| テスト | `server/test/app/host-binding.test.ts`(3)、`scripts/test/ci-guards.test.ts`(6)、`infra/test/deploy-script.test.ts`(20)、`infra/test/shell-syntax.test.ts`(4) |
| 設計文書 | `ci-config.md` と `quality-gates.md` に `app` ジョブの `npm run test:infra`(G4 の追加)。レビュー後に人間の指示で、`cicd-pipeline.md`、`cd-config.md`、`infrastructure-specification.md`、`reliability-design.md`、`logical-components.md`、`ci-config.md` を実装に合わせて更新(`schema.sql` の同梱ほか) |

## 主な実装の決定

- `deploy.sh` の終了コードを分けた(0 成功、1 デプロイ前の失敗、3 成功だがメモリの基準超過、10 ロールバックして復旧、11 ロールバックにも失敗、12 未マウント、13 戻す先なし)。`deploy.yml` の要約が、この対応でメッセージを出す。
- `deploy.sh` は、パスを先頭の定数にまとめた。`MO_TEST_ROOT` とテスト用の時間の上書きは、root 以外のときだけ受け付け、root では `MO_TEST_ROOT` を拒否して終了コード 1 で終わる(テストで確認済み)。本番では `PATH` を固定する。
- esbuild の ESM のバンドルは、`--banner:js` で `createRequire` を足して動かした(`performance-design.md` の第 1 の対策)。`--format=cjs` への切り替えは要らなかった。
- `allowed_ip_cidr` に `0.0.0.0/0` を指定すると、Terraform の検証(`variables.tf` の `validation`)で拒否する。設計にない追加で、弱める方向ではない。
- IAM のスコープは、設計どおり可能なものを VM 単位にした。`roles/editor`、`roles/owner`、`google_service_account_key` は置いていない。

## 設計との差異と未解決の点

次の 1 と 2 は、人間の指示で設計文書へ反映済み(下の「人間の指示による修正」)。

1. **成果物に `schema.sql` を加えた(セキュリティに関わる設計変更。確認が必要)**。アプリは `db.ts` で `new URL('./schema.sql', import.meta.url)` を実行時に読むため、`server.mjs` 1 つにまとめると起動時に ENOENT になった(再現済み)。アプリのコードを変えられないため、`npm run build:server` が `build/schema.sql` も作り、成果物の最上位を `server.mjs`、`schema.sql`、`web/` の 3 つにし、`deploy.sh` の最上位の許可リストに固定名 `schema.sql` を 1 件だけ追加した(完全一致。存在も必須)。シンボリックリンク、`..`、絶対パス、制御文字の拒否は弱めていない。`cicd-pipeline.md` と `cd-config.md` の「最上位は `server.mjs` と `web/` だけ」と差異がある。別案は、esbuild のプラグインで build 時にスキーマを埋め込む方法だが、ソースの文字列置換になり脆い。
2. **起動スクリプトの順序の変更(確認が必要)**。設計は「データディスクが見つからなければ何もせずに終了」。実装は、ディスクの失敗を記録し、ユニット、Caddy、`deploy.sh`、sudoers などの設定を続けてから、最後に失敗で終了する。アプリは起動しない。`mkfs` へは決して進まない。失敗しても、手順書の再実行で足りる状態にするための変更。
3. `.gitignore` に `build/` を追加した(人間の指示。上の「人間の指示による修正」)。
4. `build:server` は `esbuild ... && cp ...` の 2 段のシェルコマンドで、POSIX シェルが前提(CI と開発環境は Linux と WSL)。
5. VM のサービスアカウントには、設計に指定がなかったため `logging.write` のスコープだけを付けた(ロールはなし)。不要なら空にできる。
6. `host-binding.test.ts` は既存の `test:units` の glob(`server/test/*/*.test.ts`)にも入る。CI の `app` ジョブでは `npm test` と `test:infra` の 2 回実行される。害はないが、重複を避けるなら `test:infra` から外せる。
7. `npm install` が `esbuild@0.28.2` の postinstall について `allowScripts` の警告を出した。ビルドは成功している。
8. 実機でしか確認できないもの: `compute.projects.get` の最小ロールで足りるか、`roles/compute.osLogin` が `compute.instances.get` を含むか、OS Login のユーザー名 `sa_<unique_id>`、Debian 12 の Caddy の版、WIF と Environment `production` の組み合わせ。

## 固定した版

公式の情報(GitHub API、nodejs.org)で確認したもの:

- `actions/checkout` v7.0.1、`actions/setup-node` v7.1.0、`actions/upload-artifact` v7.0.2、`actions/download-artifact` v8.0.2、`hashicorp/setup-terraform` v4.0.1、`google-github-actions/auth` v3.0.0、`google-github-actions/setup-gcloud` v3.0.1(いずれもコミットの SHA で固定。SHA は各ワークフローにある)
- gitleaks v8.30.1(linux_x64 の SHA-256 は、バイナリと同じ GitHub のリリースのチェックサムから取得。独立した出どころではない)
- Node.js 24.22.2(`ci.yml` と `deploy.yml`)。VM の `node_version` と `node_sha256` は Terraform の変数で、リポジトリには書かない(`terraform.tfvars` で渡す)
- Terraform CLI 1.17.2、google provider `~> 7.46`(ロックは 7.46.2)、esbuild 0.28.2

未確認・弱い点: `google-github-actions/auth` は v3.0.0 に固定した(より新しい 3.x がある可能性があり、Dependabot が更新する)。`gitleaks detect` は v8.30.1 でも動く想定だが、この環境では確認していない。`TODO(版の固定)` と `<SHA>` のプレースホルダーは残していない。

## テスト

| コマンド | 結果 |
|---|---|
| `npm run test:infra`(4 ファイルの合計) | 33 件合格(host-binding 3、ci-guards 6、deploy-script 20、shell-syntax 4) |
| `npm test`(既存の契約、サーバー、画面) | 全件合格(開発担当の報告。サーバーの件数に host-binding の 3 件を含む) |
| `npm run typecheck` | エラーなし |
| `terraform fmt -check -recursive`、`init -backend=false`、`validate` | 終了コード 0、Success(開発担当の報告) |
| `bash scripts/ci-guards.sh .`(実リポジトリ) | 違反 0 件(開発担当の報告) |
| `deploy.yml` のビルドの手順の再現 | 成功。`node_modules` なしで `node server.mjs` が起動し、`GET /menu` が 200(開発担当の報告) |

## 実行していないテストと理由

- `gitleaks` と `shellcheck`: この環境にない。`ci.yml` が GitHub 上で実行する(gitleaks)。`shellcheck` は CI にも入れていない。実行したことにしない。
- GitHub 上の CI、WIF と Environment `production` の組み合わせ、実際の VM でのデプロイ、`startup.sh` の実機での動作(構文の確認 `bash -n` だけ)、`terraform plan` と `apply`: 認証と課金が必要で、この作業の範囲外。Environment Provisioning で、人間の承認のもとで確認する。
- `terraform validate` は構文と参照だけを見る。`templatefile` の描画は `terraform console` で確認した(5,545 文字)。実リソースの値は検証していない。

## カバレッジ

アプリの 80% 行カバレッジと、Testing Contract の 80% の下限は、計測ツールが未導入のため計測していない。目標は弱めていない。Build and Test、またはツールを導入する作業で扱う。Terraform とシェルには行カバレッジの下限を設けない(`team.md`)。

## 人間の指示による修正(レビューの後)

レビューの指摘を受けて、人間の指示で次を直した。

- 設計文書の差異(`schema.sql` の同梱、許可リスト、データディスクがないときの起動スクリプトの動き)を、`cicd-pipeline.md`、`cd-config.md`、`ci-config.md`、`infrastructure-specification.md`、`reliability-design.md` に反映した。
- `deploy-script.test.ts` に、ハードリンク、デバイスと FIFO、絶対パス、制御文字(改行)、許可リスト外の最上位(類似名を含む)、`schema.sql` の欠落、`incoming` の成果物がシンボリックリンクの 7 件を追加した(合計 16 件)。
- 制御文字の検査が実際には効いていなかったため直した: `tar -t` は制御文字を `\001` などの形に変えて表示するので、`[[:cntrl:]]` の検査だけでは見逃していた。バックスラッシュも拒否する。
- `deploy.sh` は、`incoming` の成果物をリンクをたどらずに(`cp -P`)root 所有の `work/` へコピーし、検査はすべてコピーに対して行う。検査と配置の間の差し替えの余地をなくした。
- `incoming` ディレクトリ自体の差し替え対策(人間の指示。`O_NOFOLLOW` は使わない方式): 起動スクリプトが、デプロイ用ユーザーのホームを `root:root`・`0755` にし、`incoming/` だけをそのユーザーの所有にする。`deploy.sh` は最初に、ホームがリンクでなく root 所有で group と other に書き込み権限がないこと、`incoming/` がリンクでないことを確認する。テストを 5 件追加した(`deploy-script.test.ts` に 4 件、`shell-syntax.test.ts` に 1 件)。`cp` には 60 秒の `timeout` を付けた。
- `.gitignore` に `build/` を追加した。
- `traceability.json` の FR2.5(再デプロイでデータが残ること)は、`Deferred` にして次のステージへ申し送る。

## 計画からの逸脱

- 上の「設計との差異」の 1(`schema.sql`)と 2(起動スクリプトの順序)。計画の範囲(`deploy.sh` の許可リスト)の中だが、設計文書からの差異である。
- 開発担当は実行中に、サンドボックスの保護検査が一度 `rm -rf` を拒否したと報告している。その後、生成物の `build/` だけを削除した。それ以外のファイルは削除していない。

## Assumptions & Open Questions

- `[assumption]` A1: 上の差異 1 と 2 は、セキュリティを弱める変更ではない(許可リストの 1 件追加と、失敗時の設定の継続)。人間の指示により、設計文書へ反映済み。
- 解決済み: 差異 1 と 2 は設計文書に反映した(人間の指示)。
- 解決済み: `.gitignore` に `build/` を追加した。
- 解決済み: `incoming` ディレクトリ自体の差し替えは、ホームの所有者の変更で防ぐ(上)。成果物のファイル名は ASCII 限定(`cicd-pipeline.md` に記載)。
- 実機でしか確認できない: OS Login のホームが、起動スクリプトの時点で `getent passwd` から引け、`root` 所有のままでも `gcloud compute ssh/scp`(IAP)が動くこと、OS Login の初回ログインがすでにあるホームを壊さないこと。

## Deployment Execution で実機確認する項目

- OS Login のホームディレクトリの所有者(root:root、0755)を変える処理の順序(`startup.sh.tpl`)。
  - 新規 VM で、起動スクリプトの時点で `getent passwd sa_<unique_id>` が引けること。引けなければ `INCOMING_FAILED` になり、最初のデプロイが失敗する。
  - root 所有のホームで、OS Login の初回ログインと `gcloud compute ssh/scp`(IAP)が動くこと。
  - 出どころ: コードレビュー(2026-11-21)の指摘。構文確認(`bash -n`)ではわからないため、実機で確認する。
