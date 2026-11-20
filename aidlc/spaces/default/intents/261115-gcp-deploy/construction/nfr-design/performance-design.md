# 性能・リソース設計: mobile-order の Google Cloud デプロイ

## Sources

- `[Q1]` Caddy、`[Q2]` releases と current のリンク、`[Q3]` esbuild。`nfr-design-questions.md` の人間の回答
- `[memory:M1]` `performance-requirements.md`(NFR5.1〜5.6)と `tech-stack-decisions.md`(NFR5.7〜5.9、NFR7.4)

## 方針

新しい性能目標は作らない(NFR 要件の前提)。メモリ 1 GB の e2-micro で、OOM kill を出さずに動き続けることだけを設計する。

## メモリの予算(目安)

| 利用者 | 目安 | 備考 |
|---|---|---|
| OS(Debian、systemd、journald、sshd) | 約 250 MB | |
| Fastify(Node.js 24) | 約 100 MB | `NODE_OPTIONS=--max-old-space-size=192` で上限を決める |
| Caddy | 約 40 MB | 静的ファイルと転送だけ |
| 空き(ページキャッシュとデプロイ作業) | 残り | デプロイは展開とリンク切り替えだけで、ビルドをしない |
| スワップ | 1 GB | ブートディスク上のファイル。`vm.swappiness=10` |

これは設計上の目安で、実測は NFR5.1 と NFR5.3 の試験で確認する。

## 設計

| 項目 | 設計 | 要件 |
|---|---|---|
| ビルドの場所 | 画面(Vite)とサーバー(esbuild)はランナーでビルドする。VM には `node_modules`、tsx、TypeScript、Vite を入れない | NFR5.3 |
| サーバーの形 | esbuild で Fastify を含めて `server.mjs` 1 つにまとめる(`--platform=node --format=esm`、`node:` は外部扱い)。実行に必要なのは Node.js 本体だけ | NFR5.4 |
| スワップ | 1 GB のスワップファイルを作り、fstab で永続化。`vm.swappiness=10` を `/etc/sysctl.d/` に置く | NFR5.2 |
| 配信 | Caddy が静的ファイルを配信する。`encode gzip` を有効にする。ハッシュ付きのアセットは長いキャッシュ、`index.html` は `no-cache` | NFR5.1 |
| デプロイ中の計測 | `deploy.sh` が、デプロイの開始から完了まで 5 秒おきに `free -m` を記録する。完了後に、スワップ使用量の最大が 512 MB 以下、`available` の最小が 100 MB 以上かを判定する | NFR5.3 |
| スモークテストの時間 | リンク切り替えと再起動の後、60 秒以内に `GET /` と `GET /api/menu` が 200 | NFR5.5 |
| 起動の時間 | VM の再起動から 120 秒以内に `GET /api/menu` が 200(Node.js の導入は起動スクリプトの初回だけで、再起動では行わない) | NFR5.6 |

計測の判定が基準を超えた場合は、アプリが正常なためロールバックはせず、ジョブを失敗として知らせ、スワップの大きさを見直す。

## ウォーキングスケルトンでの確認順序

1. 最初に、ランナーで作った `server.mjs` が `node_modules` なしで起動し、`GET /menu` が 200 を返すことを確認する(NFR5.4、NFR7.4 のリスク)。`logger: true`(pino)と `node:sqlite` を含めて動くこと。
2. 次に、Caddy 経由の `GET /` と `GET /api/menu`。
3. 次に、通常の操作を 10 分間続けて、OOM kill が 0 回であること(NFR5.1)。

## バンドルの確認と代替案(NFR5.4、NFR7.4)

- ESM(`--format=esm`)でのバンドルが動くかは、ウォーキングスケルトンまたはインフラ設計で確認する。「dynamic require of X is not supported」などで動かない場合に試す設定として、`createRequire` を使う banner を足す、pino の transport とワーカーを外部扱いにする、を先に試す。
- それでも動かない場合の**代替案**は、CommonJS 形式の出力(`--format=cjs`、出力は `server.cjs`)にすること。この場合はユニットの `ExecStart` を `server.cjs` に変え、`HOST` などの環境変数と NFR5.4 の合否(`node_modules` なしで起動)は変えない。`node:sqlite` は CommonJS でも `require('node:sqlite')` で読める。
- 代替案に切り替えたら、確認の順序(1. 起動、2. Caddy 経由、3. 10 分間の操作)を最初からやり直す。

## 範囲外

- 応答時間(ミリ秒)の目標、負荷試験、画面の表示性能。

## Assumptions & Open Questions

- `[assumption]` A1: 負荷は、人が手で操作する程度(毎秒数件以下)。
- 未確定: 上のメモリの目安は推定で、実測で見直す。`vm.swappiness` の値(10)はウォーキングスケルトンの実測で調整してよい。
