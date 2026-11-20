# デプロイ戦略: mobile-order の Google Cloud デプロイ

## Sources

- `[Q3]` デプロイのトリガーの範囲、`[Q4]` 手動の再デプロイ、`[Q5]` 結果の通知。`deployment-pipeline-questions.md` の人間の回答
- `[memory:M1]` `operation/deployment-pipeline/cd-config.md`(ジョブの定義)、`construction/ci-pipeline/ci-config.md`、`construction/ci-pipeline/quality-gates.md`(G1〜G11)
- `[memory:M2]` `construction/infrastructure-design/cicd-pipeline.md`(`deploy.sh` の設計、環境の昇格、機能フラグ、アーティファクト)、`construction/infrastructure-design/infrastructure-specification.md`(配置パス、IAM、課金の見積もり)
- `[memory:M3]` `construction/nfr-design/reliability-design.md` 3 節(デプロイとロールバック)、`requirements.md` の FR5、FR6、FR7、NFR3.3、NFR3.4
- `[memory:M4]` `team.md` の Deployment、`project.md` の ALWAYS / NEVER ルール、`phases/operation.md`(ロールバックの手順、スモークテスト、インフラの安全)
- `[scope]` Workflow-selected scope: infra

## 戦略の要約

| 項目 | 決定 | 根拠 |
|---|---|---|
| 方式 | `current` のシンボリックリンクの切り替え(VM 1 台、ローリングに近い単純な切り替え)。ブルーグリーンとカナリアは使わない | VM が 1 台で、数秒〜数十秒の停止は許容する(`cicd-pipeline.md`、`reliability-design.md` の「受け入れたリスク」) |
| 環境 | 本番相当の 1 つだけ。環境の昇格(dev、staging、prod)はない | `team.md`(Q7) |
| 昇格のゲート | なし。代わりに、デプロイ前に CI のゲート(G1〜G11)を必須にする | `quality-gates.md` |
| 本番の承認(アプリ) | `main` へのマージで自動。人間の承認は、PR のマージの時点で取る | `team.md`(Q8)。GitHub Environment `production` に承認者は置かない(`[Q2]`) |
| 本番の承認(インフラ) | `terraform apply` は毎回、人間が `plan` と月額の見積もりを確認して承認し、手動で実行する。ワークフローには置かない | ALWAYS ルール、FR7 |
| 機能フラグ | なし。外部のサービス(CloudWatch Evidently、AppConfig など)も使わない | `cicd-pipeline.md`。AWS のサービスは対象外 |
| データベースの移行 | デプロイに含めない。SQLite は `/mnt/data` にあり、リリースのディレクトリに入らない。この intent ではアプリのコードを変えないため、スキーマ変更はない。将来スキーマを変える場合は、後方互換(expand と contract)で、別の作業として設計する | FR2.5、`reliability-design.md` |
| 成果物の管理 | GitHub Actions のアーティファクトに 7 日。VM には現在の版と直前の 1 世代だけ。コンテナのレジストリは使わない | `ci-config.md`、`cicd-pipeline.md` |
| 版の付け方 | コミットの SHA(40 桁)をリリース ID とする。タグ(semver)は付けない | 単独開発で、リリースの単位が 1 コミットのため |

## デプロイの流れ

1. PR が、CI の 3 つの必須チェック(`terraform`、`app`、`secrets`)を通り、`main` に squash マージされる。
2. `main` への push が `deploy.yml` を起動する(`aidlc/`、`aidlc-docs/`、`infra/`、Markdown だけの変更は起動しない。`[Q3]`)。
3. `build` ジョブがランナーでビルドし、起動の確認(`GET /menu` が 200)を通った成果物をアーティファクトに保存する。
4. `deploy` ジョブが WIF で認証し、IAP 経由で成果物を VM に送って、`mobile-order-deploy <リリース ID>` を実行する。
5. `deploy.sh` が、展開、`current` の切り替え、再起動、メモリの計測、スモークテストを行う。
6. 合格なら、直前の 1 世代を残して古い版を削除する。不合格なら、自動ロールバックを行う(下)。
7. ジョブの要約に結果を出す。失敗なら、GitHub の既定のメールが届く(`[Q5]`)。

`workflow_dispatch`(`[Q4]`)は、手順 1 と 2 を飛ばして 3 から始める。リリース ID の入力は、40 桁で、かつ `main` の履歴に含まれるコミットだけを受け付ける(`cd-config.md`)。

