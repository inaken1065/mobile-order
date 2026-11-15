// B3(UC 店長)の受入テスト: M1 メニュー管理 / M2 売り切れ / M3 日次売上
// 実行: node --import tsx --test "server/test/manager/*.test.ts"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { DailySales, MenuItem } from '../../../contracts/types';
import { freshApp, insertOrderAt, TODAY, YESTERDAY } from '../../../contracts/test/helpers';
import { transitionOrder } from '../../src/db/transition';
import { todayJst } from '../../src/db/time';

// ---------------------------------------------------------------- helpers

const JST = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;

async function getMenu(app: FastifyInstance): Promise<MenuItem[]> {
  const res = await app.inject({ method: 'GET', url: '/menu' });
  assert.equal(res.statusCode, 200);
  return (res.json() as { items: MenuItem[] }).items;
}

async function sales(app: FastifyInstance, date?: string) {
  const res = await app.inject({ method: 'GET', url: date === undefined ? '/manager/sales/daily' : `/manager/sales/daily?date=${date}` });
  return res;
}

async function salesOf(app: FastifyInstance, date: string): Promise<DailySales> {
  const res = await sales(app, date);
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as DailySales;
}

/** 注文を作って READY まで進める(UA の INSERT 相当 + UB の transitionOrder 相当)。 */
function completedOrder(db: DatabaseSync, menuItemId: number, qty: number, completedAt: string, createdAt = completedAt): number {
  const id = insertOrderAt(db, createdAt, menuItemId, qty);
  transitionOrder(db, id, 'COOKING', completedAt);
  transitionOrder(db, id, 'READY', completedAt);
  return id;
}

function assertErrorShape(body: unknown): void {
  assert.equal(typeof body, 'object');
  assert.deepEqual(Object.keys(body as object), ['error']);
  assert.equal(typeof (body as { error: unknown }).error, 'string');
  assert.ok((body as { error: string }).error.length > 0);
}

const valid = { name: '冷やし中華', category: 'メイン', price: 900 };

// ---------------------------------------------------------------- M1: メニュー追加・編集・価格変更

test('M1: POST /manager/menu は 201 で作成し、GET /menu に反映される(既定は販売中)', async () => {
  const { app, db } = freshApp();
  const before = await getMenu(app);

  const res = await app.inject({ method: 'POST', url: '/manager/menu', payload: valid });
  assert.equal(res.statusCode, 201, res.body);
  const created = res.json() as MenuItem;
  assert.deepEqual(Object.keys(created).sort(), ['category', 'id', 'is_available', 'name', 'price']);
  assert.deepEqual({ ...created, id: 0 }, { id: 0, ...valid, is_available: true });

  const after = await getMenu(app);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.find((i) => i.id === created.id), created);

  const row = db.prepare('SELECT created_at, updated_at FROM menu_items WHERE id = ?').get(created.id) as {
    created_at: string;
    updated_at: string;
  };
  assert.match(row.created_at, JST);
  assert.equal(row.updated_at, row.created_at);
});

test('M1: POST は is_available:false で売り切れ状態の追加ができ、前後の空白は除去される', async () => {
  const { app } = freshApp();
  const res = await app.inject({
    method: 'POST',
    url: '/manager/menu',
    payload: { name: '  限定丼  ', category: ' メイン ', price: 0, is_available: false },
  });
  assert.equal(res.statusCode, 201);
  const item = res.json() as MenuItem;
  assert.equal(item.name, '限定丼');
  assert.equal(item.category, 'メイン');
  assert.equal(item.price, 0);
  assert.equal(item.is_available, false);
});

const invalidInputs: [string, unknown][] = [
  ['name なし', { category: 'メイン', price: 100 }],
  ['name が空', { name: '', category: 'メイン', price: 100 }],
  ['name が空白のみ', { name: '   ', category: 'メイン', price: 100 }],
  ['name が文字列でない', { name: 123, category: 'メイン', price: 100 }],
  ['category なし', { name: 'x', price: 100 }],
  ['category が空', { name: 'x', category: '', price: 100 }],
  ['price なし', { name: 'x', category: 'メイン' }],
  ['price が負', { name: 'x', category: 'メイン', price: -1 }],
  ['price が小数', { name: 'x', category: 'メイン', price: 100.5 }],
  ['price が文字列', { name: 'x', category: 'メイン', price: '100' }],
  ['price が null', { name: 'x', category: 'メイン', price: null }],
  ['is_available が boolean でない', { name: 'x', category: 'メイン', price: 100, is_available: 1 }],
  ['is_available が文字列', { name: 'x', category: 'メイン', price: 100, is_available: 'false' }],
  ['body が配列', [valid]],
  ['body が文字列', JSON.stringify('x')],
];

