import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/src/app';
import { openDb } from '../../server/src/db/db';
import { seed } from '../../server/src/db/seed';
import type { Order, OrderStatus } from '../types';

export const TODAY = '2026-11-15';
export const YESTERDAY = '2026-11-14';

export function freshDb(withSeed = true): DatabaseSync {
  const db = openDb(':memory:');
  if (withSeed) seed(db, { today: TODAY });
  return db;
}

export function freshApp(withSeed = true): { db: DatabaseSync; app: FastifyInstance } {
  const db = freshDb(withSeed);
  return { db, app: buildApp({ db }) };
}

export function loadOpenApi(): any {
  return JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
}

/** UA の入口(POST /orders)で注文を作る。 */
export async function placeOrder(
  app: FastifyInstance,
  lines: { menu_item_id: number; qty: number }[] = [{ menu_item_id: 1, qty: 1 }],
): Promise<Order> {
  const res = await app.inject({ method: 'POST', url: '/orders', payload: { lines } });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as Order;
}

/** created_at を指定して注文を作る(UA の INSERT 相当。日付境界のテスト用)。 */
export function insertOrderAt(db: DatabaseSync, createdAt: string, menuItemId = 1, qty = 1): number {
  const item = db.prepare('SELECT name, price FROM menu_items WHERE id = ?').get(menuItemId) as {
    name: string;
    price: number;
  };
  const next = db.prepare('SELECT COALESCE(MAX(call_number), 0) + 1 AS n FROM orders').get() as { n: number };
  const id = Number(
    db
      .prepare("INSERT INTO orders (call_number, status, total, created_at) VALUES (?, 'PLACED', ?, ?)")
      .run(next.n, item.price * qty, createdAt).lastInsertRowid,
  );
  db.prepare('INSERT INTO order_lines (order_id, menu_item_id, name, unit_price, qty) VALUES (?, ?, ?, ?, ?)').run(
    id,
    menuItemId,
    item.name,
    item.price,
    qty,
  );
  return id;
}

export function firstOrderId(db: DatabaseSync, status: OrderStatus): number {
  const row = db.prepare('SELECT id FROM orders WHERE status = ? ORDER BY id LIMIT 1').get(status) as
    | { id: number }
    | undefined;
  assert.ok(row, `seed has no ${status} order`);
  return row.id;
}

/** DB が契約違反として拒否することを検証する(トリガーは 'contract:'、CHECK は 'constraint')。 */
export function assertRejected(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): void {
  assert.throws(() => db.prepare(sql).run(...params), /contract:|constraint/i, `should be rejected: ${sql}`);
}