## スモークテストとロールバックの条件

スモークテストとロールバックの条件は、`reliability-design.md` 3 節と `cicd-pipeline.md` の `deploy.sh` の設計が唯一の正である。ここでは要約を示す。

| 項目 | 内容 |
|---|---|
| スモークテスト | VM 上の `localhost` に対して、デプロイ完了後 60 秒以内に、`GET /`(200)と `GET /api/menu`(200 と `{ items }` の JSON)の両方(FR5.3、NFR5.5) |
| ロールバックの契機 | スモークテストの不合格、またはデプロイ手順の非 0 の終了(FR5.4) |
| ロールバックの動作 | `current` を直前の版に戻して再起動し、同じスモークテストを実行する。ロールバックの開始から 120 秒以内に合格することが合格条件(NFR3.3) |
| 意図的な例外 | データディスクが未マウント(`mountpoint -q /mnt/data` が非 0)のときは、ロールバックしても直らないため、ロールバックせずに非 0 で終了する。手順書のマウントの確認に進む |
| 端の場合 | 初回デプロイ(`prev` なし)と同じ ID の再デプロイは、ロールバックせずに非 0 で終了する。失敗した版のディレクトリは、`current` でも `prev` でもない場合だけ削除する |
| 中断の条件(abort) | 入力の検査(40 桁でない、成果物がない、SHA-256 が合わない)、展開前の一覧の検査(シンボリックリンクなどの異常)の失敗は、`current` を切り替える前に非 0 で終了する(何も変わらない) |
| 切り替えの基準 | 段階的な切り替えはない(トラフィックの割合を変える方式ではない)。ブルーグリーンとカナリアの「トラフィックの切り替え基準」は、該当しない |

## セキュリティの影響と危険の評価

`phases/operation.md` の求めにより、デプロイの経路のセキュリティへの影響を記録する。この設計は、新しい IAM のロール、ネットワークのルール、暗号化の設定を作らない(それらは `infrastructure-specification.md` と `security-design.md` で決定済み)。

| 項目 | 影響と対応 | 残る危険 |
|---|---|---|
| WIF と Environment | `main` と本リポジトリだけが認証できる。Environment `production` は、シークレットを `deploy` ジョブだけに見せ、デプロイブランチを `main` に限る | Environment のデプロイブランチの制限の設定漏れ。手順書で設定を確認する |
| `workflow_dispatch` | 入力を 40 桁と `main` の履歴に限る。実行できるのは、リポジトリに書き込み権限のある人。WIF の許可条件は変わらない | 書き込み権限のある人が、`main` の過去のコミット(脆弱な版を含む)を選べる。単独開発のため受け入れる |
| `sudo` の範囲 | デプロイ用の OS Login ユーザーが `sudo` で実行できるのは `mobile-order-deploy` だけ。引数はリリース ID だけ(`infrastructure-specification.md`) | `deploy.sh` の入力検査の不備。`deploy.sh` の設計で、40 桁の検査、root 所有の作業ディレクトリでの照合、`tar` の一覧の検査を行う |
| 成果物の信頼 | 出どころの保証は、`main` の保護(PR と必須チェック)と WIF の許可条件。SHA-256 は転送の破損の検出用で、改ざんへの防御ではない | `main` に悪意のあるコードが入ると、そのままデプロイされる。単独開発で、PR の自己レビューに依存する |
| サードパーティのアクション | コミットの SHA で固定し、Dependabot で更新する(`ci-config.md`) | 更新の PR の見落とし |
| 課金 | デプロイは追加の課金を発生させない(VM は既存)。GitHub Actions のアーティファクトの保持は 7 日で、リポジトリの無料枠内を想定 | リポジトリが公開でない場合の Actions の無料枠。実施時に確認する |

## Assumptions & Open Questions

- `[assumption]` A1: 初回のデプロイは、`terraform apply` で VM を作り、起動スクリプトが完了してから行う。VM の準備ができていない間のデプロイは失敗するだけで、害はない。
- `[assumption]` A2: GitHub Actions の利用量(1 回あたり数分、1 か月に数回〜数十回)が、リポジトリの無料枠に収まる。実施時に確認する。
- 未確定: 本番の承認を PR のマージの時点で取る運用(自己レビュー)で足りるかは、運用の段階で見直す。
