# 可観測性設計: mobile-order の Google Cloud デプロイ

## Sources

- `[Q1]` Caddy(ログの出力先)。`nfr-design-questions.md` の人間の回答
- `[memory:M1]` `observability-requirements.md`(NFR6.1〜6.6)、`requirements.md` の NFR6、FR5.3
- `operation.md`(フェーズのルール): 新しい部品には、死活の指標とエラー率の指標が 1 つずつ必要

## 方針

監視サービスは使わない。ログは VM 内の journald だけに置き、Cloud Logging と Cloud Monitoring には送らない(追加料金を避ける)。通知(アラート)は設けない。アプリのコードは変更しないため、ログの形式(Fastify の `logger: true` の JSON 1 行)は既存のままとする。

## ログの設計

| 項目 | 設計 | 要件 |
|---|---|---|
| 出力先 | アプリは標準出力と標準エラーに出し、`mobile-order.service` が journald に集める。Caddy は `caddy.service` の標準出力(アクセスログも同じ) | NFR6.1 |
| 確認 | `journalctl -u mobile-order -n 50`、`journalctl -u caddy -n 50` | NFR6.1 |
| 保持 | `/etc/systemd/journald.conf.d/` に `MaxRetentionSec=7day`、`SystemMaxUse=200M`。`journalctl --disk-usage` が 200 MB 以下 | NFR6.2 |
| 永続化 | `Storage=persistent`(再起動後も残す) | NFR6.2 |
| 相関 ID | 設けない(単一の VM と単一のアプリで、追う経路がない) | NFR6.1 |

## 指標(死活とエラー)

| 指標 | 方法 | 合格 | 要件 |
|---|---|---|---|
| 死活 | VM 上の `localhost` に対する `GET /`(Caddy 経由)と `GET /api/menu`(200 と `{ items }` の JSON)。デプロイ後のスモークテストと手動確認で、同じ基準 | 両方 200 | NFR6.3、FR5.3 |
| エラー | アプリと Caddy は標準出力に JSON 1 行で出し、journald では優先度が info になるため、`-p err` には頼らない。`journalctl -u mobile-order -u caddy -o cat --since "24 hours ago" \| jq -R -c 'fromjson? \| select((.level? \| type) == "number" and .level >= 50 or (.level? == "error"))'` のように、JSON の `level`(pino は 50 以上がエラー、Caddy は `"error"`)で絞る。JSON でない行(`Assertion failed` など)は `fromjson?` で読み飛ばし、システムの失敗は `systemctl is-failed` で見る。`jq` は起動スクリプト(LC9)で入れる | コマンドが終了コード 0(件数が 0 でも成功)。故意にエラーを出すと、該当の行が見える。**ウォーキングスケルトンで、故意のエラーを実際に出して確認する** | NFR6.4 |
| ディスク | `df -h` で `/` と `/mnt/data` の使用率を見る。80% 超で確認 | 手順書に手順がある | NFR6.5 |
| デプロイの成否 | GitHub Actions のジョブの結果。スモークテストの結果がジョブの履歴に出る | 履歴に結果が残る | NFR6.6 |

## 気づき方(アラートなし)

- 障害は、自分が画面を開いたとき、またはデプロイのジョブの失敗で気づく。
- データディスクが未マウントのときは、`systemctl is-failed mobile-order` と `mountpoint -q /mnt/data` で気づく(`reliability-design.md` の 2 節)。

## SLI / SLO

数値の SLO は設けない(NFR 要件の `[Q5]`。人間が選んだ判断)。目標は、異常終了後 30 秒以内の自動再起動と、デプロイ失敗時の 120 秒以内の自動ロールバックだけ。

## 範囲外

- Cloud Logging、Cloud Monitoring、アラート、ダッシュボード、分散トレース、ログの長期保管。

## Assumptions & Open Questions

- `[assumption]` A1: 障害の気づきは、画面を開いたときとデプロイのジョブの失敗で十分である。
- 未確定: systemd のユニット名(`mobile-order`、`caddy`)の最終確定は、インフラ設計で行う。
