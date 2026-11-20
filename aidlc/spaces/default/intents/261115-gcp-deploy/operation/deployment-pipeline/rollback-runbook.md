# ロールバック手順書: mobile-order の Google Cloud デプロイ

## Sources

- `[Q4]` `workflow_dispatch` による手動の再デプロイ。`deployment-pipeline-questions.md` の人間の回答
- `[memory:M1]` `operation/deployment-pipeline/cd-config.md`、`operation/deployment-pipeline/deployment-strategy.md`
- `[memory:M2]` `construction/infrastructure-design/cicd-pipeline.md`(「ロールバックと手動の復旧」、`deploy.sh` の設計)、`construction/infrastructure-design/infrastructure-specification.md`(配置パス、起動スクリプトの反映、片付けと保護)、`construction/ci-pipeline/quality-gates.md`
- `[memory:M3]` `construction/nfr-design/reliability-design.md` の 2 節(未マウント)、3 節(デプロイとロールバック)、4 節(データの扱い)。`requirements.md` の FR2.5、FR5.4、FR6.5、FR7、NFR3.3、NFR3.4
- `[memory:M4]` `project.md` の ALWAYS / NEVER ルール、`phases/operation.md`(ロールバックの手順、連絡先と段階的な連絡)
- `[scope]` Workflow-selected scope: infra

## 使い方

この手順書は、デプロイが失敗したとき、またはデプロイした版に問題が見つかったときに、所有者が使う。単独開発のため、連絡先と最終判断は所有者本人である。

| 状況 | 最初に見る節 |
|---|---|
| デプロイのジョブが失敗した(自動ロールバックが動いた、または動かなかった) | 1 |
| デプロイは成功したが、あとで問題が見つかった | 2 |
| 自動ロールバックも失敗した、または GitHub Actions が使えない | 3 |
| スモークテストが不合格で、原因がデータディスクの未マウントだった | 4 |
| データを失った、または DB を作り直したい | 5 |
| インフラ(Terraform)の変更を戻したい | 6 |
| IAP でも入れない | 7 |

## 前提

- 配置: リリースは `/opt/mobile-order/releases/<ID>/`、現在の版は `/opt/mobile-order/current`(シンボリックリンク)。VM には現在の版と直前の 1 世代だけが残る。データベースは `/mnt/data/app.db` で、リリースには入らず、ロールバックの対象外(FR2.5)。
- 接続: SSH は IAP 経由だけ。所有者は自分の Google アカウント(`roles/compute.osAdminLogin` と `roles/iap.tunnelResourceAccessor`)で入る。
- 値: `<プロジェクト ID>`、`<ゾーン>`(`us-central1-a`)、`<VM 名>`(`mobile-order-vm`)は、`terraform output` または GitHub Environment `production` のシークレットと同じ値を使う。値は Git に入れない。

```bash
gcloud compute ssh mobile-order-vm --zone us-central1-a --project <プロジェクト ID> --tunnel-through-iap
```

## 1. デプロイのジョブが失敗したとき

1. GitHub Actions の `deploy` の実行を開く。ジョブの要約(`[Q5]`)で、リリース ID、スモークテストの出力、自動ロールバックの有無と結果、`free -m` の判定を確認する。
2. 要約に「ロールバックして、スモークテストに合格」とあれば、前の版で動いている。失敗した版の `server.mjs` の SHA-256 と出力を原因調査に使い、修正の PR を出す。何もしなくてよい。
3. 要約に「ロールバックも失敗」とあれば、3 節へ進む。
4. 要約に「初回デプロイ」または「同じ ID の再デプロイ」とあれば、戻す先がないため自動ロールバックは行われていない。VM に入り、2 節の手順 3 以降でアプリの状態を確認する。
5. 要約に「データディスクが未マウント」とあれば、4 節へ進む。

## 2. 問題のある版を戻す(デプロイは成功したが、あとで問題が見つかった)

方法 A(推奨。VM に入らない): 過去の良い版を再デプロイする。

1. 戻したい版のコミットの SHA(40 桁)を、`git log` か GitHub の履歴で調べる。`main` に含まれるコミットだけが使える。
2. GitHub Actions の `deploy` を、`workflow_dispatch` で `main` から実行し、入力 `release_id` にその SHA を入れる(`[Q4]`)。
3. ジョブが成功し、要約のスモークテストが合格していることを確認する。この方法は、その版をビルドし直して通常のデプロイと同じ手順(スモークテストと自動ロールバックを含む)で入れ替える。

