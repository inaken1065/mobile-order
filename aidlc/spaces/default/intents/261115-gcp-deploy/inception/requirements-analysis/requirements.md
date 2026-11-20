# 要件定義: mobile-order の Google Cloud デプロイ

## Sources

- `[desc]` Initial description: `project-description.json`（Terraform / GCS state / Compute Engine 1 台 / SQLite を永続ディスク / GitHub Actions + Workload Identity Federation / 最小コスト / 自分の IP のみ / 課金操作は事前承認）
- `[scope]` Workflow-selected scope: infra（コード生成とビルド＆テストは含まない）
- `[Q1]`〜`[Q7]` `requirements-analysis-questions.md` の人間の回答（要約確認済み）
- 既存コードの調査: `business-overview.md`、`architecture.md`、`code-structure.md`（`aidlc/spaces/default/codekb/mobile-order/`）
- チームの進め方: `team-practices.md`（`inception/practices-discovery/`）と `project.md` の ALWAYS / NEVER ルール

## Intent analysis

mobile-order（飲食店向けモバイルオーダー。客・厨房・店長の 3 画面と Fastify API、SQLite）は、これまでローカルでしか動いていない。目的は、これを **学習用に最小コストで** Google Cloud 上で動かし、`main` へのマージで更新が届く仕組みまで作ること。アプリのコードは変えない（`[scope]`）。アプリにログイン機能がないため、**自分の IP アドレスからだけ** アクセスできるようにする。

現状（`architecture.md`、`code-structure.md`）:
- Fastify が `PORT`（既定 3000）で API だけを返す。画面は開発時の Vite が配る。本番用の画面配信はない
- DB は `DB_PATH`（既定 `data/app.db`）の SQLite。空ならシードを投入する
- Node.js 24 以上が必要（`node:sqlite` を使う）
- CI、リンタ、デプロイ設定はまだない（`.github/` なし）

## Functional requirements

### FR1 インフラを Terraform で管理する
- FR1.1 GCP のリソース（VM、永続ディスク、ファイアウォール、サービスアカウント、Workload Identity Federation）はすべて Terraform で定義する。手作業で作ったリソースを残さない。`[desc]`
- FR1.2 Terraform の state は GCS バケットに保存する（ALWAYS ルール）。state 用バケットは先に手動またはブートストラップ手順で用意し、その作り方を手順書に書く。`[desc]`
- FR1.3 CI で `terraform fmt -check -recursive` と、`terraform init -backend=false` に続く `terraform validate` が、どちらも終了コード 0 で終わる。`init -backend=false` にするのは、CI が GCS バックエンドや認証に触れずに検証するため（`plan` と `apply` は CI では実行しない）。`[memory:M1]`（`team-practices.md` の Testing Posture）
- FR1.4 `terraform apply` は、実行のたびに人間が `plan` の内容を確認して承認してから、手動で実行する。CI は `apply` を自動実行しない。`[desc]`

### FR2 Compute Engine の VM 1 台でアプリを動かす
- FR2.1 リージョンは us-central1、マシンタイプは e2-micro（無料枠の対象）。`[Q2]` `[Q3]`
- FR2.2 SQLite の DB ファイルは永続ディスクに置く。VM を作り直しても、ディスクが残っていればデータが残る。`DB_PATH` で場所を指定する。`[desc]`
- FR2.3 VM 起動（再起動を含む）から 120 秒以内に、アプリ（Fastify）が起動して `GET /api/menu`(VM 内のアプリには `GET /menu`。200 と `{ items }` の JSON)が 200 を返す。ヘルスチェック専用のパスは追加しない。(NFR 要件の Q1 で決定)プロセスを強制終了（`kill -9`）したら、systemd が 30 秒以内に再起動する。
- FR2.4 データ用の永続ディスクは、ブートディスクと分け、通常の再構築（VM の作り直し、`terraform apply` の再実行）では削除されない。具体的には、データディスクは VM とは別の Terraform リソースとして定義し、VM の作り直しではディスクをデタッチするだけにする。`terraform destroy` でも消えないようにする保護（`prevent_destroy` など）を付ける。
- FR2.4b 学習後に課金を止めるための片付けの手順（VM、外部 IP、ディスクの削除と、請求が止まったことの確認）を、手順書の項目として定義する。データディスクを残すか消すかは、実行時に人間が選び、承認を取る。
- FR2.4a データディスクを完全に削除する手順（保護の解除、削除、確認）は、通常の再構築手順とは別の手順書として定義する。実行には、FR7 の人間の承認を必須とする。NFR4 の「ゼロから再構築」は、この完全削除の手順を実行したあと、またはデータディスクがまだ存在しない状態からの構築を指す。
- FR2.5 DB が空のときの初回起動でシードが入る（既存の動作）。2 回目以降の起動や再デプロイで、既存のデータを上書きしない。

