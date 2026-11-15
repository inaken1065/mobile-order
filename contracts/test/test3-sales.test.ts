// 契約テスト 3: UB → UC の売上(UB が READY にし、UC が READY のみを集計する)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DailySales } from '../types';
import { transitionOrder } from '../../server/src/db/transition';
import { freshApp, insertOrderAt, placeOrder, TODAY, YESTERDAY } from './helpers';
import type { FastifyInstance } from 'fastify';

async function sales(app: FastifyInstance, date: string): Promise<DailySales> {
  const res = await app.inject({ method: 'GET', url: `/manager/sales/daily?date=${date}` });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as DailySales;
}

test('3: シードの売上は READY のみ(PLACED / COOKING を含まない)', async () => {
  const { db, app } = freshApp();
  const s = await sales(app, TODAY);

  const expected = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS t FROM orders
       WHERE status = 'READY' AND substr(completed_at, 1, 10) = ?`,
    )
    .get(TODAY) as { n: number; t: number };
  assert.equal(s.order_count, expected.n);
  assert.equal(s.total, expected.t);
  assert.ok(expected.n > 0, 'シードに今日の READY 注文がある');

  const notReady = db.prepare("SELECT COALESCE(SUM(total), 0) AS t FROM orders WHERE status <> 'READY'").get() as { t: number };
  assert.ok(notReady.t > 0, 'シードに未完成の注文がある');
  const all = db.prepare('SELECT COALESCE(SUM(total), 0) AS t FROM orders').get() as { t: number };
  assert.ok(s.total < all.t);

  // 商品別の内訳の合計 = 売上合計
  assert.equal(s.items.reduce((a, i) => a + i.amount, 0), s.total);
});

test('3: READY になった瞬間にだけ、その注文の total ちょうど売上が増える', async () => {
  const { db, app } = freshApp();
  const base = await sales(app, TODAY);

  const order = await placeOrder(app, [
    { menu_item_id: 8, qty: 2 },
    { menu_item_id: 1, qty: 1 },
  ]);
  assert.ok(order.total > 0);

  assert.deepEqual(await sales(app, TODAY), base, 'PLACED では増えない');

  transitionOrder(db, order.id, 'COOKING', `${TODAY}T14:00:00+09:00`);
  assert.deepEqual(await sales(app, TODAY), base, 'COOKING では増えない');

  transitionOrder(db, order.id, 'READY', `${TODAY}T14:10:00+09:00`);
  const after = await sales(app, TODAY);
  assert.equal(after.total, base.total + order.total);
  assert.equal(after.order_count, base.order_count + 1);

  const item8Before = base.items.find((i) => i.menu_item_id === 8)?.qty ?? 0;
  assert.equal(after.items.find((i) => i.menu_item_id === 8)!.qty, item8Before + 2);
});

test('3: 日次集計は completed_at の日付で行う(created_at ではない)', async () => {
  const { db, app } = freshApp();
  const todayBase = await sales(app, TODAY);
  const yesterdayBase = await sales(app, YESTERDAY);

  // 昨日 23:50 に作って、今日 00:10 に完成 → 今日の売上(created_at を明示して実行日に依存させない)
  const id = insertOrderAt(db, `${YESTERDAY}T23:50:00+09:00`, 8, 2);
  const total = (db.prepare('SELECT total FROM orders WHERE id = ?').get(id) as { total: number }).total;
  transitionOrder(db, id, 'COOKING', `${YESTERDAY}T23:55:00+09:00`);
  transitionOrder(db, id, 'READY', `${TODAY}T00:10:00+09:00`);

  assert.equal((await sales(app, TODAY)).total, todayBase.total + total);
  assert.equal((await sales(app, YESTERDAY)).total, yesterdayBase.total);
});

test('3: 売上の対象日に注文が無ければ 0 件', async () => {
  const { app } = freshApp();
  const s = await sales(app, '2000-01-01');
  assert.deepEqual(s, { date: '2000-01-01', order_count: 0, total: 0, items: [] });
});
