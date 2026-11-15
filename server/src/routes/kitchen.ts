// UB(厨房)のルート。現状は B0 のスタブ(一覧のみ)。B2 が本実装に置き換える。
// PATCH /kitchen/orders/:id/status は B2 で実装する(transitionOrder 経由。生の UPDATE は書かない)。
import type { FastifyPluginAsync } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { ORDER_STATUSES, type OrderStatus } from '../../../contracts/types';
import { listOrders } from '../db/queries';

export const kitchenRoutes: FastifyPluginAsync<{ db: DatabaseSync }> = async (app, { db }) => {
  app.get<{ Querystring: { status?: string } }>('/kitchen/orders', async (req, reply) => {
    const status = req.query.status;
    if (status !== undefined && !ORDER_STATUSES.includes(status as OrderStatus)) {
      return reply.code(400).send({ error: 'invalid status' });
    }
    return { orders: listOrders(db, status as OrderStatus | undefined) };
  });
};