### FR3 アクセスは自分の IP からだけに制限する
- FR3.1 VM へのアクセスを許可する送信元は、変数で渡す自分の IP アドレス（CIDR）だけにする。それ以外の IP からは、画面にも `/api` にもつながらない。ALWAYS ルール。`[desc]`
- FR3.2 自分の IP はコード（Git 管理下のファイル）に書かない。コミットしない変数ファイルか GitHub のシークレットで渡す。`[Q5]`
- FR3.3 自分の IP が変わったときは、変数を更新して `plan` を確認し、承認のうえで `terraform apply` し直せば追従できる。`[Q5]`
- FR3.4 通信は HTTP のみ（80 番）。ドメインと HTTPS は用意しない。`[Q4]`
- FR3.5 アプリ（80 番）へのインターネットからの入口は、自分の IP（FR3.1）だけに絞る。GitHub Actions のランナーの IP は固定できないため、ランナーからのアクセスを許可する IP は追加しない。
- FR3.6 SSH（22 番）は、Identity-Aware Proxy（IAP）の送信元 `35.235.240.0/20` からだけを許可する。インターネットの他の送信元（自分の IP を含む）からの直接の SSH は許可しない。自分の SSH も `gcloud compute ssh --tunnel-through-iap` に統一する。許可するポートは、80 番（自分の IP）と 22 番（IAP の範囲）の 2 つだけとする。
- FR3.7 IAP 経由の SSH に必要な IAM 権限（`roles/iap.tunnelResourceAccessor` など）と OS Login 関連の権限は、デプロイ用サービスアカウントと自分のアカウントに、最小限で Terraform から付与する。

### FR4 画面と API を 1 つの入口で配る
- FR4.1 VM 上の Caddy か nginx が、画面のビルド成果物（静的ファイル）を配信し、`/api` を外して Fastify に転送する。画面(Vite)はランナーでビルドした成果物を配信する。(NFR 要件の Q2 で決定)
- FR4.2 Fastify は VM の外に直接公開しない（ローカルからの接続だけを受ける。ファイアウォールでも 3000 番を開けない）。
- FR4.3 客・厨房・店長の 3 つの画面（パスで切り替え）が、デプロイ後に表示できる。`[memory:M2]`（`business-overview.md`）

