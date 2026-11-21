// scripts/ci-guards.sh(G7〜G10)の検査を、一時ディレクトリの Git リポジトリで確認する。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

const GUARDS = new URL('../ci-guards.sh', import.meta.url).pathname;
const SHA = '0123456789abcdef0123456789abcdef01234567';
const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const CLEAN_CI = `name: ci
on:
  pull_request:
permissions:
  contents: read
jobs:
  app:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
      - run: npm ci
`;

/** 一時の Git リポジトリにファイルを置き、追跡させてから、検査を実行する。 */
function runGuards(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'ci-guards-'));
  roots.push(root);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  return spawnSync('bash', [GUARDS, root], { encoding: 'utf8' });
}

test('正常なリポジトリは違反 0 件で終了コード 0(tfvars の例、コメント内の apply、テストコード中の文字列は許可)', () => {
  const r = runGuards({
    'infra/terraform/terraform.tfvars.example': 'project_id = "your-project-id"\n',
    'package.json': '{ "name": "x" }\n',
    '.github/workflows/ci.yml': CLEAN_CI + '      # terraform apply は置かない(コメントは許可)\n',
    'scripts/test/sample.test.ts': 'const s = \'"type": "service_account"\';\n',
    'docs/design.md': '"type": "service_account" を含む JSON を禁止する\n',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /違反なし/);
});

test('G7: *.tfvars が追跡されていると失敗する', () => {
  const r = runGuards({
    '.github/workflows/ci.yml': CLEAN_CI,
    'infra/terraform/prod.tfvars': 'project_id = "x"\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /G7: .*prod\.tfvars/);
});

test('G8: "type": "service_account" を含む JSON が追跡されていると失敗する', () => {
  const r = runGuards({
    '.github/workflows/ci.yml': CLEAN_CI,
    // 秘密情報に見えるデータは、リポジトリのファイルとして置かず、テストの中で文字列から作る
    'creds/key.json': JSON.stringify({ type: 'service_account', project_id: 'p' }, null, 2) + '\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /G8: .*key\.json/);
});

test('G9: ワークフローの terraform apply を検出する', () => {
  const r = runGuards({
    '.github/workflows/ci.yml': CLEAN_CI,
    '.github/workflows/deploy.yml': CLEAN_CI + '      - run: terraform apply -auto-approve\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /G9: .*deploy\.yml.*terraform apply/);
});

test('G9: ci.yml の google-github-actions/auth と id-token を検出し、deploy.yml では許可する', () => {
  const withAuth =
    CLEAN_CI +
    `      - uses: google-github-actions/auth@${SHA} # v3.0.0\n` +
    '    permissions:\n      id-token: write\n';
  const bad = runGuards({ '.github/workflows/ci.yml': withAuth });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /G9: ci\.yml に認証または id-token/);
  assert.match(bad.stderr, /google-github-actions\/auth/);
  assert.match(bad.stderr, /id-token/);

  const ok = runGuards({ '.github/workflows/ci.yml': CLEAN_CI, '.github/workflows/deploy.yml': withAuth });
  assert.equal(ok.status, 0, ok.stderr);
});

test('G10: SHA で固定されていない uses: とローカルのアクションを検出する', () => {
  const r = runGuards({
    '.github/workflows/ci.yml':
      CLEAN_CI + '      - uses: actions/setup-node@v4\n      - uses: ./local-action\n      - uses: actions/cache@<SHA> # v5\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /G10: .*setup-node@v4/);
  assert.match(r.stderr, /G10: .*\.\/local-action/);
  assert.match(r.stderr, /G10: .*<SHA>/);
  assert.doesNotMatch(r.stderr, /G10: .*checkout@0123/);
});
