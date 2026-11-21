# テスト手順: mobile-order の Google Cloud デプロイ(Code Generation)

## テストの基盤

- ランナー: 既存と同じ `node --import tsx --test`(`node:test` と `node:assert/strict`)。新しい依存は、esbuild(ビルド用)以外に加えない。
- 前提: Node.js 24 以上、`npm ci` 済み、`terraform` がインストール済み(`terraform init -backend=false` が provider を取得できること)。`bash`、`tar`、`sha256sum` が使える Linux。
- 手動の準備は不要。Google Cloud と GitHub には接続しない。

## 実行コマンド(この作業の範囲だけに絞ったもの)

実行できることは、計画の Step 2 で確認し、結果を `code-summary.md` に記録する。

| 対象 | コマンド |
|---|---|
| HOST の待ち受け | `node --import tsx --test server/test/app/host-binding.test.ts` |
| CI のガード | `node --import tsx --test scripts/test/ci-guards.test.ts` |
| デプロイスクリプト | `node --import tsx --test infra/test/deploy-script.test.ts` |
| シェルの構文 | `node --import tsx --test infra/test/shell-syntax.test.ts` |
| Terraform の整形 | `terraform -chdir=infra/terraform fmt -check -recursive` |
| Terraform の検証 | `terraform -chdir=infra/terraform init -backend=false -input=false` のあと `terraform -chdir=infra/terraform validate` |

上の 4 つの新規テストをまとめて実行する `package.json` のスクリプトは `npm run test:infra`(計画の Step 10 で追加する。CI の `app` ジョブが実行する)。既存の `npm test` は変更しない。

## 期待する結果

| テスト | 件数 | 合格の条件 |
|---|---|---|
| `host-binding.test.ts` | 3 | 全件合格 |
| `ci-guards.test.ts` | 6 | 全件合格 |
| `deploy-script.test.ts` | 9 | 全件合格 |
| `shell-syntax.test.ts` | 3 | 全件合格 |
| Terraform の `fmt -check`、`validate` | - | 終了コード 0 |
| 既存のテスト(`npm test`) | 既存のまま | 全件合格。変更前後で件数が変わらない |

## カバレッジの目標

- Testing Contract の 80% の行カバレッジの下限と、`team.md` のアプリの 80% は、全体のテストスイートに対して Build and Test が確認する。この作業の個別のコマンドでは判定しない。
- カバレッジの計測ツールが未導入のため、この作業では計測できない。下限を弱めたり、設定でしきい値を下げたりしない。未計測であることを `code-summary.md` に書く。
- Terraform とシェルには、行カバレッジの下限を設けない(`team.md`)。

## モックとスタブの方針

- `deploy-script.test.ts`: `systemctl`、`curl`、`mountpoint`、`free` は、テスト用の一時ディレクトリに置いたスタブを、`PATH` の先頭に置いて差し替える。スタブは、呼び出しを記録するファイルに書き、期待どおりに呼ばれたかを確認する。実際のサービスと `/opt`、`/mnt` には触れない。パスは `MO_TEST_ROOT`(root 以外のときだけ有効)で一時ディレクトリへ向ける。
- `host-binding.test.ts`: 実際のサーバーを子プロセスで起動する。ポートは、空きポートを取得して使う。DB は一時ディレクトリの `DB_PATH`。
- `ci-guards.test.ts`: 一時ディレクトリに `git init` して、ファイルをコミットし、`scripts/ci-guards.sh` を実行する。実際のリポジトリには触れない。

## テストデータの管理

- すべて一時ディレクトリ(`os.tmpdir()` の下)に作り、テストの終了後に削除する。リポジトリには、テスト用の成果物を残さない。
- `tar` の成果物は、テストの中で `tar` コマンドで作る(正常な版、シンボリックリンクを含む版、`..` を含む版)。
- 秘密情報に見えるデータ(`"type": "service_account"` を含む JSON など)は、テストの中で文字列から作り、リポジトリのファイルとしては置かない。

## 実行しないテストと理由

- `gitleaks` と `shellcheck`: この環境にない。`ci.yml` が GitHub 上で実行する。実行したことにしない。
- GitHub 上の CI、WIF と Environment `production` の組み合わせ、実際の VM でのデプロイ、`terraform plan` と `apply`: 認証と課金が必要で、この作業の範囲外。Environment Provisioning とウォーキングスケルトンで確認する。
