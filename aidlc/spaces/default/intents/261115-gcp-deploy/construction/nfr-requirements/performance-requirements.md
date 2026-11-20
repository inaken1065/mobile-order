# 性能・リソース要件: mobile-order の Google Cloud デプロイ

## Sources

- `[Q2]` ビルドはランナー、サーバーは 1 つの JS にまとめる。`[Q3]` スワップ 1 GB。`nfr-requirements-questions.md` の回答
- `[memory:M1]` `requirements.md` の NFR5（リソース制約）と FR5.3（スモークテスト）、FR2.3（起動時間）
- `[memory:M2]` `technology-stack.md`（Fastify、Vite、`node:sqlite`）

## 前提

利用者は自分だけの学習用で、スループットや応答時間の目標は要件定義にない。ここでは、1 GB の VM で安定して動くことに関する要件だけを数値にする。新しい性能目標は作らない。

## 要件

| ID | 要件 | 合否の判定 | 出どころ |
|---|---|---|---|
| NFR5.1 | メモリ 1 GB の e2-micro で、リバースプロキシ（Caddy または nginx）と Fastify を同時に動かし、通常の操作（画面表示、注文、状態更新）を 10 分間続けても、OOM kill が 0 回である | `journalctl -k` と `dmesg` に `Out of memory` / `oom-kill` の行がない | NFR5 |
| NFR5.2 | VM に 1 GB のスワップ領域を、標準永続ディスク上に設定する。再起動後も有効である | `swapon --show` が 1 GB を示す。再起動後も同じ | NFR5、`[Q3]` |
| NFR5.3 | 画面とサーバーのビルドは VM で行わない。ランナーでビルドした成果物だけを VM に置く | VM に `node_modules`、`tsx`、`typescript`、`vite` が存在しない。デプロイの開始から完了まで、5 秒おきに `free -m` で記録し、スワップの使用量が 512 MB(1 GB の 50%)を超えない。同じ記録で `available` メモリの最小値が 100 MB 以上である | NFR5、`[Q2]` |
| NFR5.4 | サーバーは Fastify を含む 1 つの JS ファイル（`server.mjs`）として VM で動く。実行に必要なのは Node.js 本体だけである | `node server.mjs` が `node_modules` なしで起動し、`GET /menu` が 200 を返す。この確認を、ウォーキングスケルトンの合格条件に入れ、検証の最初に行う(`node:` の組み込みモジュールは外部扱いにしてバンドルする) | NFR5、`[Q2]` |
| NFR5.5 | デプロイ後 60 秒以内に、スモークテスト（`GET /` と `GET /api/menu` が 200）に合格する | FR5.3 と同じ。60 秒を超えたら不合格 | FR5.3 |
| NFR5.6 | VM の再起動から 120 秒以内に、アプリが応答する | 再起動後 120 秒以内に `GET /api/menu` が 200 を返す | FR2.3 |

## 範囲外

- 応答時間（ミリ秒）やスループットの目標、負荷試験（利用者が自分だけのため）
- 画面の表示性能（Lighthouse など）

## Assumptions & Open Questions

- `[assumption]` A1: 通常の操作の負荷は、人が手で操作する程度（毎秒数件以下）である。この前提を超える負荷は扱わない。
- 未確定: スワップの `swappiness` などの細かい設定は、インフラ設計で決める。
