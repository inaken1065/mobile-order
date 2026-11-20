# Practices Discovery — 質問

初稿（`team-practices.md`）と証拠から決められなかった点だけを聞きます。

## Q1. [開発者] ブランチとマージの進め方
一人で作業していても、`feature/*` ブランチで作業し、PR を作って main に squash マージする進め方でよいですか？（git 履歴は PR 番号付きの squash マージで、トランクベースに見えます）

A. はい。`feature/*` で作業し、PR 経由で main に squash マージする
B. PR は作らず、ローカルで main にマージする
C. 状況に応じて使い分ける
X. Other (please specify)

[Answer]: A

## Q2. [開発者] ブランチ名・コミットメッセージの規約
ブランチ名やコミットメッセージに決まりごとはありますか？

A. 規約なし（今まで通り自由）
B. ブランチは `feature/<名前>`、コミットは Conventional Commits（`feat:` `chore:` など）
C. ブランチは `feature/<名前>`、コミットは自由（日本語可）
X. Other (please specify)

[Answer]: A

## Q3. [開発者] 薄い一周分を先に作るか
最初に、薄くても端から端まで動く最小構成を作って、各部品がつながることを確かめてから機能を足していく進め方（ウォーキングスケルトン）にしますか？ 例：最小の VM と Terraform → CI/CD → IP 制限、の順。

A. はい。最小の VM を先に動かしてから、CI/CD と IP 制限を足す
B. いいえ。全体を設計してからまとめて作る
X. Other (please specify)

[Answer]: A

## Q4. [品質] テストの進め方（方法論）
この作業のテストは、実装の後に書く（test-after）でよいですか？ 過去のアプリ開発は実装後にテストを書く形でした。

A. test-after（実装してからテストを書く）
B. custom（インフラは検証を先に決め、アプリ側は実装後にテスト）
C. tdd（テストを先に書く）
X. Other (please specify)

[Answer]: A

## Q5. [品質] インフラの「検証」とは何か
Terraform にはコード行カバレッジがありません。何をもって検証済みとしますか？（複数可：例 `A, B`）

A. `terraform fmt -check` と `terraform validate`
B. `terraform plan` の内容確認（あなたの承認つき）
C. デプロイ後のスモークテスト（アプリが応答し、許可 IP 以外は拒否されること）
D. 上記の自動化は最小限にし、手動確認のみ
X. Other (please specify)

[Answer]: A

## Q6. [品質] カバレッジの下限と CI
既定の「行カバレッジ 80%」と「マージ前に CI を通す」をどうしますか？

A. アプリのコードには 80% を維持し、インフラには下限を設けない。マージ前に CI 必須
B. 下限は設けない。マージ前に CI は必須
C. 下限も CI 必須も設けない
X. Other (please specify)

[Answer]: A

## Q7. [運用] 環境の数
環境（デプロイ先）はいくつにしますか？ コスト最小の学習用なので 1 台の VM の想定ですが、確認させてください。

A. 本番相当の 1 環境のみ
B. staging と production の 2 環境
X. Other (please specify)

[Answer]: A

## Q8. [運用] デプロイを動かすタイミング
main へのマージ後のデプロイはどうしますか？ なお、課金が発生する操作（`terraform apply` など）は実行前にあなたの承認が必須、という制約はすでに受け取っています。

A. アプリのデプロイはマージ時に自動。`terraform apply` は毎回あなたの承認後に手動で実行
B. アプリも Terraform も、すべてあなたの承認後に実行
X. Other (please specify)

[Answer]: A

## Q9. [開発者] コードスタイルのツール
今は ESLint も Prettier もなく、`tsc` の strict 型チェックだけです。どうしますか？

A. アプリには足さず、Terraform の `terraform fmt` だけ必須にする
B. Prettier / ESLint もアプリに導入する
C. どちらも必須にしない（型チェックのみ）
X. Other (please specify)

[Answer]: B

## Consolidated Summary Confirmation

上の回答を要約して、成果物の生成前に確認します。

- Looks correct
- Request changes

[Answer]: Looks correct
