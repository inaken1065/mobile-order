# Build Instructions: ApiError の共通化とエラーハンドラの集約

テスト戦略は Minimal です。追加のテスト手順書(integration、performance、security)は作りません。単体テストの手順は、Code Generation の `unit-test-instructions.md`(`code-generation-plan.md` の計画とあわせて)に書いてあります。

## 前提

- Node.js(`node:sqlite` を使うため、新しめの版が必要です)と npm
- 環境変数や設定ファイルは、ビルドとテストには不要です
- 追加のサービスは不要です。サーバーのテストはメモリ上の SQLite を使い、E2E は空きポートと使い捨ての DB でサーバーを起動します

## 依存のインストール

```bash
npm install
```

この変更では、依存を追加していません(`package.json` の変更は `test:web` スクリプトの追加と `test` の実行順だけです)。

## ビルド

```bash
npm run build:web
```

Vite で web を本番用に組み立てます。出力は `web/dist/` で、`.gitignore` で除外されています。`contracts/api-error.ts` を web が import する形でも、組み立てられることの確認になります。

サーバーには組み立ての手順がありません(`tsx` で直接動かします)。型の検査は次のコマンドです。

```bash
npm run typecheck
```

ルートの `tsconfig.json`(`contracts`、`server`、`scripts`、`web/test`)と、`web/tsconfig.json`(`web/src`)の2つを検査します。

## テスト

```bash
npm test
```

contracts、units、web の順に実行します(`test:contracts`、`test:units`、`test:web`)。E2E は `npm test` に含まれないので、別に実行します。

```bash
node --import tsx --test "e2e/*.test.ts"
```

## ビルドの確認

- `npm run build:web` が終了コード 0 で終わり、`web/dist/` に `index.html` と `assets/` ができる
- `npm run typecheck` がエラー0件で終わる
- `npm test` と E2E が、失敗0件で終わる

## よくある問題

| 症状 | 対処 |
|---|---|
| `npm run typecheck` が `web/test` で型エラーを出す | ルートの `tsconfig.json` の型設定(`types: ["node"]`)が、`web/src` の import に合わない場合は、`web/test/` 専用の `tsconfig.json` を作り、`typecheck` にその検査を加える(計画の BR4.5) |
| `npm test` が web のテストを見つけない | `web/test/*.test.ts` に一致する位置にあるか、`test:web` のコマンドを確認する |
| E2E がポートを取れない | 他のサーバーが動いていないか確認する。E2E は空きポートを使うので、通常は発生しない |
| E2E が日付をまたぐ瞬間に不安定になる | JST の 0:00 前後を避けて再実行する(`e2e/README.md` に記載) |
