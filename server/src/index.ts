import { openDb } from './db/db';
import { seed } from './db/seed';
import { buildApp } from './app';

const db = openDb();
const { n } = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get() as { n: number };
if (n === 0) seed(db); // 開発の利便性: 空 DB なら自動でシード

const app = buildApp({ db, logger: true });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
