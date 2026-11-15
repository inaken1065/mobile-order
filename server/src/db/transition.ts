// orders.status / orders.completed_at を更新できる唯一の場所(UB 専用)。
// 契約テスト 0b が「UPDATE orders はこのファイルにしか無い」ことを検査する。
import type { DatabaseSync } from 'node:sqlite';
import { ORDER_TRANSITIONS, type Order, type OrderStatus } from '../../../contracts/types';
import { getOrder } from './queries';
import { nowJst } from './time';

export class OrderNotFoundError extends Error {
  constructor(id: number) {
    super(`order not found: ${id}`);
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    public from: OrderStatus,
    public to: OrderStatus,
  ) {
    super(`invalid transition: ${from} -> ${to}`);
  }
}

/** 注文を1段階進める。completed_at は READY への遷移時にのみ設定する。 */
export function transitionOrder(
  db: DatabaseSync,
  orderId: number,
  to: OrderStatus,
  now: string = nowJst(),
): Order {
  const row = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as
    | { status: OrderStatus }
    | undefined;
  if (!row) throw new OrderNotFoundError(orderId);
  const from = row.status;
  if (!ORDER_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);

  const completedAt = to === 'READY' ? now : null;
  const result = db
    .prepare('UPDATE orders SET status = ?, completed_at = ? WHERE id = ? AND status = ?')
    .run(to, completedAt, orderId, from);
  if (result.changes !== 1) throw new InvalidTransitionError(from, to);
  return getOrder(db, orderId)!;
}
