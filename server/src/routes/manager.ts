// UC(店長)のルート。現状は B0 のスタブ(売上集計のみ)。B3 が本実装に置き換える。
// 売上は READY の注文だけを completed_at の日付(JST)で集計する。orders には書き込まない。
// メニュー管理(POST/PUT /manager/menu, PATCH .../availability)は B3 で実装する。
import type { FastifyPluginAsync } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { DailySales } from '../../../contracts/types';
import { todayJst } from '../db/time';

export const managerRoutes: FastifyPluginAsync<{ db: DatabaseSync }> = async (app, { db }) => {
  app.get<{ Querystring: { date?: string } }>('/manager/sales/daily', async (req, reply) => {
    const date = req.query.date ?? todayJst();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'invalid date' });

    const sum = db
      .prepare(
        `SELECT COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total
         FROM orders WHERE status = 'READY' AND substr(completed_at, 1, 10) = ?`,
      )
      .get(date) as { order_count: number; total: number };
    const items = db
      .prepare(
        `SELECT l.menu_item_id AS menu_item_id, l.name AS name, SUM(l.qty) AS qty, SUM(l.qty * l.unit_price) AS amount
         FROM order_lines l JOIN orders o ON o.id = l.order_id
         WHERE o.status = 'READY' AND substr(o.completed_at, 1, 10) = ?
         GROUP BY l.menu_item_id, l.name ORDER BY qty DESC, l.menu_item_id`,
      )
      .all(date) as unknown as DailySales['items'];
    const body: DailySales = {
      date,
      order_count: sum.order_count,
      total: sum.total,
      items: items.map((i) => ({ ...i })),
    };
    return body;
  });
};
