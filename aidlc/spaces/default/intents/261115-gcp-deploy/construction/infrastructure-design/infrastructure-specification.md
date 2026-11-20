# インフラ仕様: mobile-order の Google Cloud デプロイ

## Sources

- `[Q1]` ディスク 10 GB + 10 GB、`[Q2]` scp と ssh を IAP 経由、`[Q3]` カスタムロール、`[Q4]` osLogin と sudoers(`deploy.sh` は起動スクリプトで配置)、`[Q5]` 単一ルートの Terraform と手動の state バケット。`infrastructure-design-questions.md` の人間の回答
- `[memory:M1]` NFR 設計 6 文書(`performance-design.md`、`security-design.md`、`scalability-design.md`、`reliability-design.md`、`observability-design.md`、`logical-components.md`。LC1〜LC12 を具体化する)、NFR 要件 6 文書
- `[memory:M2]` `requirements.md` の FR1〜FR7、Constraints
- `project.md` の ALWAYS / NEVER ルール(キーなし、WIF、state は GCS、自分の IP のみ、課金の承認)

## Deployment

| Facet | Choice | Rationale |
|---|---|---|
| 計算モデル | Compute Engine の VM 1 台(`mobile-order-vm`)。Debian 12、e2-micro、us-central1-a | 無料枠の対象(NFR1.2)。コンテナは範囲外 |
| ネットワーク | 専用の VPC `mobile-order-vpc`(自動サブネットなし)とサブネット 1 つ(`10.10.0.0/24`、us-central1)。外部 IPv4 はエフェメラル、IPv6 なし | default ネットワークの許可ルールを持ち込まない(NFR2.3)。静的 IP は作らない(NFR1.4) |
| 入口 | ファイアウォール `mobile-order-allow-http`(tcp:80、送信元は変数 `allowed_ip_cidr` のみ)と `mobile-order-allow-ssh-iap`(tcp:22、送信元は `35.235.240.0/20` のみ)。対象はネットワークタグ `mobile-order` | NFR2.1〜2.3 |
| ストレージ | ブートディスク 10 GB(標準永続ディスク)と、データディスク `mobile-order-data` 10 GB(標準永続ディスク、別リソース、`prevent_destroy`)。合計 20 GB | `[Q1]`、NFR1.2、NFR4.4 |
| 環境 | 本番相当の 1 つのみ | `team.md`(Q7) |
| IaC | Terraform。`infra/terraform/` の単一ルート(モジュール分割なし)。バックエンドは GCS | `[Q5]`、ALWAYS ルール |
| サイズ | メモリ 1 GB、vCPU 共有 2。スワップ 1 GB | NFR5.1、NFR5.2 |
| 配置パス | リリース `/opt/mobile-order/releases/<id>/`、`current` のリンク、データ `/mnt/data/app.db`、デプロイスクリプト `/usr/local/sbin/mobile-order-deploy` | `reliability-design.md` |
| 変数 | `project_id`、`allowed_ip_cidr`、`github_repository`(`owner/repo`)、`owner_email`、`node_version`、`node_sha256`。`*.tfvars` は Git に入れない(`terraform.tfvars.example` だけをコミットする) | NFR2.7 |

### Terraform のファイル構成

| ファイル | 内容 |
|---|---|
| `versions.tf`、`backend.tf` | provider の固定、`backend "gcs" {}`(バケット名は `-backend-config` で渡す。値はコミットしない) |
| `network.tf` | VPC、サブネット、ファイアウォール 2 つ |
| `compute.tf` | データディスク、VM、`metadata_startup_script`(`templatefile`)、VM 用サービスアカウント |
| `iam.tf` | デプロイ用サービスアカウント、カスタムロール、所有者の IAP と OS Login の権限、WIF のプールとプロバイダ |
| `startup.sh.tpl` | 起動スクリプト(冪等)。`files/` の内容を埋め込んで配置する |
| `files/` | `Caddyfile`、`mobile-order.service`、`caddy-order.conf`、`mobile-order-deploy.sh`、`journald-mobile-order.conf`、`sysctl-mobile-order.conf` |
| `outputs.tf` | VM 名、ゾーン、WIF プロバイダの名前、デプロイ用サービスアカウントのメール(GitHub のシークレットに入れる値) |

