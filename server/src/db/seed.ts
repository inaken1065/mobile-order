// シードデータ(U0)。B1〜B3 がモックなしで動けるよう、各 status と完成済み履歴を用意する。
// orders は INSERT(PLACED) → transitionOrder で進める。トリガーの内側で作る(迂回しない)。
import type { DatabaseSync } from 'node:sqlite';
import { tx } from './db';
import { transitionOrder } from './transition';
import { nowJst, todayJst } from './time';

const MENU: [name: string, category: string, price: number, available: boolean][] = [
  ['ウーロン茶', 'ドリンク', 250, true],
  ['コーラ', 'ドリンク', 300, true],
  ['生ビール', 'ドリンク', 550, true],
  ['枝豆', 'サイド', 300, true],
  ['唐揚げ', 'サイド', 480, true],
  ['ポテトフライ', 'サイド', 400, true],
  ['シーザーサラダ', 'サイド', 650, true],
  ['醤油ラーメン', 'メイン', 850, true],
  ['味噌ラーメン', 'メイン', 900, true],
  ['餃子(6個)', 'メイン', 450, true],
  ['チャーハン', 'メイン', 800, true],
  ['杏仁豆腐', 'デザート', 350, false], // 売り切れの例
];

type Plan = { day: 'today' | 'yesterday'; minute: number; items: [menuIndex: number, qty: number][]; final: 'PLACED' | 'COOKING' | 'READY' };

const ORDERS: Plan[] = [
  { day: 'yesterday', minute: 0, items: [[7, 2], [3, 1]], final: 'READY' },
  { day: 'yesterday', minute: 10, items: [[8, 1], [1, 1]], final: 'READY' },
  { day: 'today', minute: 0, items: [[7, 1], [9, 1]], final: 'READY' },
  { day: 'today', minute: 5, items: [[10, 2], [0, 2]], final: 'READY' },
  { day: 'today', minute: 10, items: [[8, 1], [2, 1]], final: 'READY' },
  { day: 'today', minute: 15, items: [[4, 2], [2, 2]], final: 'COOKING' },
  { day: 'today', minute: 20, items: [[7, 1]], final: 'COOKING' },
  { day: 'today', minute: 25, items: [[8, 2], [9, 1]], final: 'PLACED' },
  { day: 'today', minute: 30, items: [[10, 1], [1, 1]], final: 'PLACED' },
  { day: 'today', minute: 35, items: [[5, 1], [6, 1], [2, 1]], final: 'PLACED' },
];

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return todayJst(d);
}

function at(date: string, minute: number): string {
  const hh = String(11 + Math.floor(minute / 60)).padStart(2, '0');
  const mm = String(minute % 60).padStart(2, '0');
  return `${date}T${hh}:${mm}:00+09:00`;
}

/** today は JST の YYYY-MM-DD(テストでは固定値を渡す) */
export function seed(db: DatabaseSync, opts: { today?: string } = {}): void {
  const today = opts.today ?? todayJst();
  const yesterday = shiftDay(today, -1);
  tx(db, () => {
    const now = nowJst();
    const insMenu = db.prepare(
      'INSERT INTO menu_items (name, category, price, is_available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const menuIds: number[] = [];
    for (const [name, category, price, available] of MENU) {
      menuIds.push(Number(insMenu.run(name, category, price, available ? 1 : 0, now, now).lastInsertRowid));
    }

    let callNumber = 0;
    const insOrder = db.prepare('INSERT INTO orders (call_number, status, total, created_at) VALUES (?, ?, ?, ?)');
    const insLine = db.prepare(
      'INSERT INTO order_lines (order_id, menu_item_id, name, unit_price, qty) VALUES (?, ?, ?, ?, ?)',
    );
    for (const plan of ORDERS) {
      const date = plan.day === 'today' ? today : yesterday;
      const created = at(date, plan.minute);
      const total = plan.items.reduce((s, [mi, qty]) => s + MENU[mi][2] * qty, 0);
      callNumber += 1;
      const orderId = Number(insOrder.run(callNumber, 'PLACED', total, created).lastInsertRowid);
      for (const [mi, qty] of plan.items) {
        insLine.run(orderId, menuIds[mi], MENU[mi][0], MENU[mi][2], qty);
      }
      if (plan.final !== 'PLACED') transitionOrder(db, orderId, 'COOKING', at(date, plan.minute + 2));
      if (plan.final === 'READY') transitionOrder(db, orderId, 'READY', at(date, plan.minute + 12));
    }
  });
}
