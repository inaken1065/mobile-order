import { openDb } from './db/db';
import { seed } from './db/seed';
import { buildApp } from './app';
import { resolveHost } from './host';

const db = openDb();
const { n } = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get() as { n: number };
if (n === 0) seed(db); // 開発の利便性: 空 DB なら自動でシード

const app = buildApp({ db, logger: true });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: resolveHost(process.env.HOST) }); // VM では HOST=127.0.0.1 を指定する