## Infrastructure Services

| Service | Role | Configuration | Notes |
|---|---|---|---|
| Compute Engine `mobile-order-vm` | コンピュート | e2-micro、Debian 12、us-central1-a、`metadata`: `enable-oslogin=TRUE`、`block-project-ssh-keys=TRUE`、タグ `mobile-order`、サービスアカウントは `mobile-order-vm`(ロールなし) | 外部 IPv4 はエフェメラル。IPv6 なし(NFR2.3) |
| 永続ディスク `mobile-order-data` | データベースの保存先 | 10 GB、`pd-standard`、`device_name = "mobile-order-data"`。VM から別の `google_compute_disk` として接続。`lifecycle { prevent_destroy = true }` | VM の作り直しでは付け直すだけ(NFR4.4)。初回だけ `ext4` を作る(起動スクリプトが、ファイルシステムがないときだけ `mkfs`。既にあれば触らない) |
| VPC とファイアウォール | ネットワーク | 上の表のとおり | 3000 番は開けない(NFR2.3)。Fastify は `127.0.0.1` で待ち受ける(NFR2.12) |
| Caddy | リバースプロキシ(LC2) | Debian のパッケージ。`/etc/caddy/Caddyfile`(下) | `caddy.service` の drop-in で `After=mobile-order.service`、`Wants=mobile-order.service` |
| Fastify(Node.js 24) | アプリ(LC3) | `mobile-order.service`(`reliability-design.md` 1 節の定義が唯一の正) | 配布物は `server.mjs` 1 つ |
| Cloud Storage(state) | Terraform の state | 手順書の `gcloud` で作る。バージョニング、公開アクセス防止(`--public-access-prevention`)、均一なバケットレベルのアクセス(`--uniform-bucket-level-access`)を有効にする。リージョン us-central1、Standard | Terraform のリソースにしない(`[Q5]`)。無料枠の対象かは実施時に再確認(A5) |
| IAP | SSH と scp の入口 | `gcloud compute ssh/scp --tunnel-through-iap` | 追加料金なしを実施時に再確認(A5) |
| IAM(デプロイ用) | 認証と認可 | サービスアカウント `mobile-order-deployer`。ロールは下の表 | キーなし(NFR2.4) |
| Workload Identity Federation | GitHub Actions の認証 | プール `github`、プロバイダ `github-actions`(OIDC、`https://token.actions.githubusercontent.com`)。`attribute_condition` は `assertion.repository == "<github_repository>" && assertion.ref == "refs/heads/main"` | `main` と本リポジトリだけ(NFR2.5) |

### 準備の手順(最初の `terraform apply` の前。手順書の最初に置く)

| 順 | 方法 | 内容 |
|---|---|---|
| 0 | 課金アカウントの紐付け(人間が手動で実行。課金に関わるため) | プロジェクトに課金アカウントを紐付ける(新しいプロジェクトでは、紐付けるまで Compute Engine などが使えない)。`gcloud billing projects link <プロジェクト ID> --billing-account=<課金アカウント ID>`。確認: `gcloud billing projects describe <プロジェクト ID> --format="value(billingEnabled)"` が `True` を返す |
| 1 | API の有効化(下の表) | 紐付けの確認の後に行う |
| 2 | state バケットの作成 | 手順書の `gcloud`(バージョニング、公開アクセス防止、均一なバケットレベルのアクセス) |

### API の有効化(新しいプロジェクトで最初に必要)

| 方法 | 内容 |
|---|---|
| 手順書(`terraform apply` の前に、人間が手動で実行) | `gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com`。Terraform が他の API を有効にするための前提 |
| Terraform(`google_project_service`、`disable_on_destroy = false`) | `compute.googleapis.com`、`iap.googleapis.com`、`oslogin.googleapis.com`、`iamcredentials.googleapis.com`、`sts.googleapis.com` |

