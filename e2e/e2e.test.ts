// B4: 結合確認・E2E。実プロセスの API サーバー(UA・UB・UC のルートが同居)を HTTP で通して検証する。
// 実行: node --import tsx --test "e2e/*.test.ts"
// 前提: ブラウザ操作の E2E(Web UI)は aidlc-docs/construction/BOLT-REPORT-B4.md に手順と結果を記録する。
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import type { DailySales, MenuItem, Order } from '../contracts/types';
import { todayJst } from '../server/src/db/time';
import { completeOrder, menuByName, placeOrder, startApi, type Api } from './helpers';

let api: Api;
const TODAY = todayJst();

before(async () => {
  api = await startApi();
});
after(async () => {
  await api?.stop();
});

async function sales(date = TODAY): Promise<DailySales> {
  const res = await api.call('GET', `/manager/sales/daily?date=${date}`);
  assert.equal(res.status, 200, res.text);
  return res.json as DailySales;
}
const qtyOf = (s: DailySales, id: number) => s.items.find((i) => i.menu_item_id === id)?.qty ?? 0;
const amountOf = (s: DailySales, id: number) => s.items.find((i) => i.menu_item_id === id)?.amount ?? 0;
const getOrder = async (id: number) => (await api.call('GET', `/orders/${id}`)).json as Order;
const kitchenList = async (status?: string) =>
  ((await api.call('GET', `/kitchen/orders${status ? `?status=${status}` : ''}`)).json as { orders: Order[] }).orders;

// ---------------------------------------------------------------- シナリオ1: 客 → 厨房 → 店長(売上)

describe('E2E 1: 客が注文 → 厨房が完成 → 店長の売上に反映', () => {
  test('全フロー', async () => {
    const ramen = await menuByName(api, '醤油ラーメン');
    const beer = await menuByName(api, '生ビール');
    const before = await sales();

    // 客: 注文
    const placed = await placeOrder(api, [
      { menu_item_id: ramen.id, qty: 2 },
      { menu_item_id: beer.id, qty: 1 },
    ]);
    assert.equal(placed.status, 'PLACED');
    assert.equal(placed.completed_at, null);
    assert.equal(placed.total, ramen.price * 2 + beer.price);
    assert.ok(Number.isInteger(placed.call_number) && placed.call_number >= 1);

    // 厨房: 受付に出る(古い順の末尾)
    const queue = await kitchenList('PLACED');
    assert.ok(queue.some((o) => o.id === placed.id), '厨房の PLACED 一覧に出る');
    assert.equal(queue.at(-1)!.id, placed.id, '最も新しい注文は末尾');
    // Kitchen UI は status 指定なしの一覧を使う。こちらも古い順(最新が末尾)
    assert.equal((await kitchenList()).at(-1)!.id, placed.id, 'status 指定なしの一覧でも最新が末尾');
    const inKitchen = queue.find((o) => o.id === placed.id)!;
    assert.deepEqual(inKitchen.lines, placed.lines, '厨房が見る明細は客が注文した内容と一致');

    // 売上: PLACED では増えない
    assert.deepEqual(await sales(), before);

    // 厨房: 調理中 → 客から見ても調理中、売上は増えない
    const cooking = await api.call('PATCH', `/kitchen/orders/${placed.id}/status`, { status: 'COOKING' });
    assert.equal(cooking.status, 200);
    assert.equal(cooking.json.status, 'COOKING');
    assert.equal(cooking.json.completed_at, null);
    assert.equal((await getOrder(placed.id)).status, 'COOKING', '客の状況確認に反映');
    assert.deepEqual(await sales(), before, 'COOKING では売上は増えない');

    // 厨房: 完成 → completed_at が設定され、客にも反映
    const ready = await api.call('PATCH', `/kitchen/orders/${placed.id}/status`, { status: 'READY' });
    assert.equal(ready.status, 200);
    assert.equal(ready.json.status, 'READY');
    assert.ok(ready.json.completed_at?.startsWith(TODAY), 'completed_at が設定される');
    const seenByCustomer = await getOrder(placed.id);
    assert.equal(seenByCustomer.status, 'READY');
    assert.equal(seenByCustomer.completed_at, ready.json.completed_at);

    // 店長: 売上に反映(合計・件数・商品別)
    const after = await sales();
    assert.equal(after.total, before.total + placed.total);
    assert.equal(after.order_count, before.order_count + 1);
    assert.equal(qtyOf(after, ramen.id), qtyOf(before, ramen.id) + 2);
    assert.equal(amountOf(after, ramen.id), amountOf(before, ramen.id) + ramen.price * 2);
    assert.equal(qtyOf(after, beer.id), qtyOf(before, beer.id) + 1);
    assert.equal(after.items.reduce((s, i) => s + i.amount, 0), after.total, '内訳の合計 = 売上合計');

    // 厨房の一覧の status フィルタ
    assert.ok((await kitchenList('READY')).some((o) => o.id === placed.id));
    assert.ok(!(await kitchenList('PLACED')).some((o) => o.id === placed.id));
  });

  test('完成していない注文は売上に入らない(複数注文)', async () => {
    const item = await menuByName(api, '餃子(6個)');
    const before = await sales();
    const a = await placeOrder(api, [{ menu_item_id: item.id, qty: 1 }]);
    const b = await placeOrder(api, [{ menu_item_id: item.id, qty: 3 }]);
    await completeOrder(api, a.id); // a だけ完成
    await api.call('PATCH', `/kitchen/orders/${b.id}/status`, { status: 'COOKING' }); // b は調理中
    const after = await sales();
    assert.equal(after.total, before.total + a.total);
    assert.equal(qtyOf(after, item.id), qtyOf(before, item.id) + 1);
  });

  test('呼出番号は当日内で一意に増える', async () => {
    const item = await menuByName(api, 'ウーロン茶');
    const a = await placeOrder(api, [{ menu_item_id: item.id, qty: 1 }]);
    const b = await placeOrder(api, [{ menu_item_id: item.id, qty: 1 }]);
    assert.equal(b.call_number, a.call_number + 1);
  });
});

