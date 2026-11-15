// サーバー骨格。全体のエラーハンドラを1つ置き、ルートモジュールを登録する。
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { ApiError } from '../../contracts/api-error';
import { InvalidTransitionError, OrderNotFoundError } from './db/transition';
import { customerRoutes } from './routes/customer';
import { kitchenRoutes } from './routes/kitchen';
import { managerRoutes } from './routes/manager';

/** 全ルート共通のエラーハンドラ。応答は { error: メッセージ } に揃える。500 系は詳細を返さない。 */
export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof OrderNotFoundError) return reply.code(404).send({ error: 'order not found' });
  if (err instanceof InvalidTransitionError) {
    return reply.code(409).send({ error: `invalid transition: ${err.from} -> ${err.to}` });
  }
  const e = err as { statusCode?: unknown; message?: string };
  const status = err instanceof ApiError ? err.status : typeof e.statusCode === 'number' ? e.statusCode : 500;
  if (status >= 400 && status < 500) {
    return reply.code(status).send({ error: e.message ? e.message : 'bad request' });
  }
  req.log.error(err);
  return reply.code(500).send({ error: 'internal server error' });
}

export function buildApp(opts: { db: DatabaseSync; logger?: boolean }): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  app.setErrorHandler(errorHandler); // 子プラグインへ引き継がれる
  app.register(customerRoutes, { db: opts.db }); // UA
  app.register(kitchenRoutes, { db: opts.db }); // UB
  app.register(managerRoutes, { db: opts.db }); // UC
  return app;
}
