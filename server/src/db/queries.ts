// 読み取り専用の共有クエリ(U0)。書き込みは含めない。
import type { DatabaseSync } from 'node:sqlite';
import type { MenuItem, Order, OrderLine, OrderStatus } from '../../../contracts/types';

type OrderRow = Omit<Order, 'lines'>;

export function listMenuItems(db: DatabaseSync): MenuItem[] {
  const rows = db
    .prepare('SELECT id, name, category, price, is_available FROM menu_items ORDER BY category, id')
    .all() as unknown as (Omit<MenuItem, 'is_available'> & { is_available: number })[];
  return rows.map((r) => ({ ...r, is_available: r.is_available === 1 }));
}

function withLines(db: DatabaseSync, row: OrderRow): Order {
  const lines = db
    .prepare('SELECT menu_item_id, name, unit_price, qty FROM order_lines WHERE order_id = ? ORDER BY id')
    .all(row.id) as unknown as OrderLine[];
  return { ...row, lines: lines.map((l) => ({ ...l })) };
}

export function getOrder(db: DatabaseSync, id: number): Order | undefined {
  const row = db
    .prepare('SELECT id, call_number, status, total, created_at, completed_at FROM orders WHERE id = ?')
    .get(id) as unknown as OrderRow | undefined;
  return row ? withLines(db, { ...row }) : undefined;
}

/** 古い順(created_at, id)。status 省略で全件。 */
export function listOrders(db: DatabaseSync, status?: OrderStatus): Order[] {
  const base = 'SELECT id, call_number, status, total, created_at, completed_at FROM orders';
  const rows = (
    status
      ? db.prepare(`${base} WHERE status = ? ORDER BY created_at, id`).all(status)
      : db.prepare(`${base} ORDER BY created_at, id`).all()
  ) as unknown as OrderRow[];
  return rows.map((r) => withLines(db, { ...r }));
}