// ---------------------------------------------------------------- シナリオ2: 店長の変更が客に反映

describe('E2E 2: 店長のメニュー変更が客に反映', () => {
  test('売り切れ設定 → 客のメニューに反映 → 注文拒否 → 解除で注文できる', async () => {
    const ramen = await menuByName(api, '味噌ラーメン');
    const other = await menuByName(api, 'コーラ');
    assert.equal(ramen.is_available, true);

    // 店長: 売り切れにする
    const off = await api.call('PATCH', `/manager/menu/${ramen.id}/availability`, { is_available: false });
    assert.equal(off.status, 200);
    assert.equal(off.json.is_available, false);

    // 客: メニューに反映(売り切れも一覧に残る = UC が依存する保証)
    assert.equal((await menuByName(api, '味噌ラーメン')).is_available, false);

    // 客: 売り切れ商品を含む注文は 409。他の商品を混ぜても部分注文は残らない
    const countBefore = (await kitchenList()).length;
    const rejected = await api.call('POST', '/orders', {
      lines: [
        { menu_item_id: other.id, qty: 1 },
        { menu_item_id: ramen.id, qty: 1 },
      ],
    });
    assert.equal(rejected.status, 409);
    assert.match(rejected.json.error, /sold out/);
    assert.equal((await kitchenList()).length, countBefore, '厨房に注文が現れない');

    // 売り切れ以外だけなら注文できる
    assert.equal((await placeOrder(api, [{ menu_item_id: other.id, qty: 1 }])).status, 'PLACED');

    // 店長: 解除 → 客が注文できる
    assert.equal((await api.call('PATCH', `/manager/menu/${ramen.id}/availability`, { is_available: true })).status, 200);
    assert.equal((await menuByName(api, '味噌ラーメン')).is_available, true);
    assert.equal((await placeOrder(api, [{ menu_item_id: ramen.id, qty: 1 }])).status, 'PLACED');
  });

  test('価格変更 → 新規注文は新価格、既存注文と売上は注文時点の価格(スナップショット)', async () => {
    const item = await menuByName(api, 'チャーハン');
    const oldPrice = item.price;
    const newPrice = oldPrice + 200;
    const before = await sales();

    const orderOld = await placeOrder(api, [{ menu_item_id: item.id, qty: 1 }]);
    assert.equal(orderOld.lines[0].unit_price, oldPrice);

    const put = await api.call('PUT', `/manager/menu/${item.id}`, {
      name: item.name,
      category: item.category,
      price: newPrice,
    });
    assert.equal(put.status, 200);
    assert.equal(put.json.price, newPrice);
    assert.equal(put.json.is_available, true, 'PUT で is_available を省略しても維持される');

    assert.equal((await menuByName(api, 'チャーハン')).price, newPrice, '客のメニューに反映');
    const orderNew = await placeOrder(api, [{ menu_item_id: item.id, qty: 2 }]);
    assert.equal(orderNew.lines[0].unit_price, newPrice);
    assert.equal(orderNew.total, newPrice * 2);
    assert.equal((await getOrder(orderOld.id)).lines[0].unit_price, oldPrice, '既存注文は不変');

    await completeOrder(api, orderOld.id);
    await completeOrder(api, orderNew.id);
    const after = await sales();
    assert.equal(amountOf(after, item.id) - amountOf(before, item.id), oldPrice * 1 + newPrice * 2, '売上は各注文の単価で集計');
    assert.equal(after.total - before.total, orderOld.total + orderNew.total);
  });

  test('メニュー追加 → 客のメニューに出て注文できる', async () => {
    const created = await api.call('POST', '/manager/menu', { name: 'E2E 限定丼', category: 'メイン', price: 1234 });
    assert.equal(created.status, 201);
    assert.equal(created.json.is_available, true);
    const item = await menuByName(api, 'E2E 限定丼');
    assert.equal(item.price, 1234);
    const order = await placeOrder(api, [{ menu_item_id: item.id, qty: 1 }]);
    assert.equal(order.total, 1234);
    const done = await completeOrder(api, order.id);
    assert.equal(done.status, 'READY');
    assert.equal(qtyOf(await sales(), item.id), 1);
  });
});