for (const [label, payload] of invalidInputs) {
  test(`M1: POST は入力不正(${label})を 400 { error } で拒否し、何も作らない`, async () => {
    const { app } = freshApp();
    const before = await getMenu(app);
    const res = await app.inject({
      method: 'POST',
      url: '/manager/menu',
      headers: { 'content-type': 'application/json' },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
    assert.equal(res.statusCode, 400, res.body);
    assertErrorShape(res.json());
    assert.equal((await getMenu(app)).length, before.length);
  });
}

test('M1: POST は body なしでも 400 { error }', async () => {
  const { app } = freshApp();
  const res = await app.inject({ method: 'POST', url: '/manager/menu' });
  assert.equal(res.statusCode, 400);
  assertErrorShape(res.json());
});

test('M1: PUT /manager/menu/{id} は名前・カテゴリ・価格を更新し、GET /menu に反映される', async () => {
  const { app, db } = freshApp();
  const target = (await getMenu(app)).find((i) => i.name === '醤油ラーメン')!;
  const others = (await getMenu(app)).filter((i) => i.id !== target.id);
  const createdAt = (db.prepare('SELECT created_at FROM menu_items WHERE id = ?').get(target.id) as { created_at: string }).created_at;

  const res = await app.inject({
    method: 'PUT',
    url: `/manager/menu/${target.id}`,
    payload: { name: '特製醤油ラーメン', category: '看板メニュー', price: 1000 },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), {
    id: target.id,
    name: '特製醤油ラーメン',
    category: '看板メニュー',
    price: 1000,
    is_available: target.is_available, // 省略時は現在値を維持
  });

  const after = await getMenu(app);
  assert.deepEqual(after.find((i) => i.id === target.id), res.json());
  assert.deepEqual(after.filter((i) => i.id !== target.id), others, '他の商品は変わらない');

  const row = db.prepare('SELECT created_at, updated_at FROM menu_items WHERE id = ?').get(target.id) as {
    created_at: string;
    updated_at: string;
  };
  assert.equal(row.created_at, createdAt, 'created_at は不変');
  assert.match(row.updated_at, JST);
  assert.ok(row.updated_at >= createdAt);
});

test('M1: PUT は price だけの変更(価格変更)ができ、is_available を指定すれば更新される', async () => {
  const { app } = freshApp();
  const item = (await getMenu(app)).find((i) => i.name === 'コーラ')!;
  const base = { name: item.name, category: item.category };

  const r1 = await app.inject({ method: 'PUT', url: `/manager/menu/${item.id}`, payload: { ...base, price: item.price + 50 } });
  assert.equal((r1.json() as MenuItem).price, item.price + 50);
  assert.equal((r1.json() as MenuItem).is_available, true);

  const r2 = await app.inject({ method: 'PUT', url: `/manager/menu/${item.id}`, payload: { ...base, price: item.price, is_available: false } });
  assert.equal((r2.json() as MenuItem).is_available, false);

  // 売り切れ商品を is_available 省略で PUT しても売り切れのまま
  const r3 = await app.inject({ method: 'PUT', url: `/manager/menu/${item.id}`, payload: { ...base, price: 1 } });
  assert.equal((r3.json() as MenuItem).is_available, false);
});

test('M1: PUT は存在しない id・数値でない id で 404 { error }', async () => {
  const { app } = freshApp();
  for (const id of ['99999', 'abc', '0', '-1', '1.5']) {
    const res = await app.inject({ method: 'PUT', url: `/manager/menu/${id}`, payload: valid });
    assert.equal(res.statusCode, 404, `id=${id}`);
    assertErrorShape(res.json());
  }
});

test('M1: PUT は入力不正を 400 { error } で拒否し、元の値を保つ', async () => {
  const { app } = freshApp();
  const item = (await getMenu(app))[0];
  for (const [, payload] of invalidInputs.filter(([, p]) => typeof p !== 'string')) {
    const res = await app.inject({ method: 'PUT', url: `/manager/menu/${item.id}`, payload: payload as object });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assertErrorShape(res.json());
  }
  assert.deepEqual((await getMenu(app)).find((i) => i.id === item.id), item);
});

test('M1: メニューを変更しても、既存注文の order_lines(名前・単価)と売上は変わらない', async () => {
  const { app, db } = freshApp();
  const ramen = (await getMenu(app)).find((i) => i.name === '醤油ラーメン')!;
  const id = completedOrder(db, ramen.id, 2, `${TODAY}T15:00:00+09:00`);
  const lineBefore = db.prepare('SELECT * FROM order_lines WHERE order_id = ?').all(id).map((r) => ({ ...r }));
  const salesBefore = await salesOf(app, TODAY);

  const res = await app.inject({
    method: 'PUT',
    url: `/manager/menu/${ramen.id}`,
    payload: { name: '値上げ後ラーメン', category: ramen.category, price: ramen.price + 300 },
  });
  assert.equal(res.statusCode, 200);

  assert.deepEqual(db.prepare('SELECT * FROM order_lines WHERE order_id = ?').all(id).map((r) => ({ ...r })), lineBefore);
  assert.deepEqual(await salesOf(app, TODAY), salesBefore);
});

// ---------------------------------------------------------------- M2: 売り切れ ON/OFF

test('M2: PATCH availability で売り切れ ON/OFF が GET /menu に即時反映され、他の項目は変わらない', async () => {
  const { app } = freshApp();
  const before = (await getMenu(app)).find((i) => i.name === '唐揚げ')!;
  assert.equal(before.is_available, true);

  const off = await app.inject({ method: 'PATCH', url: `/manager/menu/${before.id}/availability`, payload: { is_available: false } });
  assert.equal(off.statusCode, 200, off.body);
  assert.deepEqual(off.json(), { ...before, is_available: false });
  assert.equal((await getMenu(app)).find((i) => i.id === before.id)!.is_available, false);

  const on = await app.inject({ method: 'PATCH', url: `/manager/menu/${before.id}/availability`, payload: { is_available: true } });
  assert.deepEqual(on.json(), before);
  assert.equal((await getMenu(app)).find((i) => i.id === before.id)!.is_available, true);
});

test('M2: 既に売り切れの商品をシード通り ON に戻せる(杏仁豆腐)', async () => {
  const { app } = freshApp();
  const item = (await getMenu(app)).find((i) => i.name === '杏仁豆腐')!;
  assert.equal(item.is_available, false);
  const res = await app.inject({ method: 'PATCH', url: `/manager/menu/${item.id}/availability`, payload: { is_available: true } });
  assert.equal((res.json() as MenuItem).is_available, true);
});

test('M2: PATCH availability は updated_at を更新するが created_at は変えない', async () => {
  const { app, db } = freshApp();
  const id = (await getMenu(app))[0].id;
  const row = () =>
    db.prepare('SELECT created_at, updated_at FROM menu_items WHERE id = ?').get(id) as { created_at: string; updated_at: string };
  db.prepare("UPDATE menu_items SET updated_at = '2000-01-01T00:00:00+09:00' WHERE id = ?").run(id);
  const created = row().created_at;

  await app.inject({ method: 'PATCH', url: `/manager/menu/${id}/availability`, payload: { is_available: false } });
  assert.equal(row().created_at, created);
  assert.match(row().updated_at, JST);
  assert.ok(row().updated_at > '2000-01-01T00:00:00+09:00');
});

test('M2: PATCH availability は不正な body を 400、存在しない id を 404(いずれも { error })', async () => {
  const { app } = freshApp();
  const id = (await getMenu(app))[0].id;
  for (const payload of [{}, { is_available: 'true' }, { is_available: 1 }, { is_available: null }, { available: true }]) {
    const res = await app.inject({ method: 'PATCH', url: `/manager/menu/${id}/availability`, payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assertErrorShape(res.json());
  }
  const noBody = await app.inject({ method: 'PATCH', url: `/manager/menu/${id}/availability` });
  assert.equal(noBody.statusCode, 400);
  assertErrorShape(noBody.json());

  for (const bad of ['99999', 'abc']) {
    const res = await app.inject({ method: 'PATCH', url: `/manager/menu/${bad}/availability`, payload: { is_available: false } });
    assert.equal(res.statusCode, 404);
    assertErrorShape(res.json());
  }
});

// ---------------------------------------------------------------- M3: 日次売上

test('M3: 売上は READY の注文のみ。シードの今日分と手計算が一致する', async () => {
  const { app, db } = freshApp();
  const s = await salesOf(app, TODAY);

  const expected = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS t FROM orders
       WHERE status = 'READY' AND substr(completed_at, 1, 10) = ?`,
    )
    .get(TODAY) as { n: number; t: number };
  assert.equal(s.date, TODAY);
  assert.equal(s.order_count, expected.n);
  assert.equal(s.total, expected.t);
  assert.ok(s.order_count > 0 && s.total > 0);

  const all = db.prepare('SELECT COALESCE(SUM(total), 0) AS t FROM orders').get() as { t: number };
  assert.ok(s.total < all.t, 'PLACED / COOKING / 昨日分は含まれない');
});

test('M3: 商品別の内訳(数量・金額)は売上合計と整合し、数量の多い順に並ぶ', async () => {
  const { app, db } = freshApp();
  const s = await salesOf(app, TODAY);

  assert.equal(s.items.reduce((a, i) => a + i.amount, 0), s.total);
  const qtys = s.items.map((i) => i.qty);
  assert.deepEqual(qtys, [...qtys].sort((a, b) => b - a));
  assert.equal(new Set(s.items.map((i) => i.menu_item_id)).size, s.items.length, '商品ごとに1行');

  const manual = db
    .prepare(
      `SELECT l.menu_item_id AS id, SUM(l.qty) AS qty FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE o.status = 'READY' AND substr(o.completed_at, 1, 10) = ? GROUP BY l.menu_item_id`,
    )
    .all(TODAY) as unknown as { id: number; qty: number }[];
  for (const m of manual) assert.equal(s.items.find((i) => i.menu_item_id === m.id)!.qty, m.qty);
});

test('M3: PLACED / COOKING の注文は売上に含まれず、READY になった時点で total ちょうど増える', async () => {
  const { app, db } = freshApp();
  const base = await salesOf(app, TODAY);
  const id = insertOrderAt(db, `${TODAY}T14:00:00+09:00`, 8, 3);
  const total = (db.prepare('SELECT total FROM orders WHERE id = ?').get(id) as { total: number }).total;

  assert.deepEqual(await salesOf(app, TODAY), base);
  transitionOrder(db, id, 'COOKING', `${TODAY}T14:05:00+09:00`);
  assert.deepEqual(await salesOf(app, TODAY), base);
  transitionOrder(db, id, 'READY', `${TODAY}T14:15:00+09:00`);

  const after = await salesOf(app, TODAY);
  assert.equal(after.total, base.total + total);
  assert.equal(after.order_count, base.order_count + 1);
  const before8 = base.items.find((i) => i.menu_item_id === 8)?.qty ?? 0;
  assert.equal(after.items.find((i) => i.menu_item_id === 8)!.qty, before8 + 3);
});

test('M3: 日付の基準は completed_at(日またぎの注文は完成日の売上になる)', async () => {
  const { app, db } = freshApp();
  const today0 = await salesOf(app, TODAY);
  const yesterday0 = await salesOf(app, YESTERDAY);

  const id = insertOrderAt(db, `${YESTERDAY}T23:50:00+09:00`, 8, 2);
  const total = (db.prepare('SELECT total FROM orders WHERE id = ?').get(id) as { total: number }).total;
  transitionOrder(db, id, 'COOKING', `${YESTERDAY}T23:55:00+09:00`);
  transitionOrder(db, id, 'READY', `${TODAY}T00:10:00+09:00`);

  assert.equal((await salesOf(app, TODAY)).total, today0.total + total);
  assert.equal((await salesOf(app, YESTERDAY)).total, yesterday0.total);
});

test('M3: 日付の境界(23:59:59 と 00:00:00)が正しく振り分けられる', async () => {
  const { app, db } = freshApp();
  const d1 = '2030-05-31';
  const d2 = '2030-06-01';
  completedOrder(db, 1, 1, `${d1}T23:59:59+09:00`);
  completedOrder(db, 1, 1, `${d2}T00:00:00+09:00`);
  assert.equal((await salesOf(app, d1)).order_count, 1);
  assert.equal((await salesOf(app, d2)).order_count, 1);
});

test('M3: 売上は注文時点のスナップショット価格で集計され、後の価格変更・改名の影響を受けない', async () => {
  const { app, db } = freshApp();
  const d = '2031-01-10';
  const ramen = (await getMenu(app)).find((i) => i.name === '醤油ラーメン')!;
  completedOrder(db, ramen.id, 2, `${d}T12:00:00+09:00`); // 旧価格 ×2
  const oldAmount = ramen.price * 2;

  const put = await app.inject({
    method: 'PUT',
    url: `/manager/menu/${ramen.id}`,
    payload: { name: '新・醤油ラーメン', category: ramen.category, price: ramen.price + 200 },
  });
  assert.equal(put.statusCode, 200);

  const afterChangeOnly = await salesOf(app, d);
  assert.equal(afterChangeOnly.total, oldAmount, '価格変更後も過去の売上は変わらない');
  assert.deepEqual(afterChangeOnly.items, [{ menu_item_id: ramen.id, name: '醤油ラーメン', qty: 2, amount: oldAmount }]);

  // 新価格で1杯売れた同日の売上は、旧価格分 + 新価格分。商品は menu_item_id で1行にまとまり、名前は最新の注文のもの
  completedOrder(db, ramen.id, 1, `${d}T18:00:00+09:00`);
  const s = await salesOf(app, d);
  assert.equal(s.total, oldAmount + ramen.price + 200);
  assert.equal(s.order_count, 2);
  assert.deepEqual(s.items, [{ menu_item_id: ramen.id, name: '新・醤油ラーメン', qty: 3, amount: oldAmount + ramen.price + 200 }]);
});

test('M3: 売上の無い日は 0 件・空の内訳', async () => {
  const { app } = freshApp();
  assert.deepEqual(await salesOf(app, '2000-01-01'), { date: '2000-01-01', order_count: 0, total: 0, items: [] });
});

test('M3: date 省略時は今日(JST)', async () => {
  const { app, db } = freshApp();
  const today = todayJst();
  const base = (await (await sales(app)).json()) as DailySales;
  assert.equal(base.date, today);

  const t = `${today}T12:00:00+09:00`;
  completedOrder(db, 1, 1, t);
  const after = (await (await sales(app)).json()) as DailySales;
  assert.equal(after.order_count, base.order_count + 1);
});

test('M3: date の形式不正・存在しない日付は 400 { error }', async () => {
  const { app } = freshApp();
  for (const d of ['abc', '20261115', '2026-1-5', '2026-13-01', '2026-02-30', '2026-11-15T00:00:00', '']) {
    const res = await sales(app, d);
    assert.equal(res.statusCode, 400, `date=${JSON.stringify(d)}`);
    assertErrorShape(res.json());
  }
});

test('M3: うるう日(2028-02-29)は有効、2027-02-29 は無効', async () => {
  const { app } = freshApp();
  assert.equal((await sales(app, '2028-02-29')).statusCode, 200);
  assert.equal((await sales(app, '2027-02-29')).statusCode, 400);
});

// ---------------------------------------------------------------- 共通: エラー形式・書き込み境界

test('エラー形式: 壊れた JSON など Fastify 自身のエラーも { error } になる', async () => {
  const { app } = freshApp();
  for (const [method, url] of [
    ['POST', '/manager/menu'],
    ['PUT', '/manager/menu/1'],
    ['PATCH', '/manager/menu/1/availability'],
  ] as const) {
    const res = await app.inject({ method, url, headers: { 'content-type': 'application/json' }, payload: '{bad' });
    assert.equal(res.statusCode, 400, `${method} ${url}`);
    assertErrorShape(res.json());
  }
});

test('UC の API は orders / order_lines を一切変更しない', async () => {
  const { app, db } = freshApp();
  const dump = () => ({
    orders: db.prepare('SELECT * FROM orders ORDER BY id').all().map((r) => ({ ...r })),
    lines: db.prepare('SELECT * FROM order_lines ORDER BY id').all().map((r) => ({ ...r })),
  });
  const before = dump();

  const created = (await app.inject({ method: 'POST', url: '/manager/menu', payload: valid })).json() as MenuItem;
  await app.inject({ method: 'PUT', url: `/manager/menu/${created.id}`, payload: { ...valid, price: 1000 } });
  await app.inject({ method: 'PATCH', url: `/manager/menu/${created.id}/availability`, payload: { is_available: false } });
  await app.inject({ method: 'PUT', url: '/manager/menu/1', payload: { ...valid, price: 1 } });
  await app.inject({ method: 'PATCH', url: '/manager/menu/2/availability', payload: { is_available: false } });
  for (const d of [TODAY, YESTERDAY, '2000-01-01']) await sales(app, d);
  await app.inject({ method: 'POST', url: '/manager/menu', payload: { name: '' } }); // 400 でも変更なし

  assert.deepEqual(dump(), before);
});

test('UC の API は DELETE を提供しない(OpenAPI にない)', async () => {
  const { app } = freshApp();
  const res = await app.inject({ method: 'DELETE', url: '/manager/menu/1' });
  assert.equal(res.statusCode, 404);
  assert.equal((await getMenu(app)).some((i) => i.id === 1), true);
});
