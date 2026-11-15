// 契約テスト 0: 書き込み担当表そのもの
//   (a) DB トリガー  (b) 静的検査  (c) OpenAPI の x-owner
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ALLOWED_WRITES,
  API_READ_DEPENDENCIES,
  FORBIDDEN_EVERYWHERE,
  ORDERS_UPDATE_ONLY_IN,
  TRANSITION_USERS,
  UNIT_PATH_PREFIX,
  type Unit,
  type WriteOp,
} from '../ownership';
import { ORDER_STATUSES, ORDER_TRANSITIONS, type OrderStatus } from '../types';
import { transitionOrder } from '../../server/src/db/transition';
import { assertRejected, firstOrderId, freshApp, freshDb, loadOpenApi, placeOrder } from './helpers';

// ---------------------------------------------------------------- (a) トリガー

test('0a: orders の status / completed_at 以外の列は UPDATE できない', () => {
  const db = freshDb();
  const id = firstOrderId(db, 'PLACED');
  assertRejected(db, 'UPDATE orders SET total = total + 1 WHERE id = ?', id);
  assertRejected(db, 'UPDATE orders SET call_number = 9999 WHERE id = ?', id);
  assertRejected(db, "UPDATE orders SET created_at = '2000-01-01T00:00:00+09:00' WHERE id = ?", id);
  assertRejected(db, 'UPDATE orders SET id = 9999 WHERE id = ?', id);
});

test('0a: orders の INSERT は PLACED かつ completed_at NULL のみ', () => {
  const db = freshDb();
  const ins = 'INSERT INTO orders (call_number, status, total, created_at, completed_at) VALUES (900, ?, 0, ?, ?)';
  assertRejected(db, ins, 'COOKING', 'x', null);
  assertRejected(db, ins, 'READY', 'x', 'y');
  assertRejected(db, ins, 'PLACED', 'x', 'y');
  assertRejected(db, ins, 'DONE', 'x', null); // CHECK 制約
  db.prepare(ins).run('PLACED', 'x', null); // 正当
});

test('0a: orders の DELETE、order_lines の UPDATE/DELETE は不可', () => {
  const db = freshDb();
  const id = firstOrderId(db, 'PLACED');
  assertRejected(db, 'DELETE FROM orders WHERE id = ?', id);
  assertRejected(db, 'UPDATE order_lines SET qty = qty + 1 WHERE order_id = ?', id);
  assertRejected(db, 'UPDATE order_lines SET unit_price = 1 WHERE order_id = ?', id);
  assertRejected(db, 'DELETE FROM order_lines WHERE order_id = ?', id);
});

test('0a: status の全遷移の組合せが ORDER_TRANSITIONS と一致する(生 SQL で検証)', async () => {
  const { db, app } = freshApp();
  const stamp = '2026-11-15T13:00:00+09:00';
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      if (from === to) continue;
      const order = await placeOrder(app);
      if (from !== 'PLACED') transitionOrder(db, order.id, 'COOKING', stamp);
      if (from === 'READY') transitionOrder(db, order.id, 'READY', stamp);
      const sql = 'UPDATE orders SET status = ?, completed_at = ? WHERE id = ?';
      const completedAt = to === 'READY' ? stamp : null; // completed_at 規則は満たした状態で遷移だけを試す
      const allowed = ORDER_TRANSITIONS[from].includes(to);
      if (allowed) {
        db.prepare(sql).run(to, completedAt, order.id);
      } else {
        assertRejected(db, sql, to, completedAt, order.id);
      }
    }
  }
});

test('0a: completed_at は READY への遷移と同時にのみ設定される(DB)', async () => {
  const { db, app } = freshApp();
  const stamp = '2026-11-15T13:00:00+09:00';

  // PLACED の行に completed_at だけ入れる → 拒否
  const placed = await placeOrder(app);
  assertRejected(db, 'UPDATE orders SET completed_at = ? WHERE id = ?', stamp, placed.id);

  // PLACED→COOKING で completed_at を入れる → 拒否
  assertRejected(db, "UPDATE orders SET status = 'COOKING', completed_at = ? WHERE id = ?", stamp, placed.id);

  // COOKING の行に completed_at を入れる → 拒否
  transitionOrder(db, placed.id, 'COOKING', stamp);
  assertRejected(db, 'UPDATE orders SET completed_at = ? WHERE id = ?', stamp, placed.id);

  // COOKING→READY で completed_at が NULL のまま → 拒否
  assertRejected(db, "UPDATE orders SET status = 'READY' WHERE id = ?", placed.id);
  assertRejected(db, "UPDATE orders SET status = 'READY', completed_at = NULL WHERE id = ?", placed.id);

  // COOKING→READY で completed_at を同時に設定 → 通る
  db.prepare("UPDATE orders SET status = 'READY', completed_at = ? WHERE id = ?").run(stamp, placed.id);

  // READY 後は completed_at を変更・消去できない
  assertRejected(db, 'UPDATE orders SET completed_at = ? WHERE id = ?', '2030-01-01T00:00:00+09:00', placed.id);
  assertRejected(db, 'UPDATE orders SET completed_at = NULL WHERE id = ?', placed.id);
});

