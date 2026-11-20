# CI/CD パイプライン設計: mobile-order の Google Cloud デプロイ

## Sources

- `[Q2]` scp と ssh を IAP 経由、`[Q4]` `deploy.sh` は起動スクリプトで配置、`[Q5]` 単一ルートの Terraform。`infrastructure-design-questions.md` の人間の回答
- `[memory:M1]` `reliability-design.md`(3 節のデプロイとロールバック)、`security-design.md`、`performance-design.md`、`infrastructure-specification.md`
- `[memory:M2]` `requirements.md` の FR1.3、FR5.1〜FR5.4、FR6

## 方針

- CI(PR)は Google Cloud に認証しない(NFR2.5)。検証だけを行う。
- CD(`main` へのマージ)は、WIF で認証し、IAP 経由でアプリの成果物だけを VM に送る。`terraform apply` は CI で実行しない。人間が `plan` を確認して承認してから、手動で実行する(NFR2.9、ALWAYS ルール)。
- `deploy.sh`(VM 上では `/usr/local/sbin/mobile-order-deploy`)は CI から送らない。VM の起動スクリプトが、root 所有・書き込み不可で配置する。CI から VM に送るのはアプリの成果物(`server.mjs`、`schema.sql`、`web/`)だけである。

## ワークフロー 1: `ci.yml`(PR)

| ステージ | 内容 | 合否(ゲート) |
|---|---|---|
| terraform | `terraform fmt -check -recursive`、`terraform init -backend=false`、`terraform validate`(`infra/terraform`) | 終了コード 0(FR1.3) |
| アプリの検証 | 既存の型チェックとテストのスクリプト(`package.json` に定義済みのもの)。新しいテストの追加は範囲外 | 既存のスクリプトが通る(FR5.1) |
| 秘密情報の検査 | `gitleaks` で検査。`git ls-files` に `*.tfvars` がないこと、`"type": "service_account"` を含む JSON がないこと | 0 件(NFR2.4、NFR2.7) |
| 構成の検査 | ワークフローに `terraform apply` と、PR 用のジョブの `google-github-actions/auth` がないこと | なし(NFR2.5、NFR2.9) |
| 権限 | `permissions: contents: read` のみ。`id-token` は付けない | |

マージ前に、これらが通ることを必須とする(ブランチ保護)。

## ワークフロー 2: `deploy.yml`(`main` へのマージ)

トリガーは `push` の `main`。`concurrency` のグループを 1 つにして、同時に 2 つのデプロイを走らせない(`cancel-in-progress: false`)。サードパーティのアクションは、コミットの SHA で固定する。

| 順 | ジョブ / ステップ | 内容 | 要件 |
|---|---|---|---|
| 1 | `build`(権限は `contents: read` のみ。Google Cloud には触れない) | Node.js を VM と同じ固定の版にそろえる。`npm ci`。画面を Vite でビルド(`web/`)。サーバーを、版を固定した esbuild で `server.mjs` にまとめ、`schema.sql` を並べて置く(`npm run build:server`。`--platform=node --format=esm --bundle`、`node:` は外部扱い。ESM のバンドルが動的な `require` を使うため、`--banner:js` で `createRequire` を足す)。アプリが起動時に `server.mjs` と同じ場所の `schema.sql` を読むため、1 ファイルにはまとめられない。`tar` で 1 つの成果物にし、SHA-256 を計算する。リリース ID は `git` のコミットの SHA | NFR5.3、NFR5.4、NFR7.5 |
| 2 | `build` の確認 | ランナーで `node server.mjs` を `node_modules` なしで起動し、`GET /menu` が 200 であること(ウォーキングスケルトンと同じ確認の自動版)。動かなければここで失敗にする | NFR5.4 |
| 3 | `deploy`(権限は `id-token: write` と `contents: read`) | `google-github-actions/auth`(WIF。`GCP_WIF_PROVIDER` と `GCP_DEPLOY_SA`)で認証。キーは使わない | NFR2.4、NFR2.5 |
| 4 | 転送 | まず `gcloud compute ssh --tunnel-through-iap -- mkdir -p incoming`(OS Login ユーザーのホームに受け取り用のディレクトリを作る。初回のログインでホームも作られる)を実行し(`incoming/` は起動スクリプトが作っておくため、実質は疎通と、起動スクリプトの実行済みの確認。ホームは root 所有で、ユーザーは作れない。失敗したら、起動スクリプトの再実行へ進む。初回のログインでホームが作られるのは、起動スクリプトより先にログインした場合だけで、その場合も起動スクリプトの再実行で root 所有に直る)、続けて `gcloud compute scp --tunnel-through-iap` で、成果物と SHA-256 のファイルを `~/incoming/` に置く。SHA-256 のファイルは、転送の破損の検出用で、改ざんへの防御ではない(下の「root での展開の安全策」) | `[Q2]` |
| 5 | 実行 | `gcloud compute ssh --tunnel-through-iap -- sudo /usr/local/sbin/mobile-order-deploy <リリース ID>`。引数はリリース ID だけ | `[Q2]`、`[Q4]` |
| 6 | 結果 | `deploy.sh` の終了コードと、`free -m` の記録の判定、スモークテストの出力を、ジョブのログに出す。非 0 ならジョブを失敗にする | NFR6.6、NFR5.3 |

