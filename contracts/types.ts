// U0 契約: 共通型。Wave 1 中は読み取り専用。変更は B0 に差し戻すこと。

export const ORDER_STATUSES = ['PLACED', 'COOKING', 'READY'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** 許可されるステータス遷移(逆戻り・飛ばしは不可)。DB トリガーと契約テストで一致を検証する。 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PLACED: ['COOKING'],
  COOKING: ['READY'],
  READY: [],
};

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  is_available: boolean;
}

export interface MenuItemInput {
  name: string;
  category: string;
  price: number;
  is_available?: boolean;
}

export interface OrderLine {
  menu_item_id: number;
  /** 注文時点のスナップショット */
  name: string;
  /** 注文時点のスナップショット */
  unit_price: number;
  qty: number;
}

export interface Order {
  id: number;
  call_number: number;
  status: OrderStatus;
  total: number;
  /** ISO 8601 JST 例: 2026-11-15T12:00:00+09:00 */
  created_at: string;
  /** READY への遷移と同時にのみ設定される。それ以外は null */
  completed_at: string | null;
  lines: OrderLine[];
}

export interface CreateOrderRequest {
  lines: { menu_item_id: number; qty: number }[];
}

export interface DailySales {
  /** YYYY-MM-DD(JST)。completed_at の先頭10文字で判定 */
  date: string;
  order_count: number;
  total: number;
  items: { menu_item_id: number; name: string; qty: number; amount: number }[];
}

// ---- DB 列の契約(schema.sql と契約テストで突き合わせる) ----

export interface ColumnSpec {
  type: 'INTEGER' | 'TEXT';
  notNull: boolean;
  pk?: true;
}

export const DB_COLUMNS = {
  menu_items: {
    id: { type: 'INTEGER', notNull: true, pk: true },
    name: { type: 'TEXT', notNull: true },
    category: { type: 'TEXT', notNull: true },
    price: { type: 'INTEGER', notNull: true },
    is_available: { type: 'INTEGER', notNull: true },
    created_at: { type: 'TEXT', notNull: true },
    updated_at: { type: 'TEXT', notNull: true },
  },
  orders: {
    id: { type: 'INTEGER', notNull: true, pk: true },
    call_number: { type: 'INTEGER', notNull: true },
    status: { type: 'TEXT', notNull: true },
    total: { type: 'INTEGER', notNull: true },
    created_at: { type: 'TEXT', notNull: true },
    completed_at: { type: 'TEXT', notNull: false },
  },
  order_lines: {
    id: { type: 'INTEGER', notNull: true, pk: true },
    order_id: { type: 'INTEGER', notNull: true },
    menu_item_id: { type: 'INTEGER', notNull: true },
    name: { type: 'TEXT', notNull: true },
    unit_price: { type: 'INTEGER', notNull: true },
    qty: { type: 'INTEGER', notNull: true },
  },
} as const satisfies Record<string, Record<string, ColumnSpec>>;

/** API に出さない menu_items の列 */
export const MENU_ITEM_INTERNAL_COLUMNS = ['created_at', 'updated_at'] as const;