### FR5 GitHub Actions で CI/CD を行う
- FR5.1 PR で、Terraform の `fmt -check` と `validate`（FR1.3）と、アプリの既存の型チェックとテストのスクリプト（`package.json` に定義済みのもの）を実行する。アプリのコードは変更せず、新しいテストの追加や、80% カバレッジの達成は本作業の範囲外（Out of scope）。マージ前にこれらが通ることを必須とする。`team-practices.md` の Testing Posture
- FR5.2 `main` へのマージで、アプリを VM に自動でデプロイする（ランナーでビルド → 配置 → 再起動）。画面(Vite)とサーバー(TypeScript)の両方をランナーでビルドし、サーバーは Fastify ごと 1 つの JS ファイル(`server.mjs`)にまとめて、成果物だけを VM に転送する。VM には `node_modules`、tsx、TypeScript を入れない。VM の Node.js は 24 以上を固定して入れ、起動時に `node:sqlite` の読み込みまで確認する(NFR 要件の Q2 で決定)。接続は、Workload Identity Federation で認証したうえで `gcloud compute ssh --tunnel-through-iap` を使う（FR3.6、FR6.1）。Terraform の `apply` は含めない。`team-practices.md` の Deployment
- FR5.3 デプロイ後のスモークテストは、VM 上で `localhost` に対して実行する（GitHub Actions のランナーからは VM の 80 番に届かないため。FR3.5）。合格条件は、(a) `GET /`（画面）が 200 を返す、(b) `GET /api/menu`(VM 内のアプリには `GET /menu`)が 200 で `{ items }` の JSON を返す、の両方が、デプロイ完了後 60 秒以内に満たされること。満たされなければ、ジョブを失敗として終了する。
- FR5.4 デプロイが失敗した（FR5.3 が不合格、またはデプロイ手順が非 0 で終了した）場合は、直前の成功版に自動で戻し、戻したあとに FR5.3 と同じスモークテストが合格する。直前の成功版は、VM 上に最新の 1 世代分を残して使う。自動で戻せなかった場合は、ジョブを失敗として終了し、手動の復旧手順（手順書）で戻せる。DB ファイルは、ロールバックの対象に含めない（FR2.5）。

### FR6 認証は Workload Identity Federation だけを使う
- FR6.1 GitHub Actions から Google Cloud への認証は Workload Identity Federation で行う（ALWAYS ルール）。`[desc]`
- FR6.2 サービスアカウントキー（JSON キー）は作成も保存も使用もしない（NEVER ルール）。リポジトリにも GitHub のシークレットにも置かない。`[desc]`
- FR6.3 WIF の許可条件は、このリポジトリの `main` ブランチ（`attribute.repository` と `ref` の両方）に限定する。他のリポジトリや他のブランチの実行からは認証できない。PR の CI（FR5.1）は Google Cloud に認証しない。
- FR6.4 デプロイ用のサービスアカウントに付ける権限は、IAP トンネルの利用（`roles/iap.tunnelResourceAccessor`）、VM への OS Login ログイン（`roles/compute.osAdminLogin` または `roles/compute.osLogin`）、VM のサービスアカウントとしての利用（`roles/iam.serviceAccountUser`）の範囲に限り、プロジェクト全体の編集権限（`roles/editor` など）は付けない。付与するロールの一覧は、インフラ設計で確定し、Terraform のコードで確認できる。
- FR6.5 自分のアクセス元の IP が変わって、アプリに届かなくなった場合も、SSH は IAP 経由（FR3.6）なので VM に入れる。許可 IP の更新は FR3.3 の手順で行う。IAP でも入れない場合の最後の手段は、シリアルコンソールの有効化（承認を取って実施）とする。

### FR7 課金が発生する操作は事前に承認を取る
- FR7.1 `terraform apply` など課金が発生する操作は、実行前に人間の承認を取る。承認なしでは実行しない（ALWAYS / NEVER ルール）。`[desc]`
- FR7.2 承認を求めるときは、何が作られ、いくらかかる見込みかを、`terraform plan` の結果とあわせて示す。

## Non-functional requirements