// ---------------------------------------------------------------- シナリオ3: 異常系・境界

describe('E2E 3: 異常系と境界', () => {
  test('ステータスは1段階ずつしか進まず、失敗しても注文は変わらない', async () => {
    const item = await menuByName(api, 'ポテトフライ');
    const o = await placeOrder(api, [{ menu_item_id: item.id, qty: 1 }]);
    const patch = (status: string) => api.call('PATCH', `/kitchen/orders/${o.id}/status`, { status });

    assert.equal((await patch('READY')).status, 409, '飛ばし');
    assert.equal((await patch('PLACED')).status, 409, '同一状態');
    assert.equal((await getOrder(o.id)).status, 'PLACED');
    assert.equal((await patch('COOKING')).status, 200);
    assert.equal((await patch('COOKING')).status, 409);
    assert.equal((await patch('PLACED')).status, 409, '逆戻り');
    assert.equal((await patch('READY')).status, 200);
    assert.equal((await patch('COOKING')).status, 409, 'READY からの逆戻り');
    const final = await getOrder(o.id);
    assert.equal(final.status, 'READY');
    assert.ok(final.completed_at);
    assert.equal((await patch('DONE')).status, 400);
    assert.equal((await api.call('PATCH', '/kitchen/orders/999999/status', { status: 'COOKING' })).status, 404);
  });

  test('3ユニットすべてで、壊れた JSON のエラーが { error } 形式', async () => {
    for (const [method, path] of [
      ['POST', '/orders'],
      ['PATCH', '/kitchen/orders/1/status'],
      ['POST', '/manager/menu'],
      ['PUT', '/manager/menu/1'],
      ['PATCH', '/manager/menu/1/availability'],
    ] as const) {
      const res = await api.raw(method, path, '{bad');
      assert.equal(res.status, 400, `${method} ${path}`);
      assert.equal(typeof res.json?.error, 'string', `${method} ${path}: { error } 形式`);
      assert.deepEqual(Object.keys(res.json), ['error'], `${method} ${path}: 余計なキーがない`);
    }
  });

  test('各ユニットの 400 / 404 が { error } 形式', async () => {
    const cases: [string, string, unknown, number][] = [
      ['POST', '/orders', { lines: [] }, 400],
      ['POST', '/orders', { lines: [{ menu_item_id: 999999, qty: 1 }] }, 400],
      ['GET', '/orders/abc', undefined, 404],
      ['GET', '/kitchen/orders?status=DONE', undefined, 400],
      ['POST', '/manager/menu', { name: '', category: 'x', price: 1 }, 400],
      ['PUT', '/manager/menu/999999', { name: 'x', category: 'x', price: 1 }, 404],
      ['PATCH', '/manager/menu/1/availability', { is_available: 'yes' }, 400],
      ['GET', '/manager/sales/daily?date=2026-02-30', undefined, 400],
    ];
    for (const [method, path, body, status] of cases) {
      const res = await api.call(method, path, body);
      assert.equal(res.status, status, `${method} ${path}`);
      assert.deepEqual(Object.keys(res.json), ['error'], `${method} ${path}`);
    }
  });

  test('【既知・Issue #12】未定義ルートの 404 は Fastify 標準の形式(特性テスト)', async () => {
    const res = await api.call('GET', '/no-such-route');
    assert.equal(res.status, 404);
    assert.equal(res.json.statusCode, 404);
    assert.equal(res.json.error, 'Not Found');
  });

  test('同時に10件注文しても、全件成功し呼出番号が重複しない', async () => {
    const item = await menuByName(api, 'ウーロン茶');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => api.call('POST', '/orders', { lines: [{ menu_item_id: item.id, qty: 1 }] })),
    );
    assert.ok(results.every((r) => r.status === 201), results.map((r) => r.status).join(','));
    const numbers = results.map((r) => (r.json as Order).call_number);
    assert.equal(new Set(numbers).size, 10, `呼出番号が重複: ${numbers}`);
  });

  test('2台の厨房端末が同時に同じ遷移を押すと、片方だけ成功して片方は 409', async () => {
    const item = await menuByName(api, 'コーラ');
    const o = await placeOrder(api, [{ menu_item_id: item.id, qty: 1 }]);
    const res = await Promise.all([
      api.call('PATCH', `/kitchen/orders/${o.id}/status`, { status: 'COOKING' }),
      api.call('PATCH', `/kitchen/orders/${o.id}/status`, { status: 'COOKING' }),
    ]);
    assert.deepEqual(res.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await getOrder(o.id)).status, 'COOKING');
  });

  test('売り切れ設定と注文が競合しても、売り切れ後に通った注文は存在しない', async () => {
    const item = await menuByName(api, 'シーザーサラダ');
    const orders = Array.from({ length: 6 }, () => api.call('POST', '/orders', { lines: [{ menu_item_id: item.id, qty: 1 }] }));
    const toggle = api.call('PATCH', `/manager/menu/${item.id}/availability`, { is_available: false });
    const results = await Promise.all([...orders, toggle]);
    for (const r of results.slice(0, 6)) assert.ok([201, 409].includes(r.status), `status=${r.status}`);
    // 売り切れ確定後の注文は必ず 409
    const after = await api.call('POST', '/orders', { lines: [{ menu_item_id: item.id, qty: 1 }] });
    assert.equal(after.status, 409);
    await api.call('PATCH', `/manager/menu/${item.id}/availability`, { is_available: true });
  });
});

