// 契約テスト 1: UA ↔ UC の menu_items(UC が書き、UA が読む)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DB_COLUMNS, MENU_ITEM_INTERNAL_COLUMNS, type MenuItem } from '../types';
import { freshApp, freshDb, loadOpenApi, placeOrder } from './helpers';

test('1a: 全テーブルの列名・型・NULL 可否が contracts の DB_COLUMNS と一致する', () => {
  const db = freshDb(false);
  for (const [table, spec] of Object.entries(DB_COLUMNS)) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[];
    assert.deepEqual(info.map((c) => c.name).sort(), Object.keys(spec).sort(), `${table}: columns`);
    for (const col of info) {
      const want = (spec as Record<string, { type: string; notNull: boolean; pk?: true }>)[col.name];
      assert.equal(col.type, want.type, `${table}.${col.name} type`);
      assert.equal(col.pk === 1, want.pk === true, `${table}.${col.name} pk`);
      if (!want.pk) assert.equal(col.notnull === 1, want.notNull, `${table}.${col.name} notnull`);
    }
  }
});

test('1a: OpenAPI の MenuItem のフィールドが menu_items の列(内部列を除く)と一致する', () => {
  const api = loadOpenApi();
  const apiFields = Object.keys(api.components.schemas.MenuItem.properties).sort();
  const dbFields = Object.keys(DB_COLUMNS.menu_items)
    .filter((c) => !(MENU_ITEM_INTERNAL_COLUMNS as readonly string[]).includes(c))
    .sort();
  assert.deepEqual(apiFields, dbFields);
});

test('1b: UC 相当の書き込み(価格変更・売り切れ)が GET /menu に反映される', async () => {
  const { db, app } = freshApp();
  const get = async () => ((await app.inject({ method: 'GET', url: '/menu' })).json() as { items: MenuItem[] }).items;

  const before = (await get()).find((i) => i.id === 1)!;
  assert.equal(before.is_available, true);

  db.prepare('UPDATE menu_items SET price = ?, is_available = 0, updated_at = ? WHERE id = 1').run(
    before.price + 100,
    '2026-11-15T12:00:00+09:00',
  );
  const after = (await get()).find((i) => i.id === 1)!;
  assert.equal(after.price, before.price + 100);
  assert.equal(after.is_available, false);

  // 契約外のフィールドを返さない
  assert.deepEqual(Object.keys(after).sort(), ['category', 'id', 'is_available', 'name', 'price']);
});

test('1c: GET /menu は売り切れも含めて is_available を boolean で返す', async () => {
  const { app } = freshApp();
  const items = ((await app.inject({ method: 'GET', url: '/menu' })).json() as { items: MenuItem[] }).items;
  assert.ok(items.length >= 10);
  assert.ok(items.every((i) => typeof i.is_available === 'boolean'));
  assert.ok(items.some((i) => i.is_available) && items.some((i) => !i.is_available));
  // 注: 売り切れ商品を含む POST /orders が 409 で拒否されることは B1(UA)の受入テスト。B4 で再確認する。
});

test('1d: 注文後にメニュー価格を変えても、既存注文の unit_price / total は変わらない', async () => {
  const { db, app } = freshApp();
  const order = await placeOrder(app, [{ menu_item_id: 8, qty: 2 }]);
  const unit = order.lines[0].unit_price;

  db.prepare('UPDATE menu_items SET price = price + 500, name = ? WHERE id = 8').run('値上げ後の名前');

  const fetched = (await app.inject({ method: 'GET', url: `/orders/${order.id}` })).json() as typeof order;
  assert.equal(fetched.lines[0].unit_price, unit);
  assert.equal(fetched.lines[0].name, order.lines[0].name);
  assert.equal(fetched.total, unit * 2);
});

test('1d: メニュー項目を削除しても既存注文は残る', async () => {
  const { db, app } = freshApp();
  const order = await placeOrder(app, [{ menu_item_id: 5, qty: 1 }]);
  db.prepare('DELETE FROM menu_items WHERE id = 5').run();
  const res = await app.inject({ method: 'GET', url: `/orders/${order.id}` });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as typeof order).lines.length, 1);
});