test('0a: transitionOrder() は COOKING では completed_at を NULL のまま、READY で指定時刻を設定する', async () => {
  const { db, app } = freshApp();
  const order = await placeOrder(app);
  assert.equal(order.completed_at, null);

  const cooking = transitionOrder(db, order.id, 'COOKING', '2026-11-15T13:00:00+09:00');
  assert.equal(cooking.status, 'COOKING');
  assert.equal(cooking.completed_at, null);

  const ready = transitionOrder(db, order.id, 'READY', '2026-11-15T13:10:00+09:00');
  assert.equal(ready.status, 'READY');
  assert.equal(ready.completed_at, '2026-11-15T13:10:00+09:00');

  assert.throws(() => transitionOrder(db, order.id, 'COOKING'), /invalid transition/);
});

test('0a: 全 status で completed_at と status の整合が取れている(シード全件)', () => {
  const db = freshDb();
  const bad = db
    .prepare(
      `SELECT id FROM orders
       WHERE (status = 'READY' AND completed_at IS NULL) OR (status <> 'READY' AND completed_at IS NOT NULL)`,
    )
    .all();
  assert.equal(bad.length, 0);
});

// ---------------------------------------------------------------- (b) 静的検査

const SRC = new URL('../../server/src/', import.meta.url).pathname;

export interface WriteHit {
  op: WriteOp;
  table: string;
}

/** SQL 書き込み文を検出する(コメントは除外。SQL は大文字の INSERT INTO / UPDATE / DELETE FROM 規約)。 */
export function scanWrites(source: string): WriteHit[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const re = /\b(INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_]+)/g;
  const hits: WriteHit[] = [];
  for (const m of code.matchAll(re)) {
    const kw = m[1];
    const op: WriteOp = kw.startsWith('UPDATE') ? 'UPDATE' : kw.startsWith('DELETE') ? 'DELETE' : 'INSERT';
    hits.push({ op, table: m[2] });
  }
  return hits;
}

function classify(rel: string): Unit | 'U0' | 'NONE' {
  for (const [unit, prefix] of Object.entries(UNIT_PATH_PREFIX)) if (rel.startsWith(prefix)) return unit as Unit;
  return rel.startsWith('db/') ? 'U0' : 'NONE';
}

function srcFiles(): { rel: string; source: string }[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ rel: f.split('\\').join('/'), source: readFileSync(join(SRC, f), 'utf8') }));
}

export function violations(files: { rel: string; source: string }[]): string[] {
  const out: string[] = [];
  for (const { rel, source } of files) {
    const unit = classify(rel);
    for (const hit of scanWrites(source)) {
      const label = `${rel}: ${hit.op} ${hit.table}`;
      if (FORBIDDEN_EVERYWHERE.some((f) => f.table === hit.table && f.op === hit.op)) out.push(`${label} (禁止)`);
      else if (hit.table === 'orders' && hit.op === 'UPDATE' && rel !== ORDERS_UPDATE_ONLY_IN)
        out.push(`${label} (UPDATE orders は ${ORDERS_UPDATE_ONLY_IN} のみ)`);
      else if (unit === 'NONE') out.push(`${label} (書き込み不可のファイル)`);
      else if (unit !== 'U0' && !ALLOWED_WRITES[unit].some((a) => a.table === hit.table && a.op === hit.op))
        out.push(`${label} (${unit} の担当外)`);
    }
    if (source.includes('transitionOrder') && !TRANSITION_USERS.some((p) => rel.startsWith(p)))
      out.push(`${rel}: transitionOrder は UB(kitchen)専用`);
  }
  return out;
}

test('0b(静的検査): ルートコードは担当表の範囲でしか書き込まない', () => {
  const files = srcFiles();
  assert.ok(files.some((f) => f.rel === 'routes/customer.ts'), 'scanner must find route files');
  assert.deepEqual(violations(files), []);
});