// ---------------------------------------------------------------- シナリオ4: 全シナリオ後の DB 不変条件

describe('E2E 4: 全シナリオ実行後の DB 不変条件(実 DB を読み取り専用で検査)', () => {
  test('不変条件', async () => {
    const db = new DatabaseSync(api.dbPath, { readOnly: true });
    const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

    assert.ok(one('SELECT COUNT(*) AS n FROM orders') > 30, 'シナリオで十分な注文が作られている');
    assert.equal(one("SELECT COUNT(*) AS n FROM orders WHERE status = 'READY' AND completed_at IS NULL"), 0);
    assert.equal(one("SELECT COUNT(*) AS n FROM orders WHERE status <> 'READY' AND completed_at IS NOT NULL"), 0);
    assert.equal(
      one(`SELECT COUNT(*) AS n FROM orders o WHERE total <> (SELECT SUM(qty * unit_price) FROM order_lines l WHERE l.order_id = o.id)`),
      0,
      'total = 明細の合計',
    );
    assert.equal(one('SELECT COUNT(*) AS n FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id)'), 0, '明細のない注文がない');
    assert.equal(
      one(`SELECT COUNT(*) AS n FROM (SELECT substr(created_at, 1, 10) AS d, call_number FROM orders GROUP BY d, call_number HAVING COUNT(*) > 1)`),
      0,
      '同じ日の呼出番号が重複しない',
    );
    assert.equal(one('SELECT COUNT(*) AS n FROM (SELECT 1 FROM order_lines GROUP BY order_id, menu_item_id HAVING COUNT(*) > 1)'), 0, '明細の重複行がない');

    // 売上 API の合計 = DB の READY の合計(当日)
    const dbTotal = one(`SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE status = 'READY' AND substr(completed_at, 1, 10) = '${TODAY}'`);
    assert.equal((await sales()).total, dbTotal);
    db.close();

    // メニューは全件が客から見える(売り切れ含む)
    const items = ((await api.call('GET', '/menu')).json as { items: MenuItem[] }).items;
    assert.equal(items.length, 13); // シード 12 + E2E 限定丼
  });
});