State バケットの作成(手順書の `gcloud`)と、上の API の有効化は、最初の `terraform apply` の前の準備で、どちらも手順書の最初に置く。`google_project_service` に依存して、VM とネットワークと IAM を作る(`depends_on`)。

### IAM の付与(NFR2.6)

| 主体 | ロール / 権限 | 対象 | 理由 |
|---|---|---|---|
| `mobile-order-deployer`(SA) | `roles/iap.tunnelResourceAccessor` | プロジェクトまたは VM | IAP 経由の接続 |
| 〃 | `roles/compute.osLogin`(管理者権限なし) | プロジェクトまたは VM | OS Login でのログイン。`sudo` は `deploy.sh` だけ(下) |
| 〃 | `roles/iam.serviceAccountUser` | `mobile-order-vm` の SA | VM のサービスアカウントとしての利用 |
| 〃 | カスタムロール `mobileOrderDeployerInstanceGet`(`compute.instances.get`、`compute.projects.get` のみ) | プロジェクト | `gcloud compute ssh/scp` が VM の情報を引くため。`roles/compute.viewer` は使わない |
| WIF のプリンシパル | `roles/iam.workloadIdentityUser`(属性 `repository` で絞る) | `mobile-order-deployer` | GitHub Actions がこの SA になる |
| 所有者(`owner_email`) | `roles/iap.tunnelResourceAccessor`、`roles/compute.osAdminLogin`、`roles/iam.serviceAccountUser`(VM の SA) | プロジェクトまたは VM | 手動の復旧と、起動スクリプトの再実行(FR3.7) |

付与の範囲は、可能なものは VM 単位にする: `roles/iap.tunnelResourceAccessor` は `google_iap_tunnel_instance_iam_member`(VM)、`roles/compute.osLogin` は `google_compute_instance_iam_member`(VM)、`roles/iam.serviceAccountUser` は VM の SA に対して。カスタムロールの `compute.projects.get` はプロジェクト単位でしか付けられないため、カスタムロールはプロジェクトに付ける。`roles/compute.osLogin` が `compute.instances.get` と `compute.projects.get` を既に含むかは、ウォーキングスケルトンで実際の権限を確認し、含むならカスタムロールを外す(最小権限。この変更は人間に知らせて承認を取る)。

WIF のプロバイダの `attribute_mapping` は `google.subject = assertion.sub`、`attribute.repository = assertion.repository`、`attribute.ref = assertion.ref`。`mobile-order-deployer` への `roles/iam.workloadIdentityUser` は、`principalSet://iam.googleapis.com/projects/<番号>/locations/global/workloadIdentityPools/github/attribute.repository/<github_repository>` に付ける。`ref` の制限は `attribute_condition` で行う。

`roles/editor`、`roles/owner`、`google_service_account_key` は Terraform に置かない。

### VM 上の設定(起動スクリプトが冪等に配置する)

