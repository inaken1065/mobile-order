// UC(店長)のルート: メニュー管理・売り切れ設定・日次売上。
// 書き込みは menu_items のみ。orders / order_lines は SELECT のみ(書き込み担当表: aidlc-docs/inception/02-units.md)。
// エラー形式は { error: string }。Fastify 自身のエラー(壊れた JSON など)もこの形に揃える(プラグインスコープ)。
import type { FastifyPluginAsync } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { DailySales, MenuItem } from '../../../contracts/types';
import { nowJst, todayJst } from '../db/time';

type MenuRow = Omit<MenuItem, 'is_available'> & { is_available: number };

interface MenuInput {
  name: string;
  category: string;
  price: number;
  is_available?: boolean;
}

type Parsed = { ok: true; value: MenuInput } | { ok: false; error: string };

/** POST/PUT 共通のメニュー入力検証。name / category は前後の空白を除いた非空文字列、price は 0 以上の整数。 */
function parseMenuInput(body: unknown): Parsed {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  for (const key of ['name', 'category'] as const) {
    if (typeof b[key] !== 'string' || (b[key] as string).trim() === '') {
      return { ok: false, error: `${key} is required and must be a non-empty string` };
    }
  }
  if (typeof b.price !== 'number' || !Number.isInteger(b.price) || b.price < 0) {
    return { ok: false, error: 'price must be an integer >= 0' };
  }
  if (b.is_available !== undefined && typeof b.is_available !== 'boolean') {
    return { ok: false, error: 'is_available must be a boolean' };
  }
  return {
    ok: true,
    value: {
      name: (b.name as string).trim(),
      category: (b.category as string).trim(),
      price: b.price,
      is_available: b.is_available as boolean | undefined,
    },
  };
}

/** パスの id を正の整数として解釈する。解釈できなければ undefined(= 存在しない扱いで 404)。 */
function parseId(raw: string): number | undefined {
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : undefined;
}

function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export const managerRoutes: FastifyPluginAsync<{ db: DatabaseSync }> = async (app, { db }) => {
  // このプラグイン(/manager/*)のエラーを { error } 形式にする。500 は詳細を返さない。
  app.setErrorHandler((error, _req, reply) => {
    const err = error as { statusCode?: number; message: string };
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) {
      app.log.error(error);
      return reply.code(500).send({ error: 'internal server error' });
    }
    return reply.code(status).send({ error: err.message });
  });

  const findItem = (id: number): MenuItem | undefined => {
    const row = db
      .prepare('SELECT id, name, category, price, is_available FROM menu_items WHERE id = ?')
      .get(id) as unknown as MenuRow | undefined;
    return row ? { ...row, is_available: row.is_available === 1 } : undefined;
  };

  // M1: メニュー追加(is_available 省略時は販売中)
  app.post<{ Body: unknown }>('/manager/menu', async (req, reply) => {
    const parsed = parseMenuInput(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { name, category, price, is_available } = parsed.value;
    const now = nowJst();
    const res = db
      .prepare(
        'INSERT INTO menu_items (name, category, price, is_available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(name, category, price, is_available === false ? 0 : 1, now, now);
    return reply.code(201).send(findItem(Number(res.lastInsertRowid)));
  });

  // M1: メニュー編集・価格変更(is_available 省略時は現在値を維持)
  app.put<{ Params: { id: string }; Body: unknown }>('/manager/menu/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const current = id === undefined ? undefined : findItem(id);
    if (id === undefined || !current) return reply.code(404).send({ error: 'menu item not found' });

    const parsed = parseMenuInput(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { name, category, price, is_available } = parsed.value;
    const available = is_available === undefined ? current.is_available : is_available;
    db.prepare(
      'UPDATE menu_items SET name = ?, category = ?, price = ?, is_available = ?, updated_at = ? WHERE id = ?',
    ).run(name, category, price, available ? 1 : 0, nowJst(), id);
    return findItem(id);
  });

  // M2: 売り切れ ON/OFF
  app.patch<{ Params: { id: string }; Body: unknown }>('/manager/menu/:id/availability', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === undefined || !findItem(id)) return reply.code(404).send({ error: 'menu item not found' });

    const body = req.body as { is_available?: unknown } | null | undefined;
    if (typeof body !== 'object' || body === null || typeof body.is_available !== 'boolean') {
      return reply.code(400).send({ error: 'is_available must be a boolean' });
    }
    db.prepare('UPDATE menu_items SET is_available = ?, updated_at = ? WHERE id = ?').run(
      body.is_available ? 1 : 0,
      nowJst(),
      id,
    );
    return findItem(id);
  });

  // M3: 日次売上。READY の注文のみ、completed_at の日付(JST・先頭10文字)で集計。SELECT のみ。
  // 金額は注文時点のスナップショット(order_lines.unit_price)で集計する。
  // 商品別は menu_item_id 単位で集約し、name は当日最後に完成した注文の行の名前(改名があっても1行にまとまる)。
  app.get<{ Querystring: { date?: string } }>('/manager/sales/daily', async (req, reply) => {
    const date = req.query.date ?? todayJst();
    if (!isValidDate(date)) return reply.code(400).send({ error: 'date must be a valid YYYY-MM-DD' });

    const sum = db
      .prepare(
        `SELECT COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total
         FROM orders WHERE status = 'READY' AND substr(completed_at, 1, 10) = ?`,
      )
      .get(date) as { order_count: number; total: number };
    const items = db
      .prepare(
        `SELECT l.menu_item_id AS menu_item_id, l.name AS name, SUM(l.qty) AS qty,
                SUM(l.qty * l.unit_price) AS amount, MAX(o.completed_at) AS last_completed
         FROM order_lines l JOIN orders o ON o.id = l.order_id
         WHERE o.status = 'READY' AND substr(o.completed_at, 1, 10) = ?
         GROUP BY l.menu_item_id ORDER BY qty DESC, l.menu_item_id`,
      )
      .all(date) as unknown as (DailySales['items'][number] & { last_completed: string })[];
    const body: DailySales = {
      date,
      order_count: sum.order_count,
      total: sum.total,
      items: items.map(({ menu_item_id, name, qty, amount }) => ({ menu_item_id, name, qty, amount })),
    };
    return body;
  });
};
