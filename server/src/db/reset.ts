// DB を作り直してシードを入れる: npm run db:reset
import { rmSync } from 'node:fs';
import { openDb } from './db';
import { seed } from './seed';

const path = process.env.DB_PATH ?? 'data/app.db';
for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
const db = openDb(path);
seed(db);
db.close();
console.log(`reset and seeded: ${path}`);
