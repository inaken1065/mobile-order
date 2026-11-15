// UA(客)の受入テスト: C1〜C3 と受入基準。
// 実行: node --import tsx --test "server/test/customer/*.test.ts"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { MenuItem, Order } from '../../../contracts/types';
import { freshApp, insertOrderAt } from '../../../contracts/test/helpers';
import { transitionOrder } from '../../src/db/transition';
import { nowJst } from '../../src/db/time';

// ---- helpers ----

const idOf = (db: DatabaseSync, name: string): number =>
  (db.prepare('SELECT id FROM menu_items WHERE name = ?').get(name) as { id: number }).id;

const count = (db: DatabaseSync, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

function post(app: FastifyInstance, payload: unknown) {
  return app.inject({ method: 'POST', url: '/orders', payload: payload as object });
}

/** シード無しの DB にテスト用メニューを入れる(日付に依存する呼出番号のテスト用)。 */
function bareApp() {
  const ctx = freshApp(false);
  const ins = ctx.db.prepare(
    'INSERT INTO menu_items (name, category, price, is_available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const now = nowJst();
  ins.run('ラーメン', 'メイン', 800, 1, now, now);
  ins.run('ビール', 'ドリンク', 500, 1, now, now);
  return ctx;
}

const shiftedDay = (days: number) => nowJst(new Date(Date.now() + days * 86400000)).slice(0, 10);

function assertErrorBody(body: unknown) {
  assert.deepEqual(Object.keys(body as object), ['error']);
  assert.equal(typeof (body as { error: unknown }).error, 'string');
}

// ---- C1: メニュー閲覧 ----

test('C1: GET /menu はメニュー全件を契約どおりの形で返す', async () => {
  const { app } = freshApp();
  const res = await app.inject({ method: 'GET', url: '/menu' });
  assert.equal(res.statusCode, 200);
  const { items } = res.json() as { items: MenuItem[] };
  assert.equal(items.length, 12);
  for (const i of items) {
    assert.deepEqual(Object.keys(i).sort(), ['category', 'id', 'is_available', 'name', 'price']);
    assert.equal(typeof i.is_available, 'boolean');
  }
});

test('C1: 売り切れ商品も is_available=false で返る(売り切れ表示用)', async () => {
  const { app, db } = freshApp();
  const items = ((await app.inject({ method: 'GET', url: '/menu' })).json() as { items: MenuItem[] }).items;
  const anzu = items.find((i) => i.name === '杏仁豆腐')!;
  assert.equal(anzu.is_available, false);
  assert.ok(items.some((i) => i.is_available));

  db.prepare('UPDATE menu_items SET is_available = 0 WHERE id = ?').run(idOf(db, 'ウーロン茶'));
  const after = ((await app.inject({ method: 'GET', url: '/menu' })).json() as { items: MenuItem[] }).items;
  assert.equal(after.find((i) => i.name === 'ウーロン茶')!.is_available, false);
});

test('C1: カテゴリごとにまとまって返る(カテゴリ別表示用)', async () => {
  const { app } = freshApp();
  const { items } = (await app.inject({ method: 'GET', url: '/menu' })).json() as { items: MenuItem[] };
  const seen: string[] = [];
  for (const i of items) {
    if (seen[seen.length - 1] !== i.category) {
      assert.ok(!seen.includes(i.category), `カテゴリ ${i.category} が分断されている`);
      seen.push(i.category);
    }
  }
  assert.ok(seen.length >= 3);
});

// ---- C2: 注文 ----

test('C2: 注文すると 201、status=PLACED、completed_at=null、合計と明細が返る', async () => {
  const { app, db } = freshApp();
  const shoyu = idOf(db, '醤油ラーメン');
  const beer = idOf(db, '生ビール');
  const res = await post(app, {
    lines: [
      { menu_item_id: shoyu, qty: 2 },
      { menu_item_id: beer, qty: 1 },
    ],
  });
  assert.equal(res.statusCode, 201, res.body);
  const order = res.json() as Order;
  assert.equal(order.status, 'PLACED');
  assert.equal(order.completed_at, null);
  assert.equal(order.total, 850 * 2 + 550);
  assert.equal(typeof order.call_number, 'number');
  assert.match(order.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.deepEqual(
    order.lines.map((l) => [l.menu_item_id, l.name, l.unit_price, l.qty]),
    [
      [shoyu, '醤油ラーメン', 850, 2],
      [beer, '生ビール', 550, 1],
    ],
  );
  assert.equal(count(db, 'orders'), 11); // シード10件 + 1
});

test('C2: 同じ商品の複数行は1行にまとまる', async () => {
  const { app, db } = freshApp();
  const id = idOf(db, 'コーラ');
  const order = (await post(app, { lines: [{ menu_item_id: id, qty: 1 }, { menu_item_id: id, qty: 2 }] })).json() as Order;
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].qty, 3);
  assert.equal(order.total, 300 * 3);
});

test('C2: 売り切れ商品を含む注文は 409 で、orders / order_lines に何も残らない', async () => {
  const { app, db } = freshApp();
  const beforeOrders = count(db, 'orders');
  const beforeLines = count(db, 'order_lines');

  const only = await post(app, { lines: [{ menu_item_id: idOf(db, '杏仁豆腐'), qty: 1 }] });
  assert.equal(only.statusCode, 409);
  assertErrorBody(only.json());
  assert.match((only.json() as { error: string }).error, /杏仁豆腐/);

  // 売り切れ + 販売中の混在でも全体が拒否される(部分的な注文は作らない)
  const mixed = await post(app, {
    lines: [
      { menu_item_id: idOf(db, '醤油ラーメン'), qty: 1 },
      { menu_item_id: idOf(db, '杏仁豆腐'), qty: 1 },
    ],
  });
  assert.equal(mixed.statusCode, 409);

  assert.equal(count(db, 'orders'), beforeOrders);
  assert.equal(count(db, 'order_lines'), beforeLines);
});

test('C2: 売り切れ状態は注文時点の menu_items で判定される(切替が即反映)', async () => {
  const { app, db } = freshApp();
  const id = idOf(db, '唐揚げ');
  const lines = [{ menu_item_id: id, qty: 1 }];
  assert.equal((await post(app, { lines })).statusCode, 201);

  db.prepare('UPDATE menu_items SET is_available = 0 WHERE id = ?').run(id);
  assert.equal((await post(app, { lines })).statusCode, 409);

  db.prepare('UPDATE menu_items SET is_available = 1 WHERE id = ?').run(id);
  assert.equal((await post(app, { lines })).statusCode, 201);
});

test('C2: 注文時点の価格・名前で確定し、後でメニューを変えても注文は変わらない', async () => {
  const { app, db } = freshApp();
  const id = idOf(db, '味噌ラーメン');
  const order = (await post(app, { lines: [{ menu_item_id: id, qty: 2 }] })).json() as Order;
  assert.equal(order.lines[0].unit_price, 900);

  db.prepare('UPDATE menu_items SET price = 1200, name = ? WHERE id = ?').run('特製味噌ラーメン', id);

  const fetched = (await app.inject({ method: 'GET', url: `/orders/${order.id}` })).json() as Order;
  assert.equal(fetched.lines[0].unit_price, 900);
  assert.equal(fetched.lines[0].name, '味噌ラーメン');
  assert.equal(fetched.total, 1800);

  const next = (await post(app, { lines: [{ menu_item_id: id, qty: 1 }] })).json() as Order;
  assert.equal(next.lines[0].unit_price, 1200); // 新規注文は新価格
});

test('C2: 入力不正は 400 { error } で、何も保存されない', async () => {
  const { app, db } = freshApp();
  const ok = idOf(db, '枝豆');
  const before = count(db, 'orders');
  const bad: [string, unknown][] = [
    ['body なし', undefined],
    ['lines なし', {}],
    ['lines が配列でない', { lines: 'x' }],
    ['lines が空', { lines: [] }],
    ['要素がオブジェクトでない', { lines: [1] }],
    ['qty が 0', { lines: [{ menu_item_id: ok, qty: 0 }] }],
    ['qty が負', { lines: [{ menu_item_id: ok, qty: -1 }] }],
    ['qty が小数', { lines: [{ menu_item_id: ok, qty: 1.5 }] }],
    ['qty が文字列', { lines: [{ menu_item_id: ok, qty: '2' }] }],
    ['qty なし', { lines: [{ menu_item_id: ok }] }],
    ['menu_item_id なし', { lines: [{ qty: 1 }] }],
    ['menu_item_id が文字列', { lines: [{ menu_item_id: 'abc', qty: 1 }] }],
    ['未知の menu_item_id', { lines: [{ menu_item_id: 99999, qty: 1 }] }],
    ['有効 + 未知', { lines: [{ menu_item_id: ok, qty: 1 }, { menu_item_id: 99999, qty: 1 }] }],
  ];
  for (const [label, payload] of bad) {
    const res = await post(app, payload);
    assert.equal(res.statusCode, 400, `${label}: ${res.body}`);
    assertErrorBody(res.json());
  }
  assert.equal(count(db, 'orders'), before);
});

test('C2: 壊れた JSON も 400 で、エラー形式は { error } に揃う', async () => {
  const { app } = freshApp();
  const res = await app.inject({
    method: 'POST',
    url: '/orders',
    headers: { 'content-type': 'application/json' },
    payload: '{bad',
  });
  assert.equal(res.statusCode, 400);
  assertErrorBody(res.json());
});

test('C2: 注文確定が途中で失敗したら orders も残らない(トランザクションの原子性)', async () => {
  const { app, db } = freshApp();
  // order_lines の INSERT を qty=3 のときだけ失敗させる(テスト DB 限定の細工)
  db.exec(
    `CREATE TRIGGER test_fail_on_qty3 BEFORE INSERT ON order_lines WHEN NEW.qty = 3
     BEGIN SELECT RAISE(ABORT, 'boom'); END`,
  );
  const before = { o: count(db, 'orders'), l: count(db, 'order_lines') };
  const res = await post(app, { lines: [{ menu_item_id: idOf(db, '枝豆'), qty: 3 }] });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'internal server error' }); // 内部メッセージ(boom)は漏らさない
  assert.equal(count(db, 'orders'), before.o);
  assert.equal(count(db, 'order_lines'), before.l);

  // 失敗後もトランザクションが残らず、次の注文は通る
  assert.equal((await post(app, { lines: [{ menu_item_id: idOf(db, '枝豆'), qty: 1 }] })).statusCode, 201);
});

