# Requirements Analysis — 質問

初期説明（Terraform / GCS state / Compute Engine 1 台 / SQLite を永続ディスク / GitHub Actions + Workload Identity Federation / 最小コスト / 自分の IP だけ / 課金操作は事前承認）と、既存コードの調査から決められなかった点だけを聞きます。

## Q1. [開発者] 本番での画面（web）の配信方法
今のサーバー（Fastify）は API だけを返し、画面（React をビルドした静的ファイル）は開発時の Vite が配っています。本番の VM で画面をどう配りますか？ アプリのコードを変えない方法を推奨します。

A. VM 上に Caddy か nginx を置き、静的ファイルを配信して `/api` を Fastify に転送する（アプリのコード変更なし）
B. Fastify に静的ファイル配信を足す（アプリのコード変更が必要。この作業の範囲外になる）
C. 画面は別の場所（Cloud Storage など）から配る
X. Other (please specify)

[Answer]: A

## Q2. [運用] リージョン（VM を置く場所）
最小コストの方針です。Compute Engine の無料枠（e2-micro 1 台）は米国の一部リージョン（us-west1 / us-central1 / us-east1）だけが対象で、日本（asia-northeast1）は対象外です。どちらにしますか？

A. 米国リージョン（us-central1 など）。無料枠を使い、日本からは通信がやや遅くなる
B. 東京（asia-northeast1）。無料枠はなく VM 代がかかる。通信は速い
X. Other (please specify)

[Answer]: A

## Q3. [運用] VM のマシンタイプ
アプリは Fastify + SQLite の小さな構成です。どのサイズにしますか？

A. e2-micro（共有 CPU 2 vCPU・メモリ 1 GB。米国リージョンなら無料枠）
B. e2-small（メモリ 2 GB。月 1,500 円前後）
C. e2-medium（メモリ 4 GB）
X. Other (please specify)

[Answer]: A

## Q4. [運用] 通信の暗号化（HTTPS）
アクセスは自分の IP からだけに制限します。ドメインがないと HTTPS 証明書は取れません。どうしますか？

A. HTTP のみ（VM の外部 IP に直接アクセス。自分の IP 以外は遮断するので学習用なら許容）
B. ドメインを用意し、HTTPS にする（証明書は自動取得。ドメイン代がかかる）
X. Other (please specify)

[Answer]: A

## Q5. [運用] 自分の IP アドレスの扱い
許可する IP はコードに書かず、Terraform の変数（コミットしないファイルや GitHub のシークレット）で渡す想定です。自宅などの回線の IP は変わることがあります。

A. IP は固定。変わることはほぼない
B. IP は変わることがある。変わったら変数を更新して、承認のうえで `terraform apply` し直す
X. Other (please specify)

[Answer]: B

## Q6. [運用] データのバックアップ
SQLite のファイルは永続ディスクに置きます。VM が壊れてもディスクは残りますが、ディスクごと消した場合や操作ミスには備えがありません。

A. 永続ディスクのスナップショットを毎日 1 回、7 世代まで保持する（少額の課金）
B. バックアップなし。消えたらシードデータから作り直す（学習用）
C. 手動で必要なときにスナップショットを取る
X. Other (please specify)

[Answer]: B

## Q7. [運用] 月額コストの上限の目安
この上限を超えそうなら、構成を見直す基準にします。

A. 月 5 ドル（約 800 円）以内
B. 月 10 ドル（約 1,500 円）以内
C. 月 20 ドル（約 3,000 円）以内
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

上の回答を要約して、成果物の生成前に確認します。

- Looks correct
- Request changes

[Answer]: Looks correct
