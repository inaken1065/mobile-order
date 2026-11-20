# セキュリティ設計: mobile-order の Google Cloud デプロイ

## Sources

- `[memory:M1]` `security-requirements.md`(NFR2.1〜2.12、NFR7.1、NFR7.2)と `tech-stack-decisions.md`(NFR7.6)
- `[Q1]` Caddy、`[Q4]` マウントの起動条件。`nfr-design-questions.md` の人間の回答
- `project.md` の ALWAYS / NEVER ルール(キーなし、WIF、自分の IP のみ、課金の承認)と、人間が認めた HOST の例外

## 方針: 多層防御

アプリにはログインがないため、「ネットワークの入口を絞る」ことが唯一の認可になる。入口は 3 層で守る。1 層が設定誤りになっても、認証のない API が外に出ないようにする。

| 層 | 防御 | 要件 |
|---|---|---|
| 1 | ファイアウォール: 80 番は自分の IP のみ、22 番は IAP の範囲のみ。3000 番は開けない | NFR2.1〜2.3 |
| 2 | Fastify が `HOST=127.0.0.1` で待ち受ける(VM の外からは 3000 番に届かない) | NFR2.12 |
| 3 | Caddy は `/api` と静的ファイル以外を転送せず、転送先を `127.0.0.1:3000` に固定する | NFR2.3 |

`HOST` を指定しないとアプリは `0.0.0.0` で待ち受ける(既存の動作)。systemd のユニットで `HOST=127.0.0.1` を必ず指定し、デプロイ後の確認で `ss -ltn` の 3000 番が `127.0.0.1` だけであることを見る。

## 入口の設計

| 項目 | 設計 | 要件 |
|---|---|---|
| 80 番 | ソースレンジは変数 `allowed_ip_cidr` のみ。変数ファイル(`*.tfvars`)は Git に入れない | NFR2.1、NFR2.7 |
| 22 番 | `35.235.240.0/20` のみ。`gcloud compute ssh --tunnel-through-iap` と OS Login で入る | NFR2.2 |
| 外部 IPv6 | 割り当てない。ファイアウォールは IPv4 だけで定義する | NFR2.3 |
| Caddy | `auto_https off`、`admin off`。`:80` だけで待ち受ける。応答に `X-Content-Type-Options: nosniff` を付ける | NFR2.3、NFR2.8 |
| HTTP のみ | 暗号化なしの通信は学習用として受け入れたリスク。注文内容が平文で流れることを記録する | NFR2.8 |

## 認証とデプロイの統制

| 項目 | 設計 | 要件 |
|---|---|---|
| WIF | プールとプロバイダは、属性条件で `repository` が本リポジトリ、`ref` が `refs/heads/main` の両方に一致するときだけ許可する | NFR2.5 |
| PR の CI | Google Cloud に認証しない。ワークフローの PR 用ジョブに `google-github-actions/auth` を置かない | NFR2.5 |
| サービスアカウントキー | 作らない。`google_service_account_key` を Terraform に置かない。CI で `"type": "service_account"` の検査をする | NFR2.4 |
| デプロイ用 SA の権限 | IAP トンネルの利用、OS Login でのログイン、VM のサービスアカウントとしての利用だけ。`roles/editor` と `roles/owner` は付けない。付与ロールは Terraform の 1 か所に並べる | NFR2.6 |
| 課金の承認 | CI は `terraform apply` を実行しない。`apply` の前に、`plan` の結果と見積もり(外部 IPv4 の料金の再確認を含む)を人間が確認して承認する | NFR2.9、NFR1.3 |

## VM 内の防御

| 項目 | 設計 | 要件 |
|---|---|---|
| 実行ユーザー | アプリは専用ユーザー `mobile-order`(ログインなし)で動かす | NFR2.12 |
| systemd の制限 | `NoNewPrivileges=yes`、`ProtectSystem=strict`、`ProtectHome=yes`、`PrivateTmp=yes`、`ReadWritePaths=/mnt/data` | NFR2.12 |
| Node.js の導入 | 固定したバージョンの公式の配布物を、固定した SHA-256 で検証してから入れる。不一致なら起動スクリプトが失敗する | NFR7.2 |
| 実行前の確認 | 起動スクリプトとユニットの前処理で `node --version` が 24 以上、`node -e "require('node:sqlite')"` が成功することを確認する | NFR7.1 |
| 秘密情報 | リポジトリと CI の出力に、自分の IP、プロジェクト ID、秘密を出さない。`*.tfvars` は `.gitignore`、`gitleaks` で検査する | NFR2.7 |

## 検証の観点(合否)

- 許可 IP 以外から `curl` が 80 番に届かない。外部から 3000 番に接続できない。`ss -ltn` の 3000 番が `127.0.0.1` のみ。
- ファイアウォールのルール一覧に、上の 2 つの許可以外がない。
- `main` 以外のブランチ、他のリポジトリからの WIF の認証が失敗する。
- `git ls-files` に `*.tfvars` がない。`gitleaks` が 0 件。

## Assumptions & Open Questions

- `[assumption]` A1: 自分の IP は固定に近く、変わったときは変数を更新して `plan` を確認し、承認のうえで `apply` し直す。
- 未確定: IAP の TCP 転送に追加の料金がないことは、実施時に公式情報で再確認する(要件定義の A5)。