- NFR1 コスト: 月額の見込みは 5 ドル以内。内訳と根拠は下の「コスト見積もり」に示す。無料枠から外れる構成にするときは、その前に承認を取る。`[Q7]`
- NFR2 セキュリティ: 許可 IP 以外の通信を遮断する（FR3.1）。SSH は IAP 経由だけ（FR3.6）。サービスアカウントキーを使わない（FR6.2）。秘密情報と許可 IP を Git に入れない。HTTP のみのため、注文内容は暗号化されずに許可 IP との間を流れる。この点は学習用として受け入れる（リスクとして記録）。`[Q4]`
- NFR3 復旧: バックアップは取らない。データが失われたら、シードデータから作り直す。その手順を手順書に書く。`[Q6]`
- NFR4 再現性: 空の GCP プロジェクトと state 用バケットがあれば、手順書どおりに Terraform と CI/CD でゼロから構築できる（FR2.4a の前提を含む）。`terraform apply` を続けて 2 回実行したとき、2 回目の `plan` の差分が 0 件である。
- NFR5 リソース制約: メモリ 1 GB の VM で、Caddy / nginx と Fastify を同時に動かし、通常の操作（画面表示、注文、状態更新）を 10 分間続けても OOM kill が 0 回である（`dmesg` / `journalctl` で確認）。余裕がなければ、スワップ領域（目安 1 GB、標準永続ディスク上）を VM に設定する。スワップの要否と大きさは、この基準で NFR 設計の段階で決める。
- NFR6 運用: アプリと Caddy / nginx のログを、VM 上で `journalctl -u <サービス名>` で確認できる。死活確認は、`GET /` が 200 を返すことで行う（FR5.3 と同じ）。エラーの確認は、`journalctl -u <サービス名> -p err` で、直近 24 時間のエラー行が取り出せることをもって合格とする。ログの保持期間や通知の設計は、後の運用の段階で決める。
- NFR7 互換性: Node.js 24 以上を VM に用意する（`node:sqlite` を使うため）。ビルドと実行で同じバージョンを使う。

## コスト見積もり（NFR1 の根拠）

