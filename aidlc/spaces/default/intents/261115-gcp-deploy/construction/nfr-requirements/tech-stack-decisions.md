# 技術スタックの決定: mobile-order の Google Cloud デプロイ

## Sources

- `[Q1]`〜`[Q5]` `nfr-requirements-questions.md` の回答
- `[memory:M1]` `requirements.md` の FR1〜FR7、NFR1〜NFR7、Constraints
- `[memory:M2]` `technology-stack.md`（既存アプリの技術）

## 決定の一覧

| ID | 項目 | 決定 | 理由 | 代わりの案（採用しない理由） | 出どころ |
|---|---|---|---|---|---|
| NFR7.3 | VM 上のランタイム | Node.js 24 以上（バージョンを固定した公式の配布物、チェックサム検証つき） | `node:sqlite` が必要（NFR7）。Debian の標準パッケージに Node 24 がない | OS の標準パッケージ（バージョンが合わない）、コンテナ（範囲外） | NFR7、`[Q2]` |
| NFR7.4 | サーバーの配布形態 | ランナーで Fastify を含めて 1 つの JS ファイル（`server.mjs`）にまとめる。CI のワークフロー内で行い、アプリのコードと `package.json` は変えない | import が拡張子なしで、Node 24 の型除去だけでは動かない。tsx を VM に入れずに済み、VM に `node_modules` が要らない | VM で tsx を使う（開発用パッケージが VM に必要）、VM でビルドする（1 GB でメモリ不足） | NFR5、`[Q2]` |
| NFR7.6 | アプリのコード変更の例外 | `server/src/index.ts` の待ち受けアドレスを、環境変数 `HOST` で指定できるようにする最小限の変更だけを認める。未指定時は `0.0.0.0` のまま。既存テストは書き換えない | FR4.2 を VM 側で満たすため(人間が例外として承認) | 変更なし(FR4.2 がファイアウォールだけに依存する) | FR4.2、NFR2.12 |
| NFR5.7 | 画面の配布形態 | ランナーで Vite でビルドした静的ファイルを VM に置く。Caddy または nginx が配信する | VM でビルドしない（NFR5.3）。アプリのコードを変えずに配信できる | Fastify に静的配信を足す（アプリの変更で範囲外） | FR4.1、`[Q2]` |
| NFR5.8 | リバースプロキシ | Caddy または nginx（どちらかは、インフラ設計で決める）。`/api` を外して Fastify（localhost:3000）に転送する | 開発時の Vite プロキシと同じ動作（`/api` を取り除く）にする | プロキシなし（Fastify を外に出す。FR4.2 に反する） | FR4.1、FR4.2、`[Q1]` |
| NFR3.7 | プロセス管理 | systemd のユニットで Fastify と、プロキシを動かす。異常終了で再起動する | 追加のソフトが要らない。再起動の基準（30 秒）を満たせる | pm2（追加の依存）、Docker（範囲外） | FR2.3、`[Q5]` |
| NFR6.7 | ログ | journald のみ。Cloud Logging には送らない | 追加料金がない | Ops エージェント（料金と設定が増える） | NFR6、`[Q4]` |
| NFR2.10 | 管理者のアクセス | IAP 経由の SSH（`gcloud compute ssh --tunnel-through-iap`）と OS Login | 22 番をインターネットに開けない。ランナーの IP が固定できない問題を避けられる | 自分の IP から直接 SSH（ランナーが入れない）、ランナーの IP を許可（固定できない） | FR3.6、FR5.2 |
| NFR2.11 | 認証 | GitHub Actions は Workload Identity Federation。サービスアカウントキーは使わない | ALWAYS / NEVER ルール | JSON キー（NEVER ルール） | FR6 |
| NFR4.5 | IaC | Terraform。state は GCS バケット。CI は `fmt -check -recursive` と `init -backend=false` に続く `validate` | ALWAYS ルール。CI が GCS と認証に触れずに検証できる | 手作業の構築（再現性がない） | FR1、NFR4 |
| NFR1.7 | コンピュート | us-central1 の e2-micro 1 台。標準永続ディスク（ブートとデータで 30 GB 以内）。外部 IP はエフェメラル | 無料枠の対象（e2-micro、標準永続ディスク）。外部 IP の料金は未確認の数値で、承認の前に再確認する（NFR1.3） | SSD（無料枠外）、静的 IP（放置による課金リスク） | NFR1 |
| NFR5.9 | メモリ対策 | 1 GB のスワップを標準永続ディスク上に設定する | OOM kill を 0 回にする（NFR5.1） | スワップなし（OOM のおそれ）、2 GB（ディスクの使用が増える） | NFR5、`[Q3]` |
| NFR7.5 | ビルドと実行のバージョン | ランナー、VM、ローカルで Node.js のバージョンを揃える | 「ローカルでは動くが本番では動かない」を防ぐ | 揃えない | NFR7 |

## 既存アプリの技術（変更しない）

TypeScript（strict、ESM）、Fastify、React / Vite、SQLite（`node:sqlite`）、`node:test`（`technology-stack.md`）。アプリのコードは変更しない（`requirements.md` の Constraints）。ただし NFR7.6 の `HOST` 環境変数の対応だけは、人間が認めた例外である。

## 受け入れたリスクと確認が必要な点

- バンドルの動作: ランナーで 1 つの JS にまとめた `server.mjs` が、Node 24 で `node:sqlite` を含めて動くかは、まだ試していない。ウォーキングスケルトンの合格条件に「`node server.mjs` が `node_modules` なしで起動し `GET /menu` が 200」を入れ、最初に確認する。バンドルでは `node:` の組み込みモジュール(`node:sqlite` など)を外部扱いにし、`logger: true`(pino)を含めて動くことも確認する。動かない場合は、動かない場合は、バンドラの設定を見直す（または、`node_modules` を最小限だけ VM に置く案に戻す）。
- バンドルに使う道具（例: esbuild）は、CI のワークフローで使うだけで、アプリの依存関係には加えない。具体的な道具とバージョンは、CI の設計で決める。
- 外部 IPv4 の料金は未確認（NFR1.3）。

## Assumptions & Open Questions

- `[assumption]` A1: Caddy と nginx のどちらでも、`/api` を取り除いて転送でき、静的ファイルを配信できる。
- 未確定: Caddy と nginx のどちらにするか、バンドラの道具の選択、Node.js の具体的なバージョンは、インフラ設計と CI の設計で決める。
