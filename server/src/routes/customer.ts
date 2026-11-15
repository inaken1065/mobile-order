// UA(客)のルート: メニュー閲覧・注文作成・注文照会。
// 書き込み: orders は INSERT のみ(status は PLACED 固定)、order_lines は INSERT のみ。menu_items には書き込まない。
// 売り切れ判定と INSERT は同一トランザクション(BEGIN IMMEDIATE)で行い、判定後に売り切れへ変わる競合を防ぐ。
import type { FastifyPluginAsync } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { ApiError } from '../../../contracts/api-error';
import { tx } from '../db/db';
import { getOrder, listMenuItems } from '../db/queries';
import { nowJst } from '../db/time';

interface LineInput {
  menu_item_id: number;
  qty: number;
}

/** リクエストボディの検証。不正なら 400。 */
function parseLines(body: unknown): LineInput[] {
  const lines = (body as { lines?: unknown } | null | undefined)?.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new ApiError(400, 'lines must be a non-empty array');
  }
  return lines.map((line, i) => {
    if (typeof line !== 'object' || line === null) throw new ApiError(400, `lines[${i}] must be an object`);
    const { menu_item_id, qty } = line as Record<string, unknown>;
    if (!Number.isInteger(menu_item_id)) throw new ApiError(400, `lines[${i}].menu_item_id must be an integer`);
    if (!Number.isInteger(qty) || (qty as number) < 1) throw new ApiError(400, `lines[${i}].qty must be an integer >= 1`);
    return { menu_item_id: menu_item_id as number, qty: qty as number };
  });
}

export const customerRoutes: FastifyPluginAsync<{ db: DatabaseSync }> = async (app, { db }) => {
  // C1: メニュー一覧(売り切れも is_available: false で返す)
  app.get('/menu', async () => ({ items: listMenuItems(db) }));

  // C2: 注文作成
  app.post('/orders', async (req, reply) => {
    const requested = parseLines(req.body);

    // 同じ商品の複数行は1行にまとめる
    const merged = new Map<number, number>();
    for (const l of requested) merged.set(l.menu_item_id, (merged.get(l.menu_item_id) ?? 0) + l.qty);

    const orderId = tx(db, () => {
      const select = db.prepare('SELECT id, name, price, is_available FROM menu_items WHERE id = ?');
      const resolved = [...merged].map(([id, qty]) => {
        const item = select.get(id) as { id: number; name: string; price: number; is_available: number } | undefined;
        if (!item) throw new ApiError(400, `unknown menu_item_id: ${id}`);
        return { ...item, qty };
      });

      const soldOut = resolved.filter((r) => r.is_available !== 1).map((r) => r.name);
      if (soldOut.length > 0) throw new ApiError(409, `sold out: ${soldOut.join(', ')}`);

      const total = resolved.reduce((sum, r) => sum + r.price * r.qty, 0);
      const createdAt = nowJst();
      // 呼出番号は日次リセット(当日 JST の最大値 + 1)。
      const next = db
        .prepare('SELECT COALESCE(MAX(call_number), 0) + 1 AS n FROM orders WHERE substr(created_at, 1, 10) = ?')
        .get(createdAt.slice(0, 10)) as { n: number };

      const res = db
        .prepare('INSERT INTO orders (call_number, status, total, created_at) VALUES (?, ?, ?, ?)')
        .run(next.n, 'PLACED', total, createdAt);
      const id = Number(res.lastInsertRowid);

      const insLine = db.prepare(
        'INSERT INTO order_lines (order_id, menu_item_id, name, unit_price, qty) VALUES (?, ?, ?, ?, ?)',
      );
      for (const r of resolved) insLine.run(id, r.id, r.name, r.price, r.qty); // 注文時点のスナップショット
      return id;
    });

    return reply.code(201).send(getOrder(db, orderId));
  });

  // C3: 注文照会(ステータスのポーリング先)
  app.get<{ Params: { id: string } }>('/orders/:id', async (req) => {
    const id = Number(req.params.id);
    const order = Number.isInteger(id) ? getOrder(db, id) : undefined;
    if (!order) throw new ApiError(404, 'order not found');
    return order;
  });
};
