// UA(客)のルート。現状は B0 のウォーキングスケルトン用スタブ。B1 が本実装に置き換える。
// スタブの省略事項: 売り切れ判定、詳細なバリデーション、呼出番号の日次リセット。
import type { FastifyPluginAsync } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { CreateOrderRequest } from '../../../contracts/types';
import { tx } from '../db/db';
import { getOrder, listMenuItems } from '../db/queries';
import { nowJst } from '../db/time';

export const customerRoutes: FastifyPluginAsync<{ db: DatabaseSync }> = async (app, { db }) => {
  app.get('/menu', async () => ({ items: listMenuItems(db) }));

  app.post<{ Body: CreateOrderRequest }>('/orders', async (req, reply) => {
    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return reply.code(400).send({ error: 'lines is required' });
    }
    const resolved: { id: number; name: string; price: number; qty: number }[] = [];
    for (const l of lines) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) return reply.code(400).send({ error: 'invalid qty' });
      const item = db.prepare('SELECT id, name, price FROM menu_items WHERE id = ?').get(l.menu_item_id) as
        | { id: number; name: string; price: number }
        | undefined;
      if (!item) return reply.code(400).send({ error: `unknown menu_item_id: ${l.menu_item_id}` });
      resolved.push({ ...item, qty: l.qty });
    }
    const total = resolved.reduce((s, r) => s + r.price * r.qty, 0);

    const orderId = tx(db, () => {
      const next = db.prepare('SELECT COALESCE(MAX(call_number), 0) + 1 AS n FROM orders').get() as { n: number };
      const res = db
        .prepare('INSERT INTO orders (call_number, status, total, created_at) VALUES (?, ?, ?, ?)')
        .run(next.n, 'PLACED', total, nowJst());
      const id = Number(res.lastInsertRowid);
      const insLine = db.prepare(
        'INSERT INTO order_lines (order_id, menu_item_id, name, unit_price, qty) VALUES (?, ?, ?, ?, ?)',
      );
      for (const r of resolved) insLine.run(id, r.id, r.name, r.price, r.qty);
      return id;
    });
    return reply.code(201).send(getOrder(db, orderId));
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (req, reply) => {
    const order = getOrder(db, Number(req.params.id));
    return order ?? reply.code(404).send({ error: 'order not found' });
  });
};