方法 B(VM に入る): 直前の 1 世代へ、リンクを戻す。

1. IAP 経由で VM に入る(上の `gcloud compute ssh`)。
2. 版を確認する。
   ```bash
   readlink /opt/mobile-order/current
   ls -1 /opt/mobile-order/releases
   ```
3. 直前の版が `releases/` にあることを確認し、リンクを張り替えて再起動する。
   ```bash
   sudo ln -sfn /opt/mobile-order/releases/<直前の版の ID> /opt/mobile-order/current
   sudo systemctl restart mobile-order
   ```
4. スモークテストを実行する(下の「スモークテストの確認」)。
5. 戻したあとに、GitHub 上の `main` が問題のある版のままであることに注意する。次の `main` へのマージで、再び問題のある版が入る。原因の修正の PR か、問題のあるコミットの revert の PR を出す。

## 3. 自動ロールバックも失敗したとき(手動の復旧。NFR3.4)

GitHub Actions を使わずに、所有者が IAP 経由で入って戻す。

1. IAP 経由で VM に入る。
2. サービスの状態とログを確認する。
   ```bash
   systemctl is-failed mobile-order
   sudo journalctl -u mobile-order -n 100 --no-pager
   sudo journalctl -u caddy -n 50 --no-pager
   mountpoint -q /mnt/data && echo mounted || echo NOT-MOUNTED
   ```
3. `NOT-MOUNTED` なら、4 節へ進む。
4. マウントされているなら、2 節の方法 B の手順 2 から 4 で、直前の版へリンクを戻して再起動し、スモークテストを実行する。
5. `releases/` に戻せる版がない(初回デプロイの失敗など)場合は、`current` を向ける版がない。原因をジョブのログと `journalctl` で調べ、修正した版を、2 節の方法 A で再デプロイする。

## 4. データディスクが未マウントのとき(NFR3.3 の意図的な例外)

`current` を戻しても直らないため、自動ロールバックは行われない。

1. VM に入り、状態を確認する。
   ```bash
   mountpoint /mnt/data
   ls -l /dev/disk/by-id/ | grep mobile-order-data
   sudo journalctl -b -p warning --no-pager | grep -i -E "mnt/data|mobile-order-data"
   grep mnt/data /etc/fstab
   ```
2. ディスクが VM に付いていて、デバイスが見えるのにマウントされていない場合は、`sudo mount /mnt/data`(`/etc/fstab` に `nofail` 付きで書いてある)を試す。成功したら `sudo systemctl restart mobile-order` を実行し、スモークテストを実行する。
3. デバイスが見えない場合は、データディスクが VM から外れている。`gcloud compute instances describe mobile-order-vm --zone us-central1-a` の `disks` を確認し、Terraform の構成(`compute.tf`)と差があれば、6 節の手順で人間が `plan` を確認して、承認のうえ `apply` する。
4. **データがあるディスクを、決して `mkfs` しない**。起動スクリプトも、`blkid` で `ext4` を確認できないとき以外は `mkfs` しない(`infrastructure-specification.md`)。手動でも、`mkfs` は実行しない。
5. 起動スクリプトの再実行が必要な場合は、次のとおり(再起動なし、冪等)。
   ```bash
   sudo google_metadata_script_runner startup
   ```
   VM の再起動(`gcloud compute instances reset mobile-order-vm --zone us-central1-a`)は、数十秒のダウンタイムがある。

## 5. データの扱い(NFR3.5、NFR3.6)

- バックアップは取っていない。ディスクの障害でデータは失われる(受け入れたリスク)。
- 再デプロイでも VM の作り直しでも、データディスクは上書きしない。
- データを失った、または初期のメニューに戻したい場合: **これは注文データを消す操作であり、実行前に所有者が内容を確認する**。アプリを止め、DB ファイルを消して起動し直すと、シードで初期のメニューが入る(`DB_PATH` のファイルが空のときだけシードされる既存の動作)。
  ```bash
  sudo systemctl stop mobile-order
  sudo mv /mnt/data/app.db /mnt/data/app.db.removed-$(date +%Y%m%d%H%M%S)
  sudo systemctl start mobile-order
  ```
  `mv` で退避するため、元のファイルは残る(容量を確認して、不要になったら手動で消す)。

