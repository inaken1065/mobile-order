# Project-Level Rules

> Project-specific specialisation and corrections. Loaded after `org.md` and
> `team.md` as strict-additive guidance; contradictions with broader policy
> are rejected. Populated by practices-discovery and the self-learning loop.
>
> Use sparingly: most teams don't need a project layer. Reach for it
> only when this specific project needs stable, durable guidance beyond the
> team practice (for example, package-specific release checks or an additional
> regression suite for a legacy component).

## Way of Working

<!-- Project-specific specialisation. Example: -->
<!-- This monorepo requires package-scoped branch names and a package owner -->
<!-- review in addition to the team's normal merge policy. -->

## Walking Skeleton

<!-- Project-specific specialisation. Example: -->
<!-- The walking skeleton must exercise the legacy service adapter as well -->
<!-- as the new service boundary. -->

## Testing Posture

<!-- Project-specific specialisation. -->

## Guard Policy

<!-- Project-specific. Mode: strict, relaxed, or off. Strict here holds for every intent, whatever one person asks in chat; relaxed or off here applies to every intent whose policy came from its scope, unless the person sets another; changing this line changes it. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment

<!-- Project-specific specialisation. -->

## Code Style

<!-- Project-specific specialisation. -->

## Tech Stack

<!-- Technology choices locked for this project. -->

## Decided

<!-- Decisions made in earlier stages that should not be re-asked. -->
<!-- Format: DECIDED: [decision] (Stage [slug], [date]) -->

## Scope Overrides

<!-- Custom scope rules for this project. -->

## Forbidden

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: NEVER [behavior] (affirmed [date]) -->
<!-- Example: NEVER throw exceptions across service layer boundaries (affirmed 2026-05-17) -->

- NEVER サービスアカウントキー(JSON キー)を作成・保存・使用しない。 (affirmed 2026-11-15)

- NEVER 人間の承認なしに課金が発生する操作を実行しない。 (affirmed 2026-11-15)

## Mandated

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: ALWAYS [behavior] (affirmed [date]) -->
<!-- Example: ALWAYS use Result<T,E> for fallible operations in service layer (affirmed 2026-05-17) -->

- ALWAYS `terraform apply` など課金が発生する操作は、実行のたびに人間の承認を取ってから手動で実行する。 (affirmed 2026-11-15)

- ALWAYS Google Cloud への GitHub Actions 認証は Workload Identity Federation を使う。 (affirmed 2026-11-15)

- ALWAYS Terraform の state は GCS バケットに保存する。 (affirmed 2026-11-15)

- ALWAYS アプリへのアクセスは所有者の IP アドレスからだけに制限する(アプリにログイン機能がないため)。 (affirmed 2026-11-15)

## Corrections

<!-- Project-specific corrections from human feedback. -->
<!-- Format: NEVER/ALWAYS [behavior] (learned [date]) -->
- 要件定義の承認で受け入れたリスク R-08(ヘルスチェックと読み取り用に使う既存 API パスの特定)と R-09(ビルドをランナーと VM のどちらで行うか。1 GB の VM でのビルドは NFR5 に影響する)は、NFR 設計とインフラ設計のステージで必ず決める。外部 IPv4 の料金(約 0.005 ドル/時間は未確認)は、A5 のとおり公式情報で再確認し、確認できなければ見積もりを更新して承認を取り直す。 (learned 2026-11-16) <!-- cid:261115-gcp-deploy:requirements-analysis:fe77d46f34b6af6b58a28b4eead0dbe3f01db35883ba349512c2b9d4c43a431a -->
- NFR 要件のレビューで、アプリのコード変更は「サーバーの待ち受けアドレスを環境変数 HOST で指定できる最小限の変更(未指定時は従来どおり 0.0.0.0、VM では 127.0.0.1、既存テストは書き換えない)」だけを例外として認める。データディスクが未マウントのときはアプリを起動しない(systemd で制御)。自動ロールバックには 120 秒の上限を設け、その時間内にスモークテストが合格することを合格条件にする。 (learned 2026-11-16) <!-- cid:261115-gcp-deploy:nfr-requirements:169441a2bb676f7723c5004d227c32663bce917171d3dcd24ea3198c49627f03 -->
