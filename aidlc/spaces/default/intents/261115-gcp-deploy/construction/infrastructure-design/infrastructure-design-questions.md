# Infrastructure Design: 質問

NFR 設計で「インフラ設計で決める」とした点だけを聞きます。Caddyfile の例と、ESM バンドルの確認方法(スケルトンで確認)は、質問なしで成果物に入れます。

## Q1. [プラットフォーム] ディスクの大きさ(NFR1.2: ブートとデータの合計 30 GB 以内)

- A. ブート 10 GB、データ 10 GB(合計 20 GB。推奨。余裕を残しつつ、スワップ 1 GB と 2 世代のリリースが収まる)
- B. ブート 20 GB、データ 10 GB(合計 30 GB。無料枠の上限いっぱい)
- X. Other (please specify)

[Answer]: A

## Q2. [プラットフォーム] 成果物を VM に渡す方法

- A. `gcloud compute scp --tunnel-through-iap` で `/tmp` に置き、`gcloud compute ssh --tunnel-through-iap` で `deploy.sh` を実行する(推奨。手順が単純で、失敗の切り分けがしやすい)
- B. `tar` を標準入力に流して ssh の 1 回で展開と実行をする(接続は 1 回だが、中断時の扱いが難しい)
- X. Other (please specify)

[Answer]: A(scp と ssh のどちらも IAP 経由 `--tunnel-through-iap` で行う)

## Q3. [DevSecOps] デプロイ用サービスアカウントの権限(NFR2.6)

`gcloud compute ssh` は VM の情報を引くための権限が要ります。

- A. `roles/iap.tunnelResourceAccessor`、`roles/compute.osLogin`、VM のサービスアカウントへの `roles/iam.serviceAccountUser`、それに `compute.instances.get` と `compute.projects.get` だけを持つカスタムロール(推奨。最小限)
- B. 上記のうち、カスタムロールの代わりに `roles/compute.viewer` を使う(設定は短いが、Compute の読み取り権限が広い)
- X. Other (please specify)

[Answer]: A

## Q4. [DevSecOps] `deploy.sh` に与える root 権限(NFR2.6)

`deploy.sh` は `systemctl restart` とリンクの切り替えに root が要ります。

- A. `roles/compute.osLogin`(管理者権限なし)にして、起動スクリプトが `/etc/sudoers.d/` に「デプロイ用サービスアカウントの OS Login ユーザーは `deploy.sh` だけを `sudo` で実行できる」規則を置く(推奨。最小権限。ユーザー名は Terraform の `unique_id` から作る)
- B. `roles/compute.osAdminLogin` を付けて、VM 上の `sudo` を自由に使えるようにする(設定は簡単だが、デプロイ用の資格情報が VM の全権になる)
- X. Other (please specify)

[Answer]: A(ただし `deploy.sh` は CI から送らず、VM の起動スクリプトで root 所有・書き込み不可で配置する。sudoers の規則はフルパスで指定する。CI から VM に送るのはアプリの成果物だけ)

## Q5. [プラットフォーム] Terraform の構成と state バケットの作り方

- A. `infra/terraform/` に 1 つのルートモジュール(モジュール分割なし)。state 用の GCS バケットは、手順書の `gcloud` コマンドで先に作り、バージョニングを有効にする(推奨。学習用に単純。FR1.2 の「手動またはブートストラップ」のうち手動)
- B. state バケットを別の小さな Terraform ルート(ローカル state)で作る(バケット自身の管理が増える)
- X. Other (please specify)

[Answer]: A(`deploy.sh` の変更に `terraform apply` が必要なことは承知。apply 後に実行中の VM へ反映する手順(再起動か起動スクリプトの再実行)を手順書に明記する。state バケットは、バージョニングに加えて、公開アクセス防止と均一なバケットレベルのアクセスも有効にする)

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