GitHub のシークレット(リポジトリ): `GCP_PROJECT_ID`、`GCP_WIF_PROVIDER`、`GCP_DEPLOY_SA`、`GCP_ZONE`、`GCP_VM_NAME`。値は `terraform output` から入れる。サービスアカウントキーは置かない。

## `deploy.sh`(`/usr/local/sbin/mobile-order-deploy`)の設計

起動スクリプトが `root:root`、`0755` で配置する。`/etc/sudoers.d/mobile-order-deploy` が、デプロイ用の OS Login ユーザー(`sa_<unique_id>`)にフルパスでこのスクリプトだけを許す。

| 順 | 内容 |
|---|---|
| 受け取り用のディレクトリの保護 | 起動スクリプトが、デプロイ用ユーザー(`sa_<unique_id>`)のホームを `root:root`・`0755` にし、その中の `incoming/` だけをそのユーザーの所有(`0700`)にする。ユーザーは `incoming/` の中には書けるが、ホームの中の `incoming` をリンクなどへ置き換えられない。`deploy.sh` は、最初に(1) ホームがリンクでなく、root 所有で、group と other に書き込み権限がないこと、(2) `incoming/` がリンクでなく、ディレクトリであることを確認し、満たさなければ何も読まずに失敗する(終了コード 1) |
| 入力の検査 | 引数は 1 つだけで、リリース ID が `^[0-9a-f]{40}$` に一致すること。成果物は、`$SUDO_USER` のホーム(`getent passwd "$SUDO_USER"` で引く)の `incoming/<ID>.tar.gz` と `.sha256` に固定(引数でパスを受けない)。照合は、次の行の root 所有の `work/` へのコピーの**後**に、コピーしたファイルに対して行い、一致しなければ失敗(確認後のすり替えを防ぐ) |
| 展開 | 成果物をまず root 所有の一時ディレクトリ(`/var/lib/mobile-order/work/<ID>/`、`0700`)に リンクをたどらない `cp -P`(60 秒の `timeout` つき)でコピーし、`0600` にし(`.tar.gz` と `.sha256` の両方)、**コピーに対して** SHA-256 の照合、検査、展開を行う(コピー後に元ファイルを差し替えられても影響しない)。`releases/.tmp-<ID>/` に展開し、検査が通ったら `mv` で `releases/<ID>/` にする。残っている `.tmp-*` と `work/` は先に削除する。`releases/<ID>` が既にあれば展開しない |
| root での展開の安全策 | 展開の前に `tar -tvf` で一覧を取り、(a) 通常ファイルとディレクトリ以外(シンボリックリンク、ハードリンク、デバイス、FIFO)があれば失敗、(b) パスが絶対パスまたは `..` を含めば失敗、(c) 最上位が `server.mjs`、`schema.sql`、`web/` の 3 つ(完全一致)以外なら失敗にする(許可リストを変えたのは `schema.sql` の 1 件の追加だけで、他の拒否は弱めていない)。成果物のファイル名は ASCII 限定とする(`tar -t` のロケールによっては非 ASCII が `\303\251` の形になり、バックスラッシュの検査で拒否されるため)。名前に制御文字(`tar -t` は `\001` などの形に変えて表示するため、バックスラッシュも拒否する)があれば失敗にする。展開後に `server.mjs`、`schema.sql`、`web/index.html` の存在を確認する。展開は `tar --no-same-owner --no-same-permissions --no-overwrite-dir` で行い、展開後に `find -type l` などで再検査し、所有者を `root:root`、ディレクトリを `0755`、ファイルを `0644` に正規化する(setuid などを残さない)。成果物は、`incoming` のリンクをたどらずに root 所有の `work/` へコピーし(`cp -P`)、検査(通常ファイルであること、SHA-256、`tar` の一覧)はすべてそのコピーに対して行う。検査と配置の間にファイルが差し替えられても、検査していないものは読み込まない。SHA-256 の照合は転送の破損の検出用である。ワークフローの経路(`main` だけが WIF で認証できる)が、成果物の出どころの保証である |
| 切り替え | `prev=$(readlink current)` を記録。`ln -sfn` で `current` を新しい版に向け、`systemctl restart mobile-order` |
| 計測 | デプロイの開始から完了まで 5 秒おきに `free -m` を記録し、スワップの最大が 512 MB 以下、`available` の最小が 100 MB 以上かを判定する(NFR5.3) |
| スモークテスト | VM 上の `localhost` に対して、60 秒以内に `GET /`(200)と `GET /api/menu`(200 と `{ items }` の JSON)(NFR5.5) |
| 成功 | `current` と `prev` 以外のリリースを削除し、`incoming/` の成果物を削除 |
| 失敗 | まず `mountpoint -q /mnt/data` を実行し、未マウントなら NFR3.3 の意図的な例外として、ロールバックせずに非 0 で終了する。それ以外で `prev` があり `prev` と新しい版が異なるときは、`current` を `prev` に戻して再起動し、同じスモークテストをロールバックの開始から 120 秒以内に実行する。初回(`prev` なし)と同じ ID の再デプロイは、ロールバックせず非 0 で終了する。失敗した版のディレクトリは、`current` でも `prev` でもない場合だけ削除する |

