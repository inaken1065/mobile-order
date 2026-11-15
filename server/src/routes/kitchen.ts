// UB(厨房)のルート。
//   GET   /kitchen/orders?status=            注文一覧(古い順。status で絞り込み)
//   PATCH /kitchen/orders/:id/status         ステータスを1段階進める
// status / completed_at の更新は共有関数 transitionOrder() 経由のみ。このファイルに生の書き込み SQL は書かない。
// UB は menu_items / order_lines には書き込まない。
import type { FastifyPluginAsync } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { ORDER_STATUSES, type OrderStatus } from '../../../contracts/types';
import { listOrders } from '../db/queries';
import { transitionOrder } from '../db/transition';

function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}

export const kitchenRoutes: FastifyPluginAsync<{ db: DatabaseSync }> = async (app, { db }) => {
  app.get<{ Querystring: { status?: string } }>('/kitchen/orders', async (req, reply) => {
    const status = req.query.status;
    if (status !== undefined && !isOrderStatus(status)) {
      return reply.code(400).send({ error: `invalid status: ${status}` });
    }
    return { orders: listOrders(db, status) };
  });

  app.patch<{ Params: { id: string }; Body: { status?: unknown } | undefined }>(
    '/kitchen/orders/:id/status',
    async (req, reply) => {
      const status = req.body?.status;
      if (!isOrderStatus(status)) {
        return reply.code(400).send({ error: 'status is required and must be one of ' + ORDER_STATUSES.join(', ') });
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(404).send({ error: 'order not found' });

      // OrderNotFoundError(404)・InvalidTransitionError(409)は app.ts の全体ハンドラが変換する。
      return transitionOrder(db, id, status);
    },
  );
};
