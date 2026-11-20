# 監視設計: mobile-order の Google Cloud デプロイ

## Sources

- `[memory:M1]` `observability-design.md`(NFR6.1〜6.7)と `reliability-design.md`、`infrastructure-specification.md`
- `operation.md`(フェーズのルール): 新しい部品には、死活の指標とエラー率の指標が 1 つずつ必要

## 方針

NFR 設計の方針のとおり、Cloud Logging、Cloud Monitoring、アラート、ダッシュボード、分散トレースは使わない(追加料金を避ける)。この文書は、VM 上で実際に使うコマンドと、確認の基準だけを定める。

## Metrics & KPIs

| Metric | Source | Threshold | Why it matters |
|---|---|---|---|
| 死活(画面) | VM 上の `GET http://localhost/` | 200 | 画面と Caddy が動いている(NFR6.3) |
| 死活(API) | VM 上の `GET http://localhost/api/menu` | 200 と `{ items }` の JSON | Fastify と DB の読み取りが動いている(NFR6.3) |
| エラー | アプリと Caddy の JSON ログ(下の「Logs & Tracing」のコマンド) | 直近 24 時間の `level` 50 以上(アプリ)と `"error"`(Caddy)の行が取り出せる | エラー率の指標の代わりに、エラー行を数える(NFR6.4)。しきい値は設けない |
| ユニットの状態 | `systemctl is-failed mobile-order caddy` | `active`(失敗していない) | 未マウントや Node の版の失敗を検知する(NFR3.8) |
| マウント | `mountpoint -q /mnt/data` | 終了コード 0 | データディスクが付いている(NFR3.8) |
| ディスク使用率 | `df -h / /mnt/data` | 80% 未満(超えたら手順書に従って確認) | 満杯や読み取り専用を防ぐ(NFR6.5) |
| メモリとスワップ | `free -m`(デプロイ中は 5 秒おきに記録) | スワップ使用量 512 MB 以下、`available` 100 MB 以上 | OOM を防ぐ(NFR5.1、NFR5.3) |
| ジャーナルの容量 | `journalctl --disk-usage` | 200 MB 以下 | ログがディスクを使い切らない(NFR6.2) |
| デプロイの成否 | GitHub Actions のジョブの結果 | 成功 | スモークテストの結果が履歴に残る(NFR6.6) |

## Alerts

| Alert | Condition | Severity | Routes to |
|---|---|---|---|
| なし | アラートは設けない(利用者は自分だけ。追加料金を避ける) | なし | 障害は、画面を開いたとき、またはデプロイのジョブの失敗(GitHub の通知)で気づく |

## SLIs / SLOs

| SLI | SLO target | Measurement window |
|---|---|---|
| 数値の可用性 | 設けない(NFR 要件の `[Q5]`。人間が選んだ判断) | なし |
| 異常終了後の復旧時間 | 30 秒以内の自動再起動(NFR3.1) | `kill -9` の試験のとき |
| デプロイ失敗後のロールバック | ロールバックの開始から 120 秒以内に、スモークテストが合格(NFR3.3) | デプロイのたび |
| 再起動後の応答 | 120 秒以内に `GET /api/menu` が 200(NFR3.2、NFR5.6) | VM の再起動の試験のとき |

## Logs & Tracing

| 項目 | 設計 |
|---|---|
| 集約 | journald のみ。Cloud Logging には送らない(NFR6.7)。保持は 7 日、上限 200 MB、`Storage=persistent`(`/etc/systemd/journald.conf.d/mobile-order.conf`) |
| ログの形式 | アプリ(pino)と Caddy は JSON の 1 行。アプリのコードは変更しない |
| 確認 | `journalctl -u mobile-order -n 50`、`journalctl -u caddy -n 50` |
| エラーの確認 | 標準出力のログは journald では優先度が info になるため、`-p err` には頼らない。`journalctl -u mobile-order -u caddy -o cat --since "24 hours ago" \| jq -R -c 'fromjson? \| select(((.level? \| type) == "number" and .level >= 50) or .level? == "error")'` で JSON の `level` で絞る。JSON でない行は `fromjson?` で読み飛ばす。**ウォーキングスケルトンで、故意のエラーを実際に出して確認する** |
| システムの失敗 | `systemctl is-failed` と `mountpoint -q /mnt/data`(ログの優先度に頼らない) |
| トレース | 設けない(単一の VM と単一のアプリ) |

## ダッシュボード

設けない。確認は上のコマンドと、手順書の「毎回の確認」の一覧で行う。

## Assumptions & Open Questions

- `[assumption]` A1: Caddy の既定のログも JSON の `level` を持つ(`"error"` など)。ウォーキングスケルトンで確認する。
- 未確定: 予算アラート(Cloud Billing)は、要件の範囲外として本設計には含めない。必要なら別の作業で追加する。
