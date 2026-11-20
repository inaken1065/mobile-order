# NFR Requirements: 質問

要件定義(`requirements.md`)で数値にした NFR を前提に、まだ決まっていない点だけを聞きます。Q1 と Q2 は、要件定義の承認で「設計ステージで必ず決める」と受け入れたリスク R-08・R-09 です。

## Q1. [開発者] ヘルスチェックと読み取り確認に使う API パス(R-08)

デプロイ後のスモークテストと死活確認は、アプリのコードを変えずに使える既存のパスを 1 つ決める必要があります。既存の API には専用のヘルスチェックがなく、メニュー取得(`GET /menu`)が、副作用がなく DB を読む読み取り用です。VM 上のリバースプロキシは `/api` を外してアプリに転送します(開発時の Vite プロキシと同じ動作)。つまり、外からは `GET /api/menu`、VM 内のアプリには `GET /menu` です。

- A. 画面は `GET /`、API は `GET /api/menu`(200 と `{ items }` の JSON)の 2 つで合否を判定する(推奨。コード変更なし)
- B. `GET /` だけで判定する(DB の読み取りを確認しない)
- C. ヘルスチェック専用のパスをアプリに追加する(アプリのコード変更になり、本作業の範囲外)
- X. Other (please specify)

[Answer]: A

## Q2. [開発者] 画面のビルドとアプリの配置をどこで行うか(R-09)

メモリ 1 GB の VM でビルド(Vite、TypeScript)をすると、メモリ不足になるおそれがあります(NFR5)。デプロイは、Workload Identity Federation で認証し、IAP 経由の SSH で行います。

- A. GitHub Actions のランナーで、画面(Vite)とサーバー(TypeScript)の両方をビルドする。サーバーは import が拡張子なしで Node 24 の型除去だけでは動かないため、ランナーで Fastify を含めて 1 つの JS ファイルにまとめる(CI のワークフロー内でバンドルし、アプリのコードと `package.json` は変えない)。成果物(画面の静的ファイルと `server.mjs`)を IAP 経由で VM に転送して配置する。VM には `node_modules` も tsx も TypeScript も入れない。VM の Node.js は 24 以上(`node:sqlite` のため)で、バージョンを固定した公式の配布物を起動スクリプトで入れる。起動時に `node --version` が 24 以上であること、`node -e "require('node:sqlite')"` が成功することを確認し、満たさなければ失敗とする。ランナーも同じバージョンに固定する(NFR7)。(推奨。バンドルが実際に動くかは、ウォーキングスケルトンで確認する)
- B. VM 上で `git pull` して、VM でビルドする(スワップを大きくする必要がある)
- X. Other (please specify)

[Answer]: A(ランナーで画面とサーバーの両方をビルドし、サーバーは Fastify ごと 1 つの JS にまとめる。VM の Node は 24 以上を固定して入れ、起動時に `node:sqlite` の読み込みまで確認する)

## Q3. [運用] スワップ領域の大きさ(NFR5)

通常操作を 10 分間続けても OOM kill が 0 回、という基準を満たすための設定です。スワップは標準永続ディスク(無料枠の 30 GB 以内)に置きます。

- A. 1 GB のスワップを設定する(推奨。ディスクの使用は 1 GB 増える)
- B. 2 GB のスワップを設定する
- C. スワップを設定せず、OOM kill が出たときに増やす
- X. Other (please specify)

[Answer]: A

## Q4. [運用] ログの保持と確認(NFR6)

アプリと Caddy / nginx のログは `journalctl` で見ます。VM のログを Cloud Logging に送ると、料金がかかるおそれがあります(NFR1 の上限 5 ドル)。

- A. ログは VM 内の journald だけに置き、Cloud Logging には送らない。保持は直近 7 日、上限 200 MB とする(推奨。追加料金なし)
- B. Ops エージェントで Cloud Logging にも送る(無料枠の範囲内かを、実施時に確認する)
- X. Other (please specify)

[Answer]: A

## Q5. [運用] 可用性の目標

利用者は自分だけの学習用で、データのバックアップは取りません(NFR3)。どの水準を目標にするかを、数値で決めます。

- A. 数値の SLO は設けない。目標は「異常終了後 30 秒以内の自動再起動(FR2.3)と、デプロイ失敗時の自動ロールバック(FR5.4)」だけとする(推奨)
- B. 月間 99% の可用性を目標にして、毎日 1 回、VM 上のスモークテストで確認する
- X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