## 6. インフラ(Terraform)の変更を戻すとき

- Terraform の変更は、Git の履歴を戻す PR(revert)で戻し、`terraform plan` の結果と月額の見積もりを所有者が確認して承認したうえで、`terraform apply` を**手動で**実行する。`terraform apply` は毎回承認が必要で、ワークフローからは実行しない(ALWAYS ルール)。承認なしに課金の発生する操作は実行しない(NEVER ルール)。
- `plan` の差分に、IAM のロール、ネットワークのルール、暗号化の設定の変更が含まれる場合は、その危険を `plan` と一緒に所有者に示して、承認を取る(`phases/operation.md`)。
- データディスクは `prevent_destroy` で保護されている。保護の解除と完全な削除は、別の手順書(FR2.4a)で、人間の承認を必須とする。
- 起動スクリプトを変えた場合は、`apply` のあとに、4 節の手順 5(`google_metadata_script_runner startup`)か VM の再起動で反映する。

## 7. IAP でも入れないとき(FR6.5)

1. 自分のアクセス元の IP が変わった場合、アプリには届かないが、SSH は IAP 経由なので VM には入れる。許可 IP の更新は、FR3.3 の手順(`allowed_ip_cidr` の変更。`terraform plan` の確認と承認を経た手動の `apply`)で行う。
2. IAP でも入れない場合の最後の手段は、シリアルコンソールの有効化である。これはセキュリティ設定の変更のため、所有者が内容を確認して承認してから実施する(`phases/operation.md`)。

## スモークテストの確認

VM 上で、次の 2 つがどちらも成功することを確認する(FR5.3)。`jq` は起動スクリプトで入っている。

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost/
curl -fsS http://localhost/api/menu | jq -e '.items | length'
```

1 つ目は `200`、2 つ目は `items` の件数を表示して終了コード 0 になる。失敗したら、`sudo journalctl -u mobile-order -p err --since "24 hours ago" --no-pager` と `sudo journalctl -u caddy -n 50 --no-pager` で原因を調べる(NFR6)。

## 連絡先と段階的な連絡

| 段階 | 誰が | 内容 |
|---|---|---|
| 1 | 所有者(単独開発の担当者) | GitHub の既定のメール通知で、デプロイの失敗を知る。1 節から 4 節の手順で戻す |
| 2 | 所有者 | 手順書で戻せない場合は、7 節のシリアルコンソール(承認のうえ)や、Terraform の変更(6 節。承認のうえ)で復旧する |
| 3 | 所有者 | 復旧できない場合は、VM を作り直す(データディスクを付け直す。データディスクの扱いは 5 節と FR2.4a) |

連絡先は所有者本人であり、所有者のメールアドレスは変数 `owner_email`(`*.tfvars`。Git に入れない)で管理する。この文書には書かない。外部への連絡の経路(オンコール、チャット)は、この規模では設けない。

## 事後の確認

デプロイの失敗または手動のロールバックを行ったら、次を記録する(単独開発では、PR の説明か `aidlc/` のメモでよい)。重大な障害(アプリが長時間使えなかった、データを失った)があった場合は、時系列、原因、再発の防止策を残す(`phases/operation.md`)。

- 失敗した版のリリース ID(SHA)と、ジョブのログの場所
- 原因(スモークテストの不合格、`deploy.sh` の入力検査、メモリ、マウント など)
- 戻した方法(自動ロールバック、`workflow_dispatch`、手動のリンクの切り替え)と、所要時間
- 再発を防ぐ変更(修正の PR、手順書の更新)

## Assumptions & Open Questions

- `[assumption]` A1: 2 節の方法 B は、`/opt/mobile-order/releases/` に直前の 1 世代が残っている場合に使える(`deploy.sh` は、成功後に現在の版と直前の版以外を削除する)。
- `[assumption]` A2: 所有者の Google アカウントが `roles/compute.osAdminLogin` を持つため、`sudo` を実行できる(`infrastructure-specification.md` の IAM の表)。ウォーキングスケルトンで確認する。
- 未確定: 3 節と 4 節のコマンドは、ウォーキングスケルトンで実際の VM に対して試し、必要なら直す。デプロイ用のユーザー名(`sa_<unique_id>`)など、実際の値が確認できたら更新する。
- 未確定: 5 節の DB の作り直しで、アプリのシードが期待どおりに動くことは、ウォーキングスケルトンで確認する。