| 項目 | 内容 |
|---|---|
| Node.js | `node_version` の公式の配布物を取得し、`node_sha256` で検証。一致しなければ失敗。`/opt/node-v<版>/` に展開し `/usr/local/bin/node` をリンク |
| パッケージ | `caddy`、`jq`(`apt-get install`。再実行しても壊れない) |
| データディスク | 次の手順で、**データがあるディスクを決して初期化しない**。(1) `/dev/disk/by-id/google-mobile-order-data` が現れるまで最大 60 秒待つ。現れなければ、`mkfs` もマウントもせず、失敗を記録して先へ進む。ディスクのどの失敗でも、ユニット、Caddy、`deploy.sh`、sudoers など、ディスクに依存しない設定は続けて配置し、最後に失敗(終了コード 1)で終わる。アプリは起動しない(マウントされず、`AssertPathIsMountPoint=` でも起動に失敗する)。失敗の後は、手順書の再実行で足りる状態になる(コード生成での確定。当初の設計は「何もせずに終了」で、後続の設定が配置されないまま残る点を改めた)。(2) `blkid -o value -s TYPE <デバイス>` の終了コードで分岐する。`TYPE=ext4` が返れば、そのままマウントに進む。終了コードが **2**(読み取りに成功し、ファイルシステムも署名もない)で、かつ `wipefs -n` の出力が空で、パーティションもないときだけ、`mkfs.ext4 -L mobile-order-data` を実行する。それ以外(`ext4` 以外の型、終了コード 2 以外の失敗、署名あり)は、`mkfs` せずにエラーを記録して終了する。(3) `/etc/fstab` に `nofail` 付きで `/mnt/data` を書く。(4) `mount` が失敗したら `mkfs` はせず、終了する。(5) `mountpoint -q /mnt/data` が成功してから、所有者を `mobile-order` にする。起動のたびに走るため、(1)〜(5) のどの失敗でも `mkfs` へ進まない |
| スワップ | `/swapfile` 1 GB。fstab で永続化。`/etc/sysctl.d/99-mobile-order.conf` に `vm.swappiness=10` |
| ユーザー | `mobile-order`(ログインなし、システムユーザー) |
| ディレクトリ | 起動スクリプトが、`root:root` 所有で作成する(`mkdir -p` と `chown root:root`): `/opt/mobile-order`(`0755`)、`/opt/mobile-order/releases`(`0755`)、`/var/lib/mobile-order`(`0755`)、`/var/lib/mobile-order/work`(`0700`)。`caddy` と `mobile-order` ユーザーが `current/web` と `server.mjs` を読めるよう、親のパスを `0755` にそろえる。`deploy.sh` は、これらを作らず、無ければ失敗する(作成の責任は起動スクリプトにある) |
| ユニット | `/etc/systemd/system/mobile-order.service`(`reliability-design.md` 1 節)と、`caddy.service.d/order.conf` |
| journald | `/etc/systemd/journald.conf.d/mobile-order.conf`: `Storage=persistent`、`MaxRetentionSec=7day`、`SystemMaxUse=200M` |
| 受け取り用のディレクトリ | デプロイ用ユーザー(`getent passwd sa_<unique_id>` で引く)のホーム(`/home/sa_*`)を `root:root`・`0755` にし、`incoming/` を、そのユーザーの所有・`0700` で作る。ホームがリンクなら失敗。解決できない、または失敗したときは、他の設定を続けて最後に失敗で終わる(`deploy.sh` もホームの所有者を確認して失敗するため、安全側) |
| デプロイスクリプト | `/usr/local/sbin/mobile-order-deploy`(`root:root`、`0755`、CI からは送らない。起動スクリプトが配置する)。中身は `cicd-pipeline.md` |
| sudoers | `/etc/sudoers.d/mobile-order-deploy`(`root:root`、`0440`): `sa_<unique_id> ALL=(root) NOPASSWD: /usr/local/sbin/mobile-order-deploy`。コマンドはフルパス。`<unique_id>` は Terraform の `google_service_account.deployer.unique_id` から作る。書いたあと `visudo -c` で検査し、失敗なら削除して起動スクリプトを失敗にする |

起動スクリプトの変更は、`terraform apply`(毎回、人間の承認)のあと、実行中の VM には自動では反映されない(起動スクリプトは起動時にしか走らない)。反映の手順は 2 つで、どちらも手順書に書く:
1. 起動スクリプトの再実行(推奨。再起動なし): 所有者が IAP 経由で入り、`sudo google_metadata_script_runner startup` を実行する。スクリプトは冪等なので、そのまま再実行できる。
2. VM の再起動: `gcloud compute instances reset`。ダウンタイムが数十秒ある。

### Caddyfile(R-05 への対応。ウォーキングスケルトンで確認する)

```caddyfile
{
	admin off
	auto_https off
}
http://:80 {
	header X-Content-Type-Options nosniff
	encode gzip
	handle_path /api/* {
		reverse_proxy 127.0.0.1:3000
	}
	handle /assets/* {
		root * /opt/mobile-order/current/web
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}
	handle {
		root * /opt/mobile-order/current/web
		header Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}
```

