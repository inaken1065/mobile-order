// 契約テスト 2: UA → UB の orders.status(UA が PLACED で作り、UB が読んで進める)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORDER_STATUSES, type Order } from '../types';
import { freshApp, freshDb, loadOpenApi, placeOrder } from './helpers';

test('2a: status の取りうる値が contracts・OpenAPI・DB の CHECK 制約で完全一致する', () => {
  const expected = [...ORDER_STATUSES].sort();

  const api = loadOpenApi();
  assert.deepEqual([...api.components.schemas.OrderStatus.enum].sort(), expected, 'OpenAPI OrderStatus');

  const db = freshDb(false);
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get() as {
    sql: string;
  };
  const m = sql.match(/status\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/i);
  assert.ok(m, 'orders.status の CHECK 制約が見つからない');
  const dbValues = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(dbValues, expected, 'DB CHECK');

  // OpenAPI の Order.status と GET /kitchen/orders の status パラメータも同じ列挙を参照している
  assert.equal(api.components.schemas.Order.properties.status.$ref, '#/components/schemas/OrderStatus');
  assert.equal(
    api.paths['/kitchen/orders'].get.parameters.find((p: any) => p.name === 'status').schema.$ref,
    '#/components/schemas/OrderStatus',
  );
});

test('2b: POST /orders で作った注文は PLACED で、GET /kitchen/orders?status=PLACED に出る', async () => {
  const { app } = freshApp();
  const order = await placeOrder(app, [
    { menu_item_id: 8, qty: 1 },
    { menu_item_id: 2, qty: 2 },
  ]);
  assert.equal(order.status, 'PLACED');
  assert.equal(order.completed_at, null);

  const res = await app.inject({ method: 'GET', url: '/kitchen/orders?status=PLACED' });
  assert.equal(res.statusCode, 200);
  const orders = (res.json() as { orders: Order[] }).orders;
  const found = orders.find((o) => o.id === order.id);
  assert.ok(found, '新規注文が厨房の PLACED 一覧に無い');
  assert.equal(found.status, 'PLACED');
  assert.equal(found.lines.length, 2);
  assert.ok(orders.every((o) => o.status === 'PLACED'));

  // 他の status の一覧には出ない
  for (const s of ['COOKING', 'READY']) {
    const other = (await app.inject({ method: 'GET', url: `/kitchen/orders?status=${s}` })).json() as { orders: Order[] };
    assert.ok(!other.orders.some((o) => o.id === order.id));
  }
});

test('2b: 不正な status 指定は 400', async () => {
  const { app } = freshApp();
  const res = await app.inject({ method: 'GET', url: '/kitchen/orders?status=DONE' });
  assert.equal(res.statusCode, 400);
});

test('2c: 厨房の一覧は古い順(created_at, id)', async () => {
  const { app } = freshApp();
  await placeOrder(app);
  await placeOrder(app);
  const orders = ((await app.inject({ method: 'GET', url: '/kitchen/orders' })).json() as { orders: Order[] }).orders;
  assert.ok(orders.length >= 4);
  const sorted = [...orders].sort((a, b) => (a.created_at === b.created_at ? a.id - b.id : a.created_at < b.created_at ? -1 : 1));
  assert.deepEqual(orders.map((o) => o.id), sorted.map((o) => o.id));

  const placed = ((await app.inject({ method: 'GET', url: '/kitchen/orders?status=PLACED' })).json() as { orders: Order[] }).orders;
  const placedSorted = [...placed].sort((a, b) => (a.created_at === b.created_at ? a.id - b.id : a.created_at < b.created_at ? -1 : 1));
  assert.deepEqual(placed.map((o) => o.id), placedSorted.map((o) => o.id));
});