test('0b(静的検査): 検査器自身が違反を検出できる', () => {
  const bad = (rel: string, source: string) => violations([{ rel, source }]);
  assert.equal(bad('routes/customer.ts', 'db.prepare("UPDATE menu_items SET price = 0")').length, 1);
  assert.equal(bad('routes/customer.ts', 'db.prepare("INSERT INTO orders (a) VALUES (1)")').length, 0);
  assert.equal(bad('routes/manager.ts', 'db.prepare(`INSERT INTO orders (a) VALUES (1)`)').length, 1);
  assert.equal(bad('routes/manager.ts', 'db.prepare("UPDATE menu_items SET price = 0")').length, 0);
  assert.equal(bad('routes/kitchen.ts', 'db.prepare("UPDATE orders SET status = 1")').length, 1);
  assert.equal(bad('routes/kitchen.ts', 'db.prepare("UPDATE menu_items SET price = 0")').length, 1);
  assert.equal(bad('routes/manager.ts', 'transitionOrder(db, 1, "READY")').length, 1);
  assert.equal(bad('routes/kitchen.ts', 'transitionOrder(db, 1, "READY")').length, 0);
  assert.equal(bad('db/seed.ts', 'db.prepare("DELETE FROM order_lines")').length, 1);
  assert.equal(bad('app.ts', 'db.prepare("INSERT INTO menu_items (a) VALUES (1)")').length, 1);
  assert.equal(bad('routes/customer.ts', '// UPDATE menu_items は書かない\n').length, 0); // コメントは対象外
  assert.equal(bad('routes/customer.ts', 'db.prepare("INSERT\\n INTO orders")').length, 0);
});

// ---------------------------------------------------------------- (c) OpenAPI の x-owner

test('0c: OpenAPI の各操作の x-owner がパスの担当ユニットと一致する', () => {
  const api = loadOpenApi();
  const expected = (path: string): Unit =>
    path.startsWith('/kitchen') ? 'UB' : path.startsWith('/manager') ? 'UC' : 'UA';
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  let count = 0;
  for (const [path, item] of Object.entries<any>(api.paths)) {
    for (const m of methods.filter((m) => item[m])) {
      assert.equal(item[m]['x-owner'], expected(path), `${m.toUpperCase()} ${path}`);
      count++;
    }
  }
  assert.ok(count >= 9);
});

test('0 (補助): ORDER_STATUSES 型と遷移表が自己整合している', () => {
  for (const s of ORDER_STATUSES) {
    assert.ok(s in ORDER_TRANSITIONS);
    for (const t of ORDER_TRANSITIONS[s as OrderStatus]) assert.ok(ORDER_STATUSES.includes(t));
  }
});

// ---------------------------------------------------------------- (d) API の読み取り依存

test('0d: ownership.ts の API 読み取り依存と OpenAPI の x-read-by が一致する(双方向)', () => {
  const api = loadOpenApi();
  assert.ok(API_READ_DEPENDENCIES.length >= 1);

  // ownership.ts → OpenAPI
  for (const dep of API_READ_DEPENDENCIES) {
    const op = api.paths[dep.path]?.[dep.method.toLowerCase()];
    assert.ok(op, `${dep.method} ${dep.path} が OpenAPI に無い`);
    assert.equal(op['x-owner'], dep.owner, `${dep.path} の x-owner`);
    assert.ok((op['x-read-by'] ?? []).includes(dep.consumer), `${dep.path} の x-read-by に ${dep.consumer} が無い`);
    assert.notEqual(dep.consumer, dep.owner);
  }

  // OpenAPI → ownership.ts(宣言漏れの検出)
  for (const [path, item] of Object.entries<any>(api.paths)) {
    for (const [method, op] of Object.entries<any>(item)) {
      for (const consumer of op['x-read-by'] ?? []) {
        assert.ok(
          API_READ_DEPENDENCIES.some((d) => d.path === path && d.method === method.toUpperCase() && d.consumer === consumer),
          `${method.toUpperCase()} ${path} の x-read-by(${consumer})が ownership.ts に無い`,
        );
      }
    }
  }
});

test('0d: 読み取り依存の保証(GET /menu は売り切れを含む全件)が守られている', async () => {
  const { db, app } = freshApp();
  const total = (db.prepare('SELECT COUNT(*) AS n FROM menu_items').get() as { n: number }).n;
  const unavailable = (db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE is_available = 0').get() as { n: number }).n;
  assert.ok(unavailable > 0, 'シードに売り切れ商品がある');
  const items = ((await app.inject({ method: 'GET', url: '/menu' })).json() as { items: { is_available: boolean }[] }).items;
  assert.equal(items.length, total, 'GET /menu は全件を返す');
  assert.equal(items.filter((i) => !i.is_available).length, unavailable, '売り切れも含める');
});
