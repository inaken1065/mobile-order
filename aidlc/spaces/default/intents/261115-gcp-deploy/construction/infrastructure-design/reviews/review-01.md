## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-16T15:17:13Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/cicd-pipeline.md > ワークフロー 2 の手順 4(転送)と deploy.sh の入力の検査 | 手順 4 は成果物をデプロイ用ユーザーのホームの `incoming/` に置くとしているが、`incoming/` を作る箇所がどの文書にもない。OS Login のホーム `/home/sa_<unique_id>` は初回ログインで作られるだけで、その下の `incoming/` は存在しない。`gcloud compute scp ... :incoming/` は初回から失敗する。起動スクリプトは SA のユーザーのホームを事前に作る設計でもない。 | 手順 4 の前に `gcloud compute ssh -- mkdir -p incoming` を入れる(ホームは初回ログインで作られる)。または deploy.sh が使う受け渡し先を、起動スクリプトが作る固定のディレクトリにする(例: `/var/lib/mobile-order-incoming`、所有者 `sa_<unique_id>`、`0700`)。deploy.sh が `$SUDO_USER` のホームを `getent passwd` で引くことも書く。 | New |
| R-02 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/cicd-pipeline.md > deploy.sh の入力の検査と展開 | root で動く deploy.sh が、`sudo` を許したユーザー自身が書き込める場所の tar を展開する。SHA-256 のファイルも同じ場所にあるため、検証は改ざんの防止にならない(検査後に差し替えられる、TOCTOU)。root の `tar` は既定で所有者と権限を復元するため、setuid や root 所有のファイルを含む tar で権限昇格できる。シンボリックリンクを使った任意の場所への書き込みも考えられる。「`sudo` は deploy.sh だけ」という IAM の表の前提が弱い。 | deploy.sh は、tar を root 所有の一時ディレクトリへコピーしてから検証と展開を行う。`tar --no-same-owner --no-same-permissions` を使う。展開後に所有者を `root:root`(Caddy が読める権限)に正規化し、シンボリックリンクと `..` を含むエントリを拒否する。SHA-256 の期待値は、ワークフローから ssh の引数で渡すか、検証の限界を設計に明記する。 | New |
| R-03 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > Terraform のファイル構成と Infrastructure Services | 必要な API の有効化がどこにもない(`google_project_service` も、手順書の前提も)。`compute`、`iap`、`oslogin`、`iamcredentials`、`sts`、`cloudresourcemanager`、`serviceusage` が無効なプロジェクトでは、`terraform apply` と WIF の認証と IAP の接続が失敗する。2 回目の `plan` の差分 0 件(NFR4.2)にも関わる。 | `google_project_service` を `iam.tf` か `network.tf` に置く(`disable_on_destroy = false`)。または、手動で有効にする API の一覧と手順を、state バケット作成の手順書に並べると明記する。 | New |
| R-04 | Major | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > VM 上の設定「データディスク」と Infrastructure Services「永続ディスク」 | 「`blkid` で確認し、ファイルシステムがないときだけ `mkfs.ext4`」だけでは、データのあるディスクを初期化しない保証にならない。`blkid` は、デバイスが未出現、読み取りの一時的な失敗、他の理由でも非 0 を返す。判定の条件(終了コードの種類)、デバイスの存在確認と待機、マウントが失敗したときに `mkfs` しないこと、`mkfs` の前にマウントポイントの確認、`chown` をマウント後に行うこと、が書かれていない。起動スクリプトは毎回の起動で走るため、誤判定は即データ消失になる。 | 手順を明記する。(1) `/dev/disk/by-id/google-mobile-order-data` が存在するまで一定時間待ち、無ければ失敗で終了する。(2) `blkid -o value -s TYPE` が空かつ終了コードが 2(署名なし)のときだけ `mkfs.ext4`。それ以外は `mkfs` しない。(3) `mount` に失敗したら `mkfs` せず失敗で終了する。(4) `chown` は `mountpoint -q` が成功した後にだけ行う。 | New |
| R-05 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > IAM の付与と WIF の行 | WIF プロバイダの `attribute_mapping` が示されていない。`principalSet` の `attribute.repository/<owner/repo>` で絞る(「属性 `repository` で絞る」)には、`google.subject` と `attribute.repository` と、条件で使う `assertion.ref` の対応が必要。また、ロールの付与先が「プロジェクトまたは VM」のまま決まっておらず、`compute.projects.get` はプロジェクト単位の権限であるため、開発者が付与先を選べない。 | `attribute_mapping`(`google.subject=assertion.sub`、`attribute.repository=assertion.repository`、`attribute.ref=assertion.ref`)を書く。各ロールの付与先を 1 つに決める(例: `iap.tunnelResourceAccessor` と `compute.osLogin` は VM、カスタムロールはプロジェクト)。余裕があれば `repository_owner_id` も条件に加える。ウォーキングスケルトンで `roles/compute.osLogin` が `compute.instances.get` を既に含むかを確認し、カスタムロールが不要なら削る。 | New |
| R-06 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > Caddyfile と caddy.service | (1) Debian の `caddy.service` の `ExecReload` は `caddy reload` を使うが、`admin off` ではそれが失敗する。起動スクリプトの再実行で Caddyfile が変わったときは `restart` が要る。(2) `header @shell Cache-Control "no-cache"` は `try_files` より先に評価されるため、`/kitchen` のようなパスで `index.html` に落ちた応答には `no-cache` が付かない。説明にある「ハッシュ付きアセットの長いキャッシュ」の設定も Caddyfile にない。(3) Caddy ユーザーが `current/web` を読める権限になることが、deploy.sh の展開で保証されていない。 | 手順書と起動スクリプトで Caddy の反映を `restart` と明記する。画面のフォールバックの `Cache-Control` は、matcher を「`/assets/*` 以外」に変えるか、削除する(アセットの長いキャッシュは `path /assets/*` で付ける)。展開後の権限を `0755` / `0644` に正規化する。 | New |
| R-07 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/traceability.json > upstream_ids と coverage | `nfr-requirements` にある `NFR1.7`、`NFR2.10`、`NFR2.11`、`NFR3.7`、`NFR4.5`、`NFR5.9`、`NFR6.3`〜`NFR6.7`、`NFR7.3`、`NFR7.5` が一覧にない(本文では `NFR6.3`〜`6.7` と `NFR7.5` を引用している)。`NFR2.8` を N/A としているが、`X-Content-Type-Options` を付ける Caddyfile は、NFR2.8 を引用するセキュリティ設計の対応でもある。 | この段階の対象と考える ID を `upstream_ids` と `coverage` に追加する。対象外とするものは、理由つきで N/A にする。`NFR2.8` の N/A の理由に、リスクの記録は NFR 設計の文書にあることと、HTTP のみの構成をインフラが実装することを書く。 | New |
| R-08 | Minor | aidlc/spaces/default/intents/261115-gcp-deploy/construction/infrastructure-design/infrastructure-specification.md > 月額の見積もり | 合計は外部 IPv4 の未確認の単価に依存し、「5 ドル以内」の余裕は約 1.35 ドルしかない。単価が変わると予算を超えうるが、超える場合の閾値(いくらから承認を取り直すか)が書かれていない。 | 「合計が 5 ドルを超える場合は `apply` の承認を取り直す」と閾値を明記し、再確認のチェックリストに IPv4 の単価、無料枠のリージョン条件(e2-micro、標準永続ディスク、GCS)を並べる。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 手動: sudoers と deploy.sh と OS Login | `sa_<unique_id>` と `visudo -c` の方針は妥当。`incoming/` の作成と root の展開に欠陥あり | Major 2 件 |
| 手動: IAP と IAM | 付与ロールは概ね足りる。API の有効化が欠落 | Major 1 件。ロールの付与先の曖昧さは Minor |
| 手動: WIF | `attribute_condition` は repo と ref の両方で妥当。`attribute_mapping` が未記載 | Minor |
| 手動: データディスク | `blkid` の条件だけでは不十分 | Major 1 件 |
| 手動: reliability-design.md と security-design.md との整合 | パス、ユニット名、ロールバックの 120 秒、マウント失敗の例外、`127.0.0.1` はそろっている | 問題なし |
| 手動: Caddyfile | 構文は有効。反映とキャッシュに Minor あり | Minor |
| 手動: traceability.json | NFR2.8 の N/A は理由が薄い。上流の ID が一部欠落 | Minor |
| 手動: 月額の見積もり | 合計 約 3.65 ドルは内訳と整合。閾値の明記が欠けている | Minor |

### Summary

構成と上流の文書との整合は概ねとれているが、`incoming/` の未作成による初回デプロイの失敗、root による利用者書き込み可能な tar の展開、API 有効化の欠落、データディスクの `mkfs` 判定の不足の 4 件の Major があるため、そのままでは実装できない。
