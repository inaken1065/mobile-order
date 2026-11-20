# Deployment Pipeline: 質問

デプロイの方式(`current` のリンクの切り替え)、環境の昇格(なし。環境は本番相当の 1 つ)、本番の承認(`main` へのマージで自動。`terraform apply` は毎回手動で承認)、機能フラグ(なし)、ロールバック(失敗時に自動で前の版へ。120 秒以内にスモークテストが合格)は、これまでの回答と `cicd-pipeline.md`、`reliability-design.md` で決まっています。ここでは、まだ決まっていない点だけを聞きます。

## Q1. [パイプライン] サーバーをまとめる esbuild の入れ方

`deploy.yml` の `build` ジョブは、サーバーを esbuild で `server.mjs` にまとめます。esbuild は今の `package.json` の依存に入っていません。

- A. `package.json` の `devDependencies` に版を固定して加え、`package-lock.json` を更新する(推奨。`npm ci` で版と整合性が固定される。アプリのコードは変えない)
- B. `package.json` は変えず、`build` ジョブで版を固定して取得する(`npm install --no-save esbuild@<版>`。ロックファイルの整合性の保護がない)
- X. Other (please specify)

[Answer]: A

## Q2. [パイプライン] デプロイのジョブの GitHub Environment

- A. `production` という Environment を使い、デプロイ用のシークレット(`GCP_*`)をその Environment に置く。承認者は設定しない(`main` へのマージで自動デプロイ、という決定のとおり)(推奨。シークレットが他のジョブから見えない)
- B. Environment を使わず、リポジトリのシークレットに置く
- X. Other (please specify)

[Answer]: A

## Q3. [パイプライン] デプロイを走らせる変更の範囲

- A. `main` への push のうち、`aidlc/`、`aidlc-docs/`、`infra/`、Markdown だけを変えたものは、デプロイしない(`paths-ignore`)(推奨。インフラの変更は手動の `terraform apply` の担当で、設計文書の変更でアプリを入れ替えない)
- B. `main` へのすべての push でデプロイする
- X. Other (please specify)

[Answer]: A(ただし `paths-ignore` はデプロイ(`main` への push)のトリガーにだけ適用し、PR の必須チェックには適用しない。文書だけの PR が必須チェック待ちでマージできなくなるのを避けるため)

## Q4. [パイプライン] 手動での再デプロイ(ロールバックの補助)

- A. `workflow_dispatch` を追加し、リリース ID(コミットの SHA)を入力して、過去のコミットをビルドし直して再デプロイできるようにする(推奨。`main` 上のワークフローからだけ実行でき、WIF の許可条件は変わらない。自動ロールバックが効かなかったときの、IAP に入らない戻し方になる)
- B. 追加しない。手動の戻しは、手順書の IAP 経由の手順だけにする
- X. Other (please specify)

[Answer]: A

## Q5. [パイプライン] デプロイの結果の通知

- A. GitHub の既定のメール通知(失敗時)に加え、ジョブの要約(`$GITHUB_STEP_SUMMARY`)に、リリース ID、スモークテストの出力、ロールバックの有無、`free -m` の判定を出す(推奨。追加のサービスや秘密情報が要らない)
- B. GitHub の既定のメール通知だけにする
- X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct

