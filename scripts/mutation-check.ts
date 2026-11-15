// 契約テストが本当に壊れた実装を検出するかを確認する(B0 完了条件 5)。
// リポジトリを一時ディレクトリにコピーし、1箇所ずつ壊して `npm run test:contracts` が赤になることを確認する。
// 使い方: npm run mutation:check
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface Mutation {
  name: string;
  file: string;
  /** 置換(from が存在しなければエラー)または追記 */
  from?: string;
  to?: string;
  append?: string;
  /** 赤くなるべきテスト名の一部(失敗出力に含まれること) */
  expectFailure: string;
}

const MUTATIONS: Mutation[] = [
  { name: '列名変更 menu_items.price → price_yen', file: 'server/src/db/schema.sql', from: 'price        INTEGER NOT NULL CHECK', to: 'price_yen    INTEGER NOT NULL CHECK', expectFailure: '1a' },
  { name: 'PLACED→READY を許可', file: 'server/src/db/schema.sql', from: "(OLD.status = 'PLACED' AND NEW.status = 'COOKING')", to: "(OLD.status = 'PLACED' AND NEW.status IN ('COOKING', 'READY'))", expectFailure: '0a' },
  { name: 'READY 以外でも completed_at を許可', file: 'server/src/db/schema.sql', from: "OR (NEW.status <> 'READY' AND NEW.completed_at IS NOT NULL)", to: 'OR 0', expectFailure: '0a' },
  { name: 'READY への遷移で completed_at NULL を許可', file: 'server/src/db/schema.sql', from: "WHEN (NEW.status = 'READY' AND NEW.completed_at IS NULL)", to: 'WHEN (0)', expectFailure: '0a' },
  { name: 'READY 後の completed_at 変更を許可', file: 'server/src/db/schema.sql', from: "OR (OLD.status = 'READY' AND NEW.completed_at IS NOT OLD.completed_at)", to: 'OR 0', expectFailure: '0a' },
  { name: 'orders.total の UPDATE を許可', file: 'server/src/db/schema.sql', from: '  OR NEW.total IS NOT OLD.total\n', to: '', expectFailure: '0a' },
  { name: 'order_lines の UPDATE を許可', file: 'server/src/db/schema.sql', from: 'BEFORE UPDATE ON order_lines\nBEGIN', to: 'BEFORE UPDATE ON order_lines\nWHEN 0\nBEGIN', expectFailure: '0a' },
  { name: 'INSERT 時の status 制限を撤廃', file: 'server/src/db/schema.sql', from: "WHEN NEW.status <> 'PLACED' OR NEW.completed_at IS NOT NULL", to: 'WHEN 0', expectFailure: '0a' },
  { name: 'status の CHECK に DONE を追加', file: 'server/src/db/schema.sql', from: "CHECK (status IN ('PLACED', 'COOKING', 'READY'))", to: "CHECK (status IN ('PLACED', 'COOKING', 'READY', 'DONE'))", expectFailure: '2a' },
  { name: 'transitionOrder が COOKING でも completed_at を設定', file: 'server/src/db/transition.ts', from: "to === 'READY' ? now : null", to: 'now', expectFailure: '0a' },
  // 注: status 条件だけを緩める変異(READY → READY,COOKING)は等価変異。completed_at が READY 以外で常に NULL
  // (トリガーで保証)のため日付条件が COOKING を除外し、結果が変わらない。多重防御なので検出対象にしない。
  { name: '売上の集計で status 条件と completed_at を外し created_at で集計', file: 'server/src/routes/manager.ts', from: "WHERE status = 'READY' AND substr(completed_at, 1, 10) = ?", to: 'WHERE substr(created_at, 1, 10) = ?', expectFailure: '3:' },
  { name: '売上の日付基準を created_at にする', file: 'server/src/routes/manager.ts', from: "WHERE status = 'READY' AND substr(completed_at, 1, 10) = ?", to: "WHERE status = 'READY' AND substr(created_at, 1, 10) = ?", expectFailure: '3:' },
  { name: '厨房の一覧を新しい順にする', file: 'server/src/db/queries.ts', from: 'ORDER BY created_at, id', to: 'ORDER BY created_at DESC, id DESC', expectFailure: '2c' },
  { name: 'UA が menu_items を書く', file: 'server/src/routes/customer.ts', append: '\nconst _bad = "UPDATE menu_items SET price = 0";\n', expectFailure: '0b' },
  { name: 'UC が orders に書く', file: 'server/src/routes/manager.ts', append: '\nconst _bad = "INSERT INTO orders (a) VALUES (1)";\n', expectFailure: '0b' },
  { name: 'UB が生の UPDATE orders を書く', file: 'server/src/routes/kitchen.ts', append: '\nconst _bad = "UPDATE orders SET status = 1";\n', expectFailure: '0b' },
  { name: 'UC が transitionOrder を使う', file: 'server/src/routes/manager.ts', append: "\nimport { transitionOrder } from '../db/transition';\nvoid transitionOrder;\n", expectFailure: '0b' },
  { name: 'OpenAPI の x-owner が不一致', file: 'contracts/openapi.json', from: '"x-owner": "UB",\n        "summary": "注文一覧', to: '"x-owner": "UA",\n        "summary": "注文一覧', expectFailure: '0c' },
  { name: 'OpenAPI から x-read-by を削除(読み取り依存の宣言漏れ)', file: 'contracts/openapi.json', from: '"x-read-by": ["UC"],\n', to: '', expectFailure: '0d' },
  { name: 'OpenAPI に未宣言の x-read-by を追加', file: 'contracts/openapi.json', from: '"x-owner": "UB",\n        "summary": "注文一覧', to: '"x-owner": "UB",\n        "x-read-by": ["UC"],\n        "summary": "注文一覧', expectFailure: '0d' },
  { name: 'GET /menu が売り切れを除外する(UC の依存を壊す)', file: 'server/src/db/queries.ts', from: "FROM menu_items ORDER BY category, id", to: "FROM menu_items WHERE is_available = 1 ORDER BY category, id", expectFailure: '0d' },
  { name: 'OpenAPI の OrderStatus に値を追加', file: 'contracts/openapi.json', from: '"enum": ["PLACED", "COOKING", "READY"]', to: '"enum": ["PLACED", "COOKING", "READY", "DONE"]', expectFailure: '2a' },
];

const root = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'mutation-'));

function fresh(): string {
  const dir = join(work, 'repo');
  rmSync(dir, { recursive: true, force: true });
  cpSync(root, dir, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|data|dist|\.git)([\\/]|$)/.test(src.slice(root.length)),
  });
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

function runTests(dir: string): { ok: boolean; output: string } {
  const r = spawnSync('npm', ['run', 'test:contracts'], { cwd: dir, encoding: 'utf8' });
  return { ok: r.status === 0, output: (r.stdout ?? '') + (r.stderr ?? '') };
}

let survived = 0;
const baseline = runTests(fresh());
if (!baseline.ok) {
  console.error('ベースライン(無改造)で契約テストが失敗しています。先にそちらを直してください。');
  console.error(baseline.output);
  process.exit(2);
}
console.log('baseline: 緑');

for (const m of MUTATIONS) {
  const dir = fresh();
  const path = join(dir, m.file);
  const src = readFileSync(path, 'utf8');
  if (m.append !== undefined) {
    writeFileSync(path, src + m.append);
  } else {
    if (!src.includes(m.from!)) throw new Error(`mutation target not found: ${m.name} (${m.file})`);
    writeFileSync(path, src.replace(m.from!, m.to!));
  }
  const r = runTests(dir);
  const failedLines = r.output.split('\n').filter((l) => /^\s*✖/.test(l));
  const caught = !r.ok;
  const hit = failedLines.some((l) => l.includes(`${m.expectFailure}`));
  if (!caught) survived++;
  console.log(`${caught ? (hit ? '赤 ✔' : '赤(想定外のテスト)') : '緑 ✘ 検出できていない'}  [${m.expectFailure}] ${m.name}`);
  if (caught && !hit) console.log('    失敗: ' + failedLines.slice(0, 3).join(' | '));
}

rmSync(work, { recursive: true, force: true });
if (survived > 0) {
  console.error(`\n${survived} 件の変異を契約テストが検出できませんでした`);
  process.exit(1);
}
console.log(`\n全 ${MUTATIONS.length} 変異を契約テストが検出しました`);