Google の公式ドキュメントで確認できたこと（[無料枠のページ](https://docs.cloud.google.com/free/docs/free-cloud-features)）: 無料枠は、請求先アカウントごとに、e2-micro（非プリエンプティブ）1 台分の稼働時間（us-west1 / us-central1 / us-east1）、標準永続ディスク 30 GB-月、北米からの外向き通信 1 GB / 月。外部 IP アドレスについては、このページに記載がなく、無料枠の対象とは確認できなかった。

外部 IPv4 の料金: 公式の料金ページ（`cloud.google.com/vpc/network-pricing`）は本文を取得できず、数値を直接は確認できていない。2024 年 2 月以降の公開情報では、使用中の外部 IPv4 は約 0.005 ドル / 時間（約 3.65 ドル / 月、730 時間として）とされる。無料枠に含まれないものとして見積もる。この数値は、A5 のとおり、実施時点の公式ページで再確認する。

| 項目 | 月額の見込み | 根拠 |
|---|---|---|
| e2-micro（us-central1、730 時間） | 0 ドル | 無料枠（1 台分の稼働時間） |
| 標準永続ディスク（ブート + データで 30 GB 以内） | 0 ドル | 無料枠（30 GB-月） |
| 外部 IPv4（使用中、VM に 1 つ） | 約 3.65 ドル | 0.005 ドル × 730 時間（未確認の数値。A5） |
| 外向き通信（自分の画面表示のみ） | 0 ドル | 無料枠 1 GB / 月に収まる前提（A6） |
| IAP の TCP 転送、Workload Identity Federation | 0 ドル | 追加料金なし（公式で再確認。A5） |
| GCS の state バケット（数 KB） | 約 0 ドル | 容量が極小。Standard クラスの無料枠（5 GB）は us-central1 などの対象リージョンで確認する（A5） |
| **合計** | **約 3.65 ドル** | 上限 5 ドルに対して約 1.35 ドルの余裕 |

### 外部 IP の扱い（比較と推奨）

外部 IP は、自分の IP から VM の 80 番に届くために必要なので、なくせない（FR3.1）。次の 2 案を比べた。

| 案 | 料金 | 利点 | 欠点 |
|---|---|---|---|
| A: 静的 IP を予約する | 使用中は約 3.65 ドル / 月で、案 B と同じ。VM に付けていない間は、より高い料金（約 0.01 ドル / 時間で、約 7.3 ドル / 月。未確認）がかかる | VM を作り直してもアクセス先 URL が変わらない。ブックマークを更新しなくてよい | 付け忘れや VM 削除後の放置で、月 5 ドルを超えうる。Terraform の管理対象が 1 つ増える |
| B: エフェメラル IP で、変わる前提で運用する | 約 3.65 ドル / 月 | 管理対象が少ない。VM がないときに料金が出ない | VM を作り直す、または止めて起動し直すと、IP が変わる。アクセス先 URL を、そのたびに `terraform output` で確認する必要がある |

**推奨: 案 B（エフェメラル IP）。** 使用中の料金が同じで、放置による課金リスクがない。URL が変わる点は、`terraform output` で IP を確認する手順書で補う。利用者が自分だけで、VM を作り直す頻度が低いため。静的 IP が必要になった場合は、承認を取ったうえで案 A に切り替える。

## Corner conditions（`corner-checklist.md` による確認）

| 条件 | 扱い |
|---|---|
| ディスクが満杯・読み取り専用 | NFR6 のログ確認で気づけるようにする。DB の書き込み失敗は既存のエラー処理に任せる（Assumption A3） |
| デプロイ中に VM やアプリが止まる | 短い停止は許容する（Assumption A2）。途中で失敗したら、直前の版が動き続けるか、ロールバックできる（FR5.4） |
| 再デプロイ・VM 作り直しでデータが消える | FR2.4、FR2.5 で防ぐ。完全削除は FR2.4a の別手順 |
| VM の IP が変わる（作り直し・停止後の起動） | エフェメラル IP を採用（推奨）。`terraform output` で確認する（コスト見積もり） |
| ローカルでは動くが本番では動かない | CI と VM で Node のバージョンを揃える（NFR7）。スモークテスト（FR5.3） |
| 設定が足りない・誤っている | `DB_PATH`、`PORT`、許可 IP が未設定なら、起動またはデプロイが失敗して原因が分かる |
| 許可 IP が変わった | FR3.3 |
| 秘密情報が漏れる | FR6.2、NFR2 |
| 複数タブ・複数端末（客・厨房） | 既存のポーリングの動作を変えない。本作業では扱わない |

## Constraints

- アプリのコード（`server/`、`web/`、`contracts/`）は変更しない。`[scope]`
- 構成は Compute Engine の VM 1 台。SQLite のまま。マネージド DB やコンテナ基盤は使わない。`[desc]`
- GitHub Actions を使う。Workload Identity Federation で認証する。`[desc]`
- 課金が発生する操作は、実行前に人間の承認を必須とする。`[desc]`
- 作業ブランチは `feature/gcp-deploy`。`feature/*` から PR で `main` に squash マージする。`team-practices.md`

## Assumptions

- `[assumption]` A1: GCP のプロジェクトと請求先アカウントは、すでにある（または、あなたが用意する）。Terraform でプロジェクト自体は作らない。
- `[assumption]` A2: デプロイ時の数秒〜数十秒の停止は許容できる（学習用、利用者は自分だけ）。
- `[assumption]` A3: アプリ側のエラー処理（`ApiError` など）は今のままでよく、この作業では変更しない。
- `[assumption]` A4: GitHub リポジトリは 1 つで、デプロイ対象のブランチは `main` だけ。
- `[assumption]` A5: 無料枠の条件（e2-micro 1 台、標準永続ディスク 30 GB、1 GB / 月の外向き通信）と、外部 IPv4 の料金、IAP と GCS の料金は、実施時点の公式情報で再確認する。確認できなければ、この見積もりを更新して承認を取り直す。
- `[assumption]` A6: 外向き通信は、利用者が自分だけの画面表示と API で、1 GB / 月に収まる。超えた場合の料金は小さい（数セント程度）とみなすが、請求で確認する。

## Out of scope

- アプリのコード変更（静的ファイル配信の追加、ログイン機能、`ApiError` の共通化など）
- ドメイン、HTTPS、証明書
- バックアップ、複数環境（staging）、高可用性、オートスケール
- アプリ側の Prettier / ESLint 導入と 80% カバレッジの達成（方針としては記録済みだが、この作業の範囲外）
- マネージド DB（Cloud SQL など）への移行

## Open questions

- 許可する自分の IP アドレス自体は、ここでは聞いていない。インフラ設計・環境構築の段階で、コミットしない変数として受け取る。
- GCP のプロジェクト ID と請求先の有無（A1）は、インフラ設計の段階で確認する。
- 1 GB のメモリで Caddy / nginx と Fastify が安定して動くかは、NFR 設計で確認する（NFR5）。
