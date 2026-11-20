## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-16T15:20:16Z
**Iteration:** 2
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/cicd-pipeline.md > ワークフロー 2 の手順 4(転送)と deploy.sh の入力の検査 | 手順 4 は成果物をデプロイ用ユーザーのホームの `incoming/` に置くとしているが、`incoming/` を作る箇所がどの文書にもない。OS Login のホーム `/home/sa_<unique_id>` は初回ログインで作られるだけで、その下の `incoming/` は存在しない。`gcloud compute scp ... :incoming/` は初回から失敗する。起動スクリプトは SA のユーザーのホームを事前に作る設計でもない。 | 手順 4 の前に `gcloud compute ssh -- mkdir -p incoming` を入れる(ホームは初回ログインで作られる)。または deploy.sh が使う受け渡し先を、起動スクリプトが作る固定のディレクトリにする(例: `/var/lib/mobile-order-incoming`、所有者 `sa_<unique_id>`、`0700`)。deploy.sh が `$SUDO_USER` のホームを `getent passwd` で引くことも書く。 | Resolved (reviewer) |
| R-02 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/cicd-pipeline.md > deploy.sh の入力の検査と展開 | root で動く deploy.sh が、`sudo` を許したユーザー自身が書き込める場所の tar を展開する。SHA-256 のファイルも同じ場所にあるため、検証は改ざんの防止にならない(検査後に差し替えられる、TOCTOU)。root の `tar` は既定で所有者と権限を復元するため、setuid や root 所有のファイルを含む tar で権限昇格できる。シンボリックリンクを使った任意の場所への書き込みも考えられる。「`sudo` は deploy.sh だけ」という IAM の表の前提が弱い。 | deploy.sh は、tar を root 所有の一時ディレクトリへコピーしてから検証と展開を行う。`tar --no-same-owner --no-same-permissions` を使う。展開後に所有者を `root:root`(Caddy が読める権限)に正規化し、シンボリックリンクと `..` を含むエントリを拒否する。SHA-256 の期待値は、ワークフローから ssh の引数で渡すか、検証の限界を設計に明記する。 | Resolved (reviewer) |
| R-03 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > Terraform のファイル構成と Infrastructure Services | 必要な API の有効化がどこにもない(`google_project_service` も、手順書の前提も)。`compute`、`iap`、`oslogin`、`iamcredentials`、`sts`、`cloudresourcemanager`、`serviceusage` が無効なプロジェクトでは、`terraform apply` と WIF の認証と IAP の接続が失敗する。2 回目の `plan` の差分 0 件(NFR4.2)にも関わる。 | `google_project_service` を `iam.tf` か `network.tf` に置く(`disable_on_destroy = false`)。または、手動で有効にする API の一覧と手順を、state バケット作成の手順書に並べると明記する。 | Resolved (reviewer) |
| R-04 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > VM 上の設定「データディスク」と Infrastructure Services「永続ディスク」 | 「`blkid` で確認し、ファイルシステムがないときだけ `mkfs.ext4`」だけでは、データのあるディスクを初期化しない保証にならない。`blkid` は、デバイスが未出現、読み取りの一時的な失敗、他の理由でも非 0 を返す。判定の条件(終了コードの種類)、デバイスの存在確認と待機、マウントが失敗したときに `mkfs` しないこと、`mkfs` の前にマウントポイントの確認、`chown` をマウント後に行うこと、が書かれていない。起動スクリプトは毎回の起動で走るため、誤判定は即データ消失になる。 | 手順を明記する。(1) `/dev/disk/by-id/google-mobile-order-data` が存在するまで一定時間待ち、無ければ失敗で終了する。(2) `blkid -o value -s TYPE` が空かつ終了コードが 2(署名なし)のときだけ `mkfs.ext4`。それ以外は `mkfs` しない。(3) `mount` に失敗したら `mkfs` せず失敗で終了する。(4) `chown` は `mountpoint -q` が成功した後にだけ行う。 | Resolved (reviewer) |
| R-05 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > IAM の付与と WIF の行 | WIF プロバイダの `attribute_mapping` が示されていない。`principalSet` の `attribute.repository/<owner/repo>` で絞る(「属性 `repository` で絞る」)には、`google.subject` と `attribute.repository` と、条件で使う `assertion.ref` の対応が必要。また、ロールの付与先が「プロジェクトまたは VM」のまま決まっておらず、`compute.projects.get` はプロジェクト単位の権限であるため、開発者が付与先を選べない。 | `attribute_mapping`(`google.subject=assertion.sub`、`attribute.repository=assertion.repository`、`attribute.ref=assertion.ref`)を書く。各ロールの付与先を 1 つに決める(例: `iap.tunnelResourceAccessor` と `compute.osLogin` は VM、カスタムロールはプロジェクト)。余裕があれば `repository_owner_id` も条件に加える。ウォーキングスケルトンで `roles/compute.osLogin` が `compute.instances.get` を既に含むかを確認し、カスタムロールが不要なら削る。 | Resolved (reviewer) |
| R-06 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > Caddyfile と caddy.service | (1) Debian の `caddy.service` の `ExecReload` は `caddy reload` を使うが、`admin off` ではそれが失敗する。起動スクリプトの再実行で Caddyfile が変わったときは `restart` が要る。(2) `header @shell Cache-Control "no-cache"` は `try_files` より先に評価されるため、`/kitchen` のようなパスで `index.html` に落ちた応答には `no-cache` が付かない。説明にある「ハッシュ付きアセットの長いキャッシュ」の設定も Caddyfile にない。(3) Caddy ユーザーが `current/web` を読める権限になることが、deploy.sh の展開で保証されていない。 | 手順書と起動スクリプトで Caddy の反映を `restart` と明記する。画面のフォールバックの `Cache-Control` は、matcher を「`/assets/*` 以外」に変えるか、削除する(アセットの長いキャッシュは `path /assets/*` で付ける)。展開後の権限を `0755` / `0644` に正規化する。 | Resolved (reviewer) |
| R-07 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/traceability.json > upstream_ids と coverage | `nfr-requirements` にある `NFR1.7`、`NFR2.10`、`NFR2.11`、`NFR3.7`、`NFR4.5`、`NFR5.9`、`NFR6.3`〜`NFR6.7`、`NFR7.3`、`NFR7.5` が一覧にない(本文では `NFR6.3`〜`6.7` と `NFR7.5` を引用している)。`NFR2.8` を N/A としているが、`X-Content-Type-Options` を付ける Caddyfile は、NFR2.8 を引用するセキュリティ設計の対応でもある。 | この段階の対象と考える ID を `upstream_ids` と `coverage` に追加する。対象外とするものは、理由つきで N/A にする。`NFR2.8` の N/A の理由に、リスクの記録は NFR 設計の文書にあることと、HTTP のみの構成をインフラが実装することを書く。 | Resolved (reviewer) |
| R-08 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > 月額の見積もり | 合計は外部 IPv4 の未確認の単価に依存し、「5 ドル以内」の余裕は約 1.35 ドルしかない。単価が変わると予算を超えうるが、超える場合の閾値(いくらから承認を取り直すか)が書かれていない。 | 「合計が 5 ドルを超える場合は `apply` の承認を取り直す」と閾値を明記し、再確認のチェックリストに IPv4 の単価、無料枠のリージョン条件(e2-micro、標準永続ディスク、GCS)を並べる。 | Resolved (reviewer) |
| R-09 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > VM 上の設定(起動スクリプトが冪等に配置する) | deploy.sh が使う `/var/lib/mobile-order/work` と `/opt/mobile-order/releases` を、起動スクリプトが作ると書いた行がない。ユーザーとデータディスクの行しかない。`/opt/mobile-order` と `current` の親ディレクトリを、caddy が読める権限(0755)で作ることも書かれていない。deploy.sh が root で `mkdir -p` すれば動くが、どちらが作るのかが曖昧である。 | VM 上の設定の表に、これらのディレクトリの作成と所有者と権限を 1 行で足す。または、deploy.sh が `mkdir -p` で作ると、cicd-pipeline.md に明記する。 | New |
| R-10 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/cicd-pipeline.md > `deploy.sh` の設計 > 入力の検査と展開 | SHA-256 の照合が、コピー前の元ファイルに対して書かれている。コピーしたあとの検査との間に、差し替えの余地がある。転送の破損の検出という目的だけなら、実害は小さい。 | 照合をコピー後の `work/` のコピーに対して行う、と順序を書き直す。 | New |
| R-11 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > API の有効化 | 新しいプロジェクトで、課金アカウントの紐付けが前提であることが、準備の手順に書かれていない。 | 準備の手順に、課金アカウントの紐付けの確認を 1 行足す。 | New |

