# Technology Stack

| 区分 | 技術 | 版(package.json) |
|------|------|------------------|
| 言語 | TypeScript(strict, ESM) | typescript ^7.0.2 |
| ランタイム | Node.js 24 以上(README) | `node:sqlite`, `node:test` を使用 |
| API | Fastify | ^5.12.8 |
| DB | SQLite(Node 組込み `node:sqlite`) | - |
| UI | React / react-dom | ^19.3.1 |
| ビルド | Vite / @vitejs/plugin-react | ^8.3.8 / ^6.3.0 |
| 実行 | tsx | ^4.23.15 |
| 型 | @types/node, @types/react, @types/react-dom | ^26.6.6 / ^19.3.0 |
| テスト | `node:test` + `node:assert/strict`、Fastify `inject` | - |

パッケージマネージャ: npm(`package-lock.json`)。スクリプト: `dev:server`, `dev:web`, `build:web`, `db:reset`, `typecheck`, `test:contracts`, `test:units`, `test`, `mutation:check`。リンタ/フォーマッタ/CI は未導入(`code-quality-assessment.md`)。
