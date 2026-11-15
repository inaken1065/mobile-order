// UB(厨房)の受入テスト: K1〜K3
// 実行: node --import tsx --test "server/test/kitchen/*.test.ts"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { Order, OrderStatus } from '../../../contracts/types';
import { firstOrderId, freshApp, insertOrderAt, placeOrder } from '../../../contracts/test/helpers';

const list = async (app: FastifyInstance, qs = ''): Promise<Order[]> => {
  const res = await app.inject({ method: 'GET', url: `/kitchen/orders${qs}` });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { orders: Order[] }).orders;
};

const patch = (app: FastifyInstance, id: number | string, payload: unknown, headers?: Record<string, string>) =>
  app.inject({ method: 'PATCH', url: `/kitchen/orders/${id}/status`, payload: payload as object, headers });

const advance = async (app: FastifyInstance, id: number, to: OrderStatus): Promise<Order> => {
  const res = await patch(app, id, { status: to });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Order;
};

function snapshot(db: DatabaseSync) {
  const q = (sql: string) => JSON.stringify(db.prepare(sql).all());
  return {
    menu: q('SELECT * FROM menu_items ORDER BY id'),
    lines: q('SELECT * FROM order_lines ORDER BY id'),
    orderCols: q('SELECT id, call_number, total, created_at FROM orders ORDER BY id'),
  };
}

// ------------------------------------------------------------------ K1 一覧

test('K1: 全件一覧は古い順(created_at, id)で、明細を含む', async () => {
  const { db, app } = freshApp();
  // 時刻を明示して、挿入順と created_at 順が食い違う注文を作る
  const late = insertOrderAt(db, '2026-11-15T20:00:00+09:00', 2, 1);
  const early = insertOrderAt(db, '2026-11-15T09:00:00+09:00', 3, 2);
  const orders = await list(app);

  const ids = orders.map((o) => o.id);
  assert.ok(ids.indexOf(early) < ids.indexOf(late), 'created_at が古い方が先');
  const sorted = [...orders].sort((a, b) =>
    a.created_at === b.created_at ? a.id - b.id : a.created_at < b.created_at ? -1 : 1,
  );
  assert.deepEqual(ids, sorted.map((o) => o.id));
  assert.ok(orders.every((o) => o.lines.length > 0 && o.lines.every((l) => l.name && l.qty > 0)));
});

test('K1: status で絞り込める(PLACED / COOKING / READY)', async () => {
  const { app } = freshApp();
  for (const s of ['PLACED', 'COOKING', 'READY'] as const) {
    const orders = await list(app, `?status=${s}`);
    assert.ok(orders.length > 0, `seed に ${s} がある`);
    assert.ok(orders.every((o) => o.status === s));
  }
  const all = await list(app);
  const sum = (await list(app, '?status=PLACED')).length + (await list(app, '?status=COOKING')).length + (await list(app, '?status=READY')).length;
  assert.equal(sum, all.length);
});

test('K1: 新規注文(UA の POST /orders)が PLACED 一覧に現れ、一覧の再取得で明細も見える', async () => {
  const { app } = freshApp();
  const order = await placeOrder(app, [{ menu_item_id: 8, qty: 1 }]);
  const found = (await list(app, '?status=PLACED')).find((o) => o.id === order.id);
  assert.ok(found);
  assert.deepEqual(found.lines, order.lines);
});

test('K1: 不正な status 指定は 400 で { error } 形式', async () => {
  const { app } = freshApp();
  for (const bad of ['DONE', 'placed', '']) {
    const res = await app.inject({ method: 'GET', url: `/kitchen/orders?status=${bad}` });
    assert.equal(res.statusCode, 400, `status=${bad}`);
    assert.equal(typeof (res.json() as { error: string }).error, 'string');
  }
});

// ------------------------------------------------------------------ K2 / K3 遷移

test('K2/K3: PLACED → COOKING → READY と進められ、completed_at は READY でだけ設定される', async () => {
  const { app } = freshApp();
  const order = await placeOrder(app);
  assert.equal(order.status, 'PLACED');
  assert.equal(order.completed_at, null);

  const cooking = await advance(app, order.id, 'COOKING');
  assert.equal(cooking.status, 'COOKING');
  assert.equal(cooking.completed_at, null, 'COOKING では completed_at は NULL');

  const ready = await advance(app, order.id, 'READY');
  assert.equal(ready.status, 'READY');
  assert.match(ready.completed_at ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/, 'READY で JST の completed_at が入る');

  // 一覧・照会にも反映される
  assert.equal((await list(app, '?status=READY')).some((o) => o.id === order.id), true);
  assert.equal((await list(app, '?status=COOKING')).some((o) => o.id === order.id), false);
  const got = (await app.inject({ method: 'GET', url: `/orders/${order.id}` })).json() as Order;
  assert.equal(got.status, 'READY');
  assert.equal(got.completed_at, ready.completed_at);
});