## ロールバックと手動の復旧

- 自動: 上の「失敗」の動作(`reliability-design.md` 3 節)。
- 手動(NFR3.4): ロールバックも失敗したとき、所有者が IAP 経由で入り、`current` を直前の版に向けて `systemctl restart mobile-order` を実行する。手順書に書く。
- インフラの変更: `terraform apply` は人間が手動で実行する。実行前に `plan` と見積もり(外部 IPv4 の料金の再確認を含む)を確認して承認する。起動スクリプトを変えたときは、apply の後に、`sudo google_metadata_script_runner startup` の再実行か VM の再起動で反映する(`infrastructure-specification.md`)。

## 環境の昇格・機能フラグ・アーティファクト

| 項目 | 設計 |
|---|---|
| 環境の昇格 | なし(環境は本番相当の 1 つ) |
| デプロイの方式 | ローリングに近い単純な切り替え(`current` のリンク)。数秒〜数十秒の停止は許容する |
| 機能フラグ | なし |
| アーティファクトの管理 | GitHub Actions のアーティファクトに 7 日保持(再現用)。VM には直前の 1 世代だけ残す |

## Assumptions & Open Questions

- `[assumption]` A1: OS Login のユーザー名は `sa_<unique_id>` で、ホームディレクトリは `/home/sa_<unique_id>` になる。ウォーキングスケルトンで確認する。
- `[assumption]` A2: 既存の `package.json` に、型チェックとテストのスクリプトが定義されている(`requirements.md` の FR5.1)。
- 未確定: ESM バンドルの動作は、ウォーキングスケルトンの最初の合格条件で確認する。動かない場合は `--format=cjs` に切り替える(`performance-design.md`)。
- 未確定: esbuild と各アクションの具体的なバージョンは、実装(コード生成の段階)で固定する。
