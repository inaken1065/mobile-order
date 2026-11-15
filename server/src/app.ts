// U0: サーバー骨格。ルートモジュールを登録するだけ(中身は各ユニット)。Wave 1 中は読み取り専用。
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { customerRoutes } from './routes/customer';
import { kitchenRoutes } from './routes/kitchen';
import { managerRoutes } from './routes/manager';

export function buildApp(opts: { db: DatabaseSync; logger?: boolean }): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  app.register(customerRoutes, { db: opts.db }); // UA
  app.register(kitchenRoutes, { db: opts.db }); // UB
  app.register(managerRoutes, { db: opts.db }); // UC
  return app;
}
