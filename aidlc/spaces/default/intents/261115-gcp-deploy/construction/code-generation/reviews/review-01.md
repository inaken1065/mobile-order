## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-20T20:32:50Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

**Prior findings**

| ID | Now | Severity | Note |
|---|---|---|---|

**New findings**

| Severity | Location | Finding | Required action |
|---|---|---|---|
| Major | infra/test/deploy-script.test.ts > 「tar にシンボリックリンクや .. を含む成果物は拒否する」ほか | deploy.sh は root で展開するため tar の検査が最も重要だが、テストで確認しているのはシンボリックリンクと `..` の 2 つだけ。ハードリンク、デバイス、絶対パス、制御文字を含む名前、最上位の許可リスト外(例: `evil.txt`)、新たに追加した `schema.sql` が欠けた成果物は、deploy.sh に分岐があるのにテストがない。 | それぞれ 1 件ずつ拒否のテストを追加する。特に `schema.sql` の許可リスト(完全一致であること、無いと失敗すること)と、ハードリンクと絶対パスの拒否を入れる。 |
| Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/cicd-pipeline.md > root での展開の安全策(c)、および operation/deployment-pipeline/cd-config.md > 手順 4 と 6 | 実装は成果物の最上位を `server.mjs`、`schema.sql`、`web/` の 3 つにし(deploy.sh 169 行、deploy.yml 107 行、`build:server`)、`--banner:js` と `cp` を足している。設計文書は「最上位は `server.mjs` と `web/` だけ」、esbuild のコマンドも別のままで、実装と設計が食い違う。これは許可リストを広げるセキュリティ上の変更で、code-summary.md も「人間の確認が必要」としているが、文書の側は未更新。 | 人間が差異 1 を承認したうえで、cicd-pipeline.md と cd-config.md(ビルド手順と esbuild のコマンドを含む)を実装に合わせて更新する。承認されなければ、実装を設計に戻す。 |
| Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > データディスク(1)、および infra/terraform/startup.sh.tpl > setup_data_disk と末尾 | 設計は「ディスクが現れなければ何もせずに終了」だが、実装は失敗を記録して残りの設定(sudoers、deploy.sh、Caddy など)を続け、最後に失敗で終了する。`mkfs` へ進まない点は確認できたが、差異 2 は設計文書に未反映。 | 差異 2 を人間が承認したうえで、infrastructure-specification.md を実装に合わせる。 |
| Minor | .gitignore | `npm run build:server` の出力先 `build/`(server.mjs、schema.sql)が除外されておらず、`git add -A` でコミットされうる。 | `build/` を `.gitignore` に追加する(code-summary.md の未確定事項 3 の決定を人間に求める)。 |
| Minor | infra/terraform/files/mobile-order-deploy.sh > 137〜144 行 | `[ -L ]` の確認のあとに `install` でコピーするため、確認とコピーの間でシンボリックリンクに差し替えられる余地がある。コピー後に SHA-256 と tar の検査があり、読めたとしても root のファイルは成果物として通らないため、影響は小さい。 | `install` の前後で、コピー後の通常ファイルであることの確認を加えるか、残るリスクとして記録する。 |
| Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/code-generation/traceability.json > FR2.5 | FR2.5(2 回目以降の起動や再デプロイで既存データを上書きしない)の target が deploy.sh だけで、データを守る実体(アプリの `n === 0` のシードと `/mnt/data` の分離)を指していない。deploy.sh を検証するテストも、DB を触らないことを確かめていない。 | target に `server/src/index.ts` と `compute.tf` のデータディスクを加えるか、状態を Deferred にして実機での確認を明記する。 |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| `npm run test:infra` | 21 件合格、失敗 0 | code-summary.md の「21 件合格」と一致。deploy-script のテストは root では skip される(CI は非 root なので影響なし) |
| `npm run typecheck` | エラーなし | 一致 |
| `terraform fmt -check -recursive` | 終了コード 0 | 合格 |
| `terraform validate` | Success | 合格。実リソースの値は未検証(code-summary.md の記述どおり) |
| `bash scripts/ci-guards.sh .` | 違反なし | サービスアカウントキー、tfvars、ワークフローの apply、SHA 未固定の `uses:` はなし |

確認した事項: ファイアウォールは 80 番が `allowed_ip_cidr`(0.0.0.0/0 は validation で拒否)、22 番が `35.235.240.0/20` のみ。WIF の attribute_condition は repository と `refs/heads/main` の両方。IAM はすべて VM 単位かカスタムロールで、editor、owner、キーはなし。sudoers は deploy.sh のフルパス 1 本。root では `MO_TEST_ROOT` を拒否する。実際のプロジェクト ID、IP、メールは tfvars.example のプレースホルダーのみ。mobile-order.service は reliability-design.md の 27〜40 行と一致し、`After=local-fs.target` を足しただけ。traceability.json は NFR2.12、NFR2.9、FR1.3 などを抜き取りで確認し、実装と一致した。code-summary.md は未実行のテスト(gitleaks、shellcheck、実機、plan/apply)を実行済みとしておらず、開発担当の報告にとどまるものにはその旨を付けている。

### Summary

セキュリティ面で設計を弱めた実装は見つからず、検証コマンドもすべて合格したため READY とする。ただし、root で動く tar 検査のテストが不足している点と、`schema.sql` の追加と起動スクリプトの順序の変更を設計文書に反映していない点は、承認の際に人間が判断すること。