test('C2: 呼出番号は日次リセット(前日の番号に関係なく当日 1 から連番)', async () => {
  const { app, db } = bareApp();
  const ramen = idOf(db, 'ラーメン');
  // 昨日の注文(呼出番号 1〜3)があっても、今日の最初は 1
  for (let i = 0; i < 3; i++) insertOrderAt(db, `${shiftedDay(-1)}T12:0${i}:00+09:00`, ramen);

  const numbers: number[] = [];
  for (let i = 0; i < 3; i++) {
    numbers.push(((await post(app, { lines: [{ menu_item_id: ramen, qty: 1 }] })).json() as Order).call_number);
  }
  assert.deepEqual(numbers, [1, 2, 3]);
});

test('C2: 客のルートは menu_items を変更しない', async () => {
  const { app, db } = freshApp();
  const dump = () => JSON.stringify(db.prepare('SELECT * FROM menu_items ORDER BY id').all());
  const before = dump();
  await post(app, { lines: [{ menu_item_id: idOf(db, '餃子(6個)'), qty: 2 }] });
  await post(app, { lines: [{ menu_item_id: idOf(db, '杏仁豆腐'), qty: 1 }] });
  await app.inject({ method: 'GET', url: '/menu' });
  assert.equal(dump(), before);
});

// ---- C3: 状況確認 ----

test('C3: GET /orders/:id で注文が引け、厨房の更新(PLACED→COOKING→READY)が反映される', async () => {
  const { app, db } = freshApp();
  const order = (await post(app, { lines: [{ menu_item_id: idOf(db, '餃子(6個)'), qty: 1 }] })).json() as Order;
  const get = async () => (await app.inject({ method: 'GET', url: `/orders/${order.id}` })).json() as Order;

  assert.deepEqual(await get(), order);

  transitionOrder(db, order.id, 'COOKING');
  const cooking = await get();
  assert.equal(cooking.status, 'COOKING');
  assert.equal(cooking.completed_at, null);

  transitionOrder(db, order.id, 'READY');
  const ready = await get();
  assert.equal(ready.status, 'READY');
  assert.ok(ready.completed_at);
  assert.equal(ready.call_number, order.call_number);
});

test('C3: 存在しない注文・不正な id は 404 { error }', async () => {
  const { app } = freshApp();
  for (const id of ['99999', 'abc', '1.5', '-1']) {
    const res = await app.inject({ method: 'GET', url: `/orders/${id}` });
    assert.equal(res.statusCode, 404, id);
    assertErrorBody(res.json());
  }
});
