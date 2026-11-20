# Discovered Rules

> 人間が明示した固定の制約だけを載せる。出典は初期説明(`project-description.json`)とインタビュー Q8。

## Mandated

- ALWAYS `terraform apply` など課金が発生する操作は、実行のたびに人間の承認を取ってから手動で実行する。
- ALWAYS Google Cloud への GitHub Actions 認証は Workload Identity Federation を使う。
- ALWAYS Terraform の state は GCS バケットに保存する。
- ALWAYS アプリへのアクセスは所有者の IP アドレスからだけに制限する(アプリにログイン機能がないため)。

## Forbidden

- NEVER サービスアカウントキー(JSON キー)を作成・保存・使用しない。
- NEVER 人間の承認なしに課金が発生する操作を実行しない。
