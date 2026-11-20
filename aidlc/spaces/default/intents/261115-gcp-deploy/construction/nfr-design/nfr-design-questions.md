# NFR Design: 質問

NFR 要件で「設計ステージで決める」とした点だけを聞きます。要件に書かれた数値(NFR3.1〜3.8、NFR5.1〜5.6 など)と、人間が承認した HOST の例外(NFR2.12、NFR7.6)は、そのまま前提にします。

## Q1. [アーキテクト] リバースプロキシ

NFR5.8 で「Caddy または nginx」としていた選択です。どちらも `/api` を外して `127.0.0.1:3000` に転送し、画面の静的ファイルを配信できます(転送先は `localhost` ではなく `127.0.0.1` と明記します)。

- A. Caddy(推奨。設定が短く、メモリ使用が小さい。HTTP のみで使う)
- B. nginx(情報が多い。設定は長い)
- X. Other (please specify)

[Answer]: A

## Q2. [アーキテクト] デプロイの切り替えとロールバックの方式

NFR3.3(失敗したら 120 秒以内に自動で戻る)を満たす置き方です。DB ファイルはデータディスクに置き、どの方式でもロールバックの対象にしません(FR2.5)。

- A. リリースごとのディレクトリ(`releases/<id>/` に `server.mjs` と画面)を作り、`current` のシンボリックリンクを切り替えて systemd を再起動する。直前の 1 世代を残し、失敗したらリンクを戻して再起動する(推奨。切り替えが一瞬で、戻しも同じ操作)
- B. 既存のファイルを上書きし、上書き前に直前の版を `previous/` にコピーしておく(戻すときはコピーを書き戻す。中途半端な状態が残りやすい)
- X. Other (please specify)

[Answer]: A

## Q3. [アーキテクト] サーバーを 1 つの JS にまとめる道具

NFR7.4 の「ランナーで Fastify を含めて 1 つの JS ファイルにする」道具です。CI のワークフロー内でだけ使い、アプリの `package.json` には加えません。`node:` の組み込みモジュール(`node:sqlite` など)は外部扱いにします。

- A. esbuild(推奨。ESM 出力と拡張子なし import の解決に対応。`--platform=node --format=esm` で `node:` を外部扱いにできる。バージョンを固定して `npx` で使う)
- B. Rollup や webpack(設定が増える)
- X. Other (please specify)

[Answer]: A

## Q4. [運用] データディスクのマウントと起動条件(NFR3.8)

マウントされていないときにアプリが起動しないようにする方法です。ブートディスクに空の DB が作られることを防ぎます。

- A. データディスクを `/etc/fstab` に `nofail` 付きで書き(`/dev/disk/by-id/google-<名前>`)、アプリのユニットに `RequiresMountsFor=` と `ConditionPathIsMountPoint=` を併用する。DB は `<マウント先>/app.db`、`DB_PATH` で指定する(推奨。マウント定義が欠けても起動しない)
- B. `RequiresMountsFor=` だけを使う(マウント定義が欠けると、ブートディスクの上で起動してしまう)
- X. Other (please specify)

[Answer]: A(ただし `ConditionPathIsMountPoint=` ではなく `AssertPathIsMountPoint=` を使い、未マウント時は起動失敗として検知できるようにする)

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
