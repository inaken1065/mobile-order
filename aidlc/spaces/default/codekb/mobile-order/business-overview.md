# Business Overview

## ドメインと目的
飲食店向けモバイルオーダー(AI-DLC 学習用サンプル。ユニット分割と Bolt 並列実行の体験が目的。`README.md`)。

## 主要機能(ロール別)
- 客(UA): メニュー閲覧(カテゴリ別・売り切れ表示)、カート、注文確定、呼出番号とステータスのポーリング
- 厨房(UB): 注文一覧(古い順)、ステータスを PLACED → COOKING → READY へ 1 段階ずつ進める
- 店長(UC): メニュー追加・編集・価格変更、売り切れ ON/OFF、日次売上(READY 注文を completed_at の JST 日付で集計)

## ビジネスルール(要点)
- ステータス遷移は隣接のみ(`contracts/types.ts` の `ORDER_TRANSITIONS`)
- 呼出番号は当日 JST 内で MAX+1(日次リセット)
- 売上金額は注文時点のスナップショット(`order_lines.unit_price`)

## 本 intent に関わる背景
既存のバックログ 2 件(Issue #11 `ApiError` の共通化、Issue #12 エラーハンドラの集約)。出典は `aidlc-docs/construction/BOLT-REPORT-U0.1.md`、`aidlc-docs/retrospective.md`。現状のエラー実装の分散は `code-quality-assessment.md` に一元記載。