- `/api` を外して `127.0.0.1:3000` に転送する(`localhost` ではなく `127.0.0.1`。NFR5.8)。
- 画面は 3 つの画面をパスで切り替えるため、見つからないパスは `index.html` に落とす。ハッシュ付きのアセットは長いキャッシュ、`index.html` は `no-cache`。
- `/assets/*`(Vite のハッシュ付きのファイル)は長いキャッシュ、それ以外(`index.html` と、見つからないパスの `index.html` への落とし先を含む)は `no-cache`。`no-cache` を `try_files` の後でも効くように、パスのマッチャーではなく `handle` のブロックで分けている。
- `admin off` のため、`caddy.service` の `reload`(管理 API を使う)は失敗する。起動スクリプトは設定を変えたとき `systemctl restart caddy` を使う(`reload` を使わない)。`web/` の所有者と権限は `deploy.sh` が `root:root`、`0755` と `0644` にそろえ、`caddy` ユーザーが読める。
- `current` のシンボリックリンクがリクエストごとに解決され、切り替え後に Caddy を再起動しなくても新しい版が出ることを、ウォーキングスケルトンで確認する(`reliability-design.md` A1)。
- Debian 12 の `caddy` パッケージのバージョンで、上の記法(`handle_path`、`try_files`、`@` のマッチャー)が動くことも、同じく確認する。

## 月額の見積もり(NFR1.1)

`scalability-design.md` のコストの統制(構成の固定、エフェメラル IP、承認のたびの見積もりの更新)に従う。スケールアウトとオートスケールは設計しない。

| 項目 | 見積もり | 状態 |
|---|---|---|
| e2-micro 1 台(us-central1) | 0 ドル(無料枠) | 実施時に再確認 |
| 標準永続ディスク 20 GB | 0 ドル(無料枠 30 GB 以内) | 実施時に再確認 |
| 外部 IPv4(エフェメラル) | 約 3.65 ドル(約 0.005 ドル / 時間 × 730 時間) | **未確認の数値**。`apply` の承認の前に公式の料金ページで再確認する(NFR1.3) |
| Cloud Storage(state) | 0 ドル(Standard の無料枠。リージョンの対象は未確認) | 実施時に再確認(A5) |
| 外向き通信 | 0 ドル(1 GB / 月以内) | 月次で確認 |
| 合計 | 約 3.65 ドル(5 ドル以内。余裕は約 1.35 ドル) | 確認できない場合は、更新して承認を取り直す |

再承認のしきい値: 外部 IPv4 の単価が、月額の合計を 5 ドルに収める上限(約 0.00685 ドル / 時間 = 5 ドル ÷ 730 時間)を超える場合、または他の項目が無料枠から外れる場合は、`apply` の前に、見積もりを更新して人間の承認を取り直す。

## 片付けと保護

- 通常の再構築では、データディスクは消えない(`prevent_destroy`、`terraform destroy` でも保護)。VM、外部 IP、ブートディスクの削除手順と、データディスクを残すかどうかの選択(人間の承認つき)は、手順書に書く(NFR1.6)。
- 完全削除(保護の解除、削除、確認)は別の手順書とし、実行には人間の承認を必須とする(FR2.4a)。

## Assumptions & Open Questions

- `[assumption]` A1: Debian 12 の標準リポジトリの `caddy` と `jq` を使える。バージョンの確認はウォーキングスケルトンで行う。
- `[assumption]` A2: OS Login の SA 用ユーザー名は `sa_<unique_id>` の形になる。ウォーキングスケルトンで、実際のユーザー名を確認する(`id` コマンド)。形が違えば sudoers の規則を直す。
- 未確定: 外部 IPv4 の料金(約 0.005 ドル / 時間)、IAP と state バケットの無料枠の扱いは、`apply` の承認の前に公式情報で再確認する(要件定義の A5)。
- 未確定: 予算アラート(Cloud Billing の予算)は、要件の範囲外として本設計には含めない。