> R-01 Reviewer note: 転送の手順 4 で、scp の前に `ssh mkdir -p incoming` を実行する。deploy.sh は `getent passwd "$SUDO_USER"` でホームを引き、`incoming/<ID>.tar.gz` に固定している。受け渡しの経路は、転送側と受け取り側で一致した。

> R-02 Reviewer note: root 所有の `/var/lib/mobile-order/work/<ID>/`(0700)へ `install -m 0600` でコピーし、コピーに対して検査と展開を行う。`tar -tvf` で種別、パス、最上位を検査し、`--no-same-owner` などで展開して、所有者と権限を正規化する。SHA-256 が改ざんへの防御ではないことも明記された。

> R-03 Reviewer note: 手動の `gcloud services enable`(serviceusage、cloudresourcemanager、iam)と、Terraform の `google_project_service`(compute、iap、oslogin、iamcredentials、sts)に分けた。`depends_on` と、apply 前の準備の順序も書かれている。

> R-04 Reviewer note: デバイスの出現待ち、blkid の終了コード 2 と `wipefs -n` が空と、パーティションなしの条件で `mkfs` する。mount の失敗では `mkfs` しない。`mountpoint -q` の成功後に chown する。起動のたびに走っても、データのあるディスクを初期化する経路はない。

> R-05 Reviewer note: `attribute_mapping` と、`principalSet` の付与先が具体化された。VM 単位の付与が書かれ、カスタムロールの要否は、ウォーキングスケルトンで確認して人間の承認を取ると明記された。

> R-06 Reviewer note: `admin off` のときは `systemctl restart caddy` を使う。`/assets/*` と、それ以外で `Cache-Control` を `handle` で分けた。`web/` の権限は deploy.sh で正規化する。

> R-07 Reviewer note: upstream_ids に NFR1.7、2.10、2.11、3.7、4.5、5.9、6.3〜6.7、7.3、7.5 が追加され、coverage の行も付いた。NFR2.8 の N/A も、要件の受け入れたリスクに基づく理由が書かれた。

> R-08 Reviewer note: 再承認のしきい値(約 0.00685 ドル / 時間 = 5 ドル ÷ 730 時間)が追加された。計算も正しい。

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 手動の相互参照の確認(traceability.json と NFR 要件) | PASS | R-07 で追加した ID は、NFR 要件の文書に存在する。 |
| 手動の整合の確認(work、incoming、tar の検査、mkfs の保護、API、Caddy の handle) | PASS(新しい Minor 3 件のみ) | 修正が作った矛盾は見つからなかった。 |

### Summary

前回の Major 4 件と Minor 4 件は、すべて修正された。修正が作った新しい矛盾は見つからず、残るのは Minor 3 件だけである。開発者は、アーキテクトに確認せずに実装できる。