test('K2/K3: レスポンスは更新後の Order 全体(明細・total は不変)', async () => {
  const { app } = freshApp();
  const order = await placeOrder(app, [{ menu_item_id: 8, qty: 2 }, { menu_item_id: 1, qty: 1 }]);
  const updated = await advance(app, order.id, 'COOKING');
  assert.deepEqual(updated.lines, order.lines);
  assert.equal(updated.total, order.total);
  assert.equal(updated.call_number, order.call_number);
  assert.equal(updated.created_at, order.created_at);
});

test('K3: 逆戻り・飛ばし・同一状態は 409 で、DB は変わらない', async () => {
  const { db, app } = freshApp();
  const order = await placeOrder(app);

  // PLACED からの飛ばし・同一
  for (const to of ['READY', 'PLACED'] as const) {
    const res = await patch(app, order.id, { status: to });
    assert.equal(res.statusCode, 409, `PLACED -> ${to}`);
    assert.match((res.json() as { error: string }).error, /invalid transition/);
  }
  await advance(app, order.id, 'COOKING');
  // COOKING からの逆戻り・同一
  for (const to of ['PLACED', 'COOKING'] as const) {
    assert.equal((await patch(app, order.id, { status: to })).statusCode, 409, `COOKING -> ${to}`);
  }
  const ready = await advance(app, order.id, 'READY');
  // READY からは何にも進めない
  for (const to of ['PLACED', 'COOKING', 'READY'] as const) {
    assert.equal((await patch(app, order.id, { status: to })).statusCode, 409, `READY -> ${to}`);
  }
  const row = db.prepare('SELECT status, completed_at FROM orders WHERE id = ?').get(order.id) as {
    status: string;
    completed_at: string;
  };
  assert.equal(row.status, 'READY');
  assert.equal(row.completed_at, ready.completed_at, '409 の後も completed_at は変わらない');
});

test('K3: シードの READY 注文は変更できない(409)', async () => {
  const { db, app } = freshApp();
  const id = firstOrderId(db, 'READY');
  assert.equal((await patch(app, id, { status: 'COOKING' })).statusCode, 409);
});

// ------------------------------------------------------------------ エラー

test('404: 存在しない注文 / 数値でない id', async () => {
  const { app } = freshApp();
  for (const id of [99999, 'abc', '1.5']) {
    const res = await patch(app, id, { status: 'COOKING' });
    assert.equal(res.statusCode, 404, String(id));
    assert.deepEqual(res.json(), { error: 'order not found' });
  }
});

test('400: status が欠落 / 不正値 / 型違い / ボディなし', async () => {
  const { db, app } = freshApp();
  const order = await placeOrder(app);
  for (const payload of [{}, { status: 'DONE' }, { status: 'cooking' }, { status: 1 }, { status: null }, { stat: 'COOKING' }]) {
    const res = await patch(app, order.id, payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.equal(typeof (res.json() as { error: string }).error, 'string');
  }
  const noBody = await app.inject({ method: 'PATCH', url: `/kitchen/orders/${order.id}/status` });
  assert.equal(noBody.statusCode, 400);
  assert.equal((db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id) as { status: string }).status, 'PLACED');
});

test('400 は存在しない id より先に評価される(不正 status + 存在しない id)', async () => {
  const { app } = freshApp();
  assert.equal((await patch(app, 99999, { status: 'DONE' })).statusCode, 400);
});

test('エラー形式: 壊れた JSON も { error } で返る(Fastify 標準の形ではない)', async () => {
  const { app } = freshApp();
  const res = await app.inject({
    method: 'PATCH',
    url: '/kitchen/orders/1/status',
    headers: { 'content-type': 'application/json' },
    payload: '{bad',
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(typeof body.error, 'string');
});

// ------------------------------------------------------------------ 担当外に触れない

test('UB は menu_items / order_lines / orders の status・completed_at 以外を変更しない', async () => {
  const { db, app } = freshApp();
  const before = snapshot(db);
  const order = await placeOrder(app); // UA の INSERT を挟む
  const afterPlace = snapshot(db);
  await advance(app, order.id, 'COOKING');
  await advance(app, order.id, 'READY');
  await patch(app, order.id, { status: 'COOKING' }); // 409
  const final = snapshot(db);

  // 遷移の前後でメニュー・明細・不変列が同一
  assert.equal(final.menu, afterPlace.menu);
  assert.equal(final.lines, afterPlace.lines);
  assert.equal(final.orderCols, afterPlace.orderCols);
  // 参考: placeOrder 自体は menu_items を変えない
  assert.equal(afterPlace.menu, before.menu);
});

test('売り切れ設定・価格変更の有無に関係なく遷移できる(UB はメニューを見ない)', async () => {
  const { db, app } = freshApp();
  const order = await placeOrder(app, [{ menu_item_id: 8, qty: 1 }]);
  db.prepare('UPDATE menu_items SET is_available = 0 WHERE id = 8').run(); // UC 相当
  db.prepare('DELETE FROM menu_items WHERE id = 8').run();
  assert.equal((await advance(app, order.id, 'COOKING')).status, 'COOKING');
  assert.equal((await advance(app, order.id, 'READY')).status, 'READY');
});
