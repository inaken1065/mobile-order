// U0 契約: 書き込み担当(機械可読版)。正本の表は aidlc-docs/inception/02-units.md。
// 静的検査(契約テスト 0b)が使う。SQL は大文字で書く規約(INSERT INTO / UPDATE / DELETE FROM)。

export type Unit = 'UA' | 'UB' | 'UC';
export type WriteOp = 'INSERT' | 'UPDATE' | 'DELETE';

/** server/src からの相対パスの接頭辞 → 担当ユニット */
export const UNIT_PATH_PREFIX: Record<Unit, string> = {
  UA: 'routes/customer',
  UB: 'routes/kitchen',
  UC: 'routes/manager',
};

/** 各ユニットのルートコードが直接書いてよい SQL 書き込み */
export const ALLOWED_WRITES: Record<Unit, { table: string; op: WriteOp }[]> = {
  UA: [
    { table: 'orders', op: 'INSERT' },
    { table: 'order_lines', op: 'INSERT' },
  ],
  // UB は生の書き込み SQL を持たない。status / completed_at の更新は transitionOrder() 経由のみ。
  UB: [],
  UC: [
    { table: 'menu_items', op: 'INSERT' },
    { table: 'menu_items', op: 'UPDATE' },
    { table: 'menu_items', op: 'DELETE' },
  ],
};

/** どのファイルにも書いてはいけない書き込み(トリガーでも拒否される) */
export const FORBIDDEN_EVERYWHERE: { table: string; op: WriteOp }[] = [
  { table: 'order_lines', op: 'UPDATE' },
  { table: 'order_lines', op: 'DELETE' },
  { table: 'orders', op: 'DELETE' },
];

/** `UPDATE orders` を書いてよい唯一のファイル(server/src からの相対パス) */
export const ORDERS_UPDATE_ONLY_IN = 'db/transition.ts';

/** transitionOrder を参照してよい場所(db/ と UB のルート) */
export const TRANSITION_USERS = ['db/', UNIT_PATH_PREFIX.UB];

/**
 * ユニット間の API 読み取り依存。DB の書き込み担当(上記)とは別に、
 * 「他ユニット所有のルートを読み取りで使う」関係を明示する。
 * OpenAPI の x-read-by と契約テスト 0d で突き合わせる。
 */
export interface ApiReadDependency {
  consumer: Unit;
  owner: Unit;
  method: 'GET';
  path: string;
  /** owner が守らなければならない振る舞い(consumer が依存している) */
  guarantee: string;
}

export const API_READ_DEPENDENCIES: ApiReadDependency[] = [
  {
    consumer: 'UC',
    owner: 'UA',
    method: 'GET',
    path: '/menu',
    guarantee: '売り切れ(is_available=false)を含む全件を返す(契約テスト 1c)',
  },
];
