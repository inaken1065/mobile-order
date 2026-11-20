# 可観測性要件: mobile-order の Google Cloud デプロイ

## Sources

- `[Q4]` ログは VM 内の journald だけ。直近 7 日・上限 200 MB。Cloud Logging には送らない。`[Q1]` 死活確認のパス。`nfr-requirements-questions.md` の回答
- `[memory:M1]` `requirements.md` の NFR6（運用）、FR5.3（スモークテスト）
- `operation.md`（フェーズのルール）: 新しい部品には、死活の指標とエラー率の指標が 1 つずつ必要

## 方針

監視サービスは使わない。ログは `journalctl` で確認し、死活はスモークテストで確認する。通知（アラート）は設けない（利用者は自分だけ。コストの上限のため。Cloud Logging と Cloud Monitoring に送らない）。

## 要件

| ID | 要件 | 合否の判定 | 出どころ |
|---|---|---|---|
| NFR6.1 | アプリ（Fastify）と Caddy / nginx のログを、VM 上で `journalctl -u <サービス名>` で確認できる。アプリは標準出力と標準エラーに出し、systemd のユニットで journald に集める | `journalctl -u <サービス名> -n 50` で直近のログが出る | NFR6 |
| NFR6.2 | journald のログは、直近 7 日、上限 200 MB とする（`MaxRetentionSec=7day`、`SystemMaxUse=200M` 相当）。Cloud Logging には送らない | 設定ファイルに値がある。`journalctl --disk-usage` が 200 MB 以下 | NFR6、`[Q4]` |
| NFR6.3 | 死活の指標: `GET /` が 200 を返す、かつ `GET /api/menu` が 200 で JSON を返す。デプロイ後のスモークテストと、手動確認で同じ基準を使う | FR5.3 のスモークテストが合格する | NFR6、FR5.3、`[Q1]` |
| NFR6.4 | エラーの指標: `journalctl -u <サービス名> -p err --since "24 hours ago"` で、直近 24 時間のエラー行が取り出せる。件数が 0 でも、コマンドが成功する | コマンドが終了コード 0 で終わる。故意にエラーを出すと、行が見える | NFR6 |
| NFR6.5 | ディスクが満杯・読み取り専用になったときに気づけるよう、`df -h` と `journalctl -p err` で確認する手順を手順書に書く | 手順書に確認の手順がある | NFR6、`requirements.md` の Corner conditions |
| NFR6.6 | デプロイの成否は、GitHub Actions のジョブの結果（成功・失敗）で確認する | ジョブの履歴に、スモークテストの結果が出る | FR5.3 |

## 範囲外

- Cloud Logging、Cloud Monitoring、アラート、ダッシュボード、分散トレース
- ログの長期保管、検索基盤

## Assumptions & Open Questions

- `[assumption]` A1: 障害の気づきは、自分が画面を開いたとき、またはデプロイのジョブの失敗で十分である。
- 未確定: systemd のユニット名、ログの形式（構造化ログにするか）は、後の設計ステージで決める。アプリのコードは変更しないため、ログの形式は既存のままとする。
