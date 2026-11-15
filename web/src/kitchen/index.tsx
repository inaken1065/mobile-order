// UB(厨房)の画面: 注文キュー(受付 / 調理中 / 完成)。ボタンで1段階ずつ進める。
import { useCallback, useEffect, useState } from 'react';
import { ORDER_TRANSITIONS, type Order, type OrderStatus } from '../../../contracts/types';
import { api } from '../shared/api';
import { kitchenErrorText } from '../shared/error-text';

const POLL_MS = 2000;
const WARN_MIN = 10; // 経過がこの分数を超えた未完成の注文を強調
const READY_LIMIT = 10; // 完成列に出す件数(新しい順)

const COLUMNS: { status: OrderStatus; title: string; color: string }[] = [
  { status: 'PLACED', title: '受付', color: '#d97706' },
  { status: 'COOKING', title: '調理中', color: '#2563eb' },
  { status: 'READY', title: '完成', color: '#16a34a' },
];

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  COOKING: '調理開始',
  READY: '完成',
};

function minutesBetween(fromIso: string, toMs: number): number {
  return Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 60000));
}

function clock(iso: string): string {
  return iso.slice(11, 16); // JST の HH:mm
}

function OrderCard({
  order,
  now,
  busy,
  onAdvance,
}: {
  order: Order;
  now: number;
  busy: boolean;
  onAdvance: (order: Order, to: OrderStatus) => void;
}) {
  const next = ORDER_TRANSITIONS[order.status][0]; // READY は undefined(ボタンなし)
  const done = order.status === 'READY';
  const elapsed =
    done && order.completed_at
      ? minutesBetween(order.created_at, new Date(order.completed_at).getTime())
      : minutesBetween(order.created_at, now);
  const late = !done && elapsed >= WARN_MIN;

  return (
    <li
      data-testid="order"
      data-status={order.status}
      style={{
        listStyle: 'none',
        background: '#fff',
        border: `2px solid ${late ? '#dc2626' : '#e5e7eb'}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 22 }}>#{order.call_number}</strong>
        <span style={{ color: late ? '#dc2626' : '#6b7280', fontWeight: late ? 700 : 400 }}>
          {done ? `所要 ${elapsed}分` : `経過 ${elapsed}分`}・受付 {clock(order.created_at)}
        </span>
      </div>
      <ul style={{ margin: '8px 0', padding: 0 }}>
        {order.lines.map((l, i) => (
          <li key={i} style={{ listStyle: 'none', fontSize: 16 }}>
            {l.name} <b>×{l.qty}</b>
          </li>
        ))}
      </ul>
      {next && (
        <button
          onClick={() => onAdvance(order, next)}
          disabled={busy}
          style={{
            width: '100%',
            minHeight: 44,
            fontSize: 16,
            fontWeight: 700,
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            background: next === 'READY' ? '#16a34a' : '#2563eb',
            opacity: busy ? 0.5 : 1,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {ACTION_LABEL[next]}
        </button>
      )}
    </li>
  );
}

export default function Kitchen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ orders: Order[] }>('/kitchen/orders');
      setOrders(r.orders);
      setError('');
    } catch (e) {
      setError(`注文を取得できません: ${kitchenErrorText(e)}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const advance = async (order: Order, to: OrderStatus) => {
    setBusyId(order.id);
    let failure = '';
    try {
      await api.patch<Order>(`/kitchen/orders/${order.id}/status`, { status: to });
    } catch (e) {
      // 409(他の端末で先に更新された等)も含め、最新の状態を取り直して表示する
      failure = `#${order.call_number} を更新できませんでした: ${kitchenErrorText(e)}`;
    }
    await load(); // 成功時はここでエラー表示も消える
    if (failure) setError(failure);
    setBusyId(null);
    setNow(Date.now());
  };

  const todayJst = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
  // 未完成は全件(API は古い順)。完成は当日(JST)分のみ、直近 READY_LIMIT 件を新しい順
  const visible = (s: OrderStatus): Order[] => {
    const list = orders.filter((o) => o.status === s && (s !== 'READY' || o.completed_at?.startsWith(todayJst)));
    if (s !== 'READY') return list;
    return [...list].sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, READY_LIMIT);
  };

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 12, background: '#f3f4f6', minHeight: '100vh', boxSizing: 'border-box' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>注文一覧(厨房)</h1>
      {error && (
        <p role="alert" style={{ color: '#fff', background: '#dc2626', padding: '8px 12px', borderRadius: 6 }}>
          {error}
        </p>
      )}
      {!loaded && <p>読み込み中…</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, alignItems: 'start' }}>
        {COLUMNS.map((c) => {
          const list = visible(c.status);
          const total = c.status === 'READY' ? orders.filter((o) => o.completed_at?.startsWith(todayJst)).length : list.length;
          return (
            <section key={c.status} data-testid={`col-${c.status}`}>
              <h2 style={{ margin: '0 0 8px', fontSize: 18, color: c.color, borderBottom: `3px solid ${c.color}` }}>
                {c.title}({total})
              </h2>
              <ul style={{ margin: 0, padding: 0 }}>
                {list.map((o) => (
                  <OrderCard key={o.id} order={o} now={now} busy={busyId === o.id} onAdvance={advance} />
                ))}
              </ul>
              {list.length === 0 && <p style={{ color: '#9ca3af' }}>なし</p>}
            </section>
          );
        })}
      </div>
    </main>
  );
}
