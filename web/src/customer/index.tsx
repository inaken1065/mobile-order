// UA(客)の画面: メニュー閲覧(カテゴリ別・売り切れ表示)→ カート → 注文確定 → 呼出番号とステータスのポーリング。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MenuItem, Order, OrderStatus } from '../../../contracts/types';
import { api } from '../shared/api';
import { parseCustomerError } from '../shared/error-text';
import { CSS } from './styles';

const STORAGE_KEY = 'mobile-order:last-order-id';
const POLL_MS = 2000;
const MENU_REFRESH_MS = 10000;

const STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: '受付済み',
  COOKING: '調理中',
  READY: 'できあがり',
};
const STEPS: OrderStatus[] = ['PLACED', 'COOKING', 'READY'];

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

function readStoredOrderId(): number | null {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function storeOrderId(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    /* localStorage が使えなくても動作する */
  }
}

export default function Customer() {
  const [order, setOrder] = useState<Order | null>(null);
  const [restoring, setRestoring] = useState(true);

  // 前回の注文が残っていれば、ステータス画面に復帰する(画面を閉じても呼出番号が分かる)
  useEffect(() => {
    const id = readStoredOrderId();
    if (id === null) return setRestoring(false);
    api.get<Order>(`/orders/${id}`).then(
      (o) => (setOrder(o), setRestoring(false)),
      (e) => {
        if (parseCustomerError(e).status === 404) storeOrderId(null);
        setRestoring(false);
      },
    );
  }, []);

  const placed = (o: Order) => {
    storeOrderId(o.id);
    setOrder(o);
  };
  const reset = () => {
    storeOrderId(null);
    setOrder(null);
  };

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="top">モバイルオーダー</header>
      {restoring ? <p className="note">読み込み中…</p> : order ? <Tracking initial={order} onNew={reset} /> : <Ordering onPlaced={placed} />}
    </div>
  );
}

// ---------------------------------------------------------------- 注文画面

function Ordering({ onPlaced }: { onPlaced: (o: Order) => void }) {
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const loadMenu = useCallback(async () => {
    try {
      const r = await api.get<{ items: MenuItem[] }>('/menu');
      setItems(r.items);
      setLoadError('');
      // 売り切れになった商品はカートから外す
      const soldOut = new Set(r.items.filter((i) => !i.is_available).map((i) => i.id));
      setCart((c) => Object.fromEntries(Object.entries(c).filter(([id]) => !soldOut.has(Number(id)))));
      return r.items;
    } catch (e) {
      setLoadError(parseCustomerError(e).message);
      return null;
    }
  }, []);

  useEffect(() => {
    loadMenu();
    const t = setInterval(loadMenu, MENU_REFRESH_MS); // 売り切れの切替を反映
    return () => clearInterval(t);
  }, [loadMenu]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const i of items ?? []) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
    return [...groups];
  }, [items]);

  const lines = useMemo(
    () => (items ?? []).filter((i) => cart[i.id] > 0).map((i) => ({ item: i, qty: cart[i.id] })),
    [items, cart],
  );
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.qty * l.item.price, 0);

  const change = (id: number, delta: number) =>
    setCart((c) => {
      const qty = Math.max(0, (c[id] ?? 0) + delta);
      const next = { ...c };
      if (qty === 0) delete next[id];
      else next[id] = qty;
      return next;
    });

  const submit = async () => {
    if (submitting || lines.length === 0) return;
    setSubmitting(true);
    setMessage('');
    try {
      const o = await api.post<Order>('/orders', {
        lines: lines.map((l) => ({ menu_item_id: l.item.id, qty: l.qty })),
      });
      onPlaced(o);
    } catch (e) {
      const { status, message: m } = parseCustomerError(e);
      if (status === 409) {
        await loadMenu(); // 最新の売り切れ状態を取り直し、カートから外す
        setMessage(`売り切れの商品がありました(${m.replace(/^sold out: /, '')})。カートを確認してください。`);
      } else {
        setMessage(`注文できませんでした: ${m}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError && !items) return <p className="error" role="alert">メニューを読み込めません: {loadError}</p>;
  if (!items) return <p className="note">読み込み中…</p>;

  return (
    <main className="menu">
      {loadError && <p className="error" role="alert">最新のメニューを取得できません({loadError})</p>}
      {message && <p className="error" role="alert" data-testid="order-error">{message}</p>}
      {byCategory.map(([category, list]) => (
        <section key={category}>
          <h2>{category}</h2>
          <ul>
            {list.map((i) => (
              <li key={i.id} className={i.is_available ? '' : 'soldout'} data-testid={`menu-${i.id}`}>
                <div className="info">
                  <span className="name">{i.name}</span>
                  <span className="price">{yen(i.price)}</span>
                </div>
                {i.is_available ? (
                  <Stepper qty={cart[i.id] ?? 0} name={i.name} onChange={(d) => change(i.id, d)} />
                ) : (
                  <span className="badge">売り切れ</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="spacer" />
      <footer className="cartbar">
        <div className="sum">
          <span data-testid="cart-qty">{totalQty}点</span>
          <b data-testid="cart-total">{yen(total)}</b>
        </div>
        <button className="primary" onClick={submit} disabled={totalQty === 0 || submitting} data-testid="submit">
          {submitting ? '送信中…' : '注文を確定する'}
        </button>
      </footer>
    </main>
  );
}

function Stepper({ qty, name, onChange }: { qty: number; name: string; onChange: (d: number) => void }) {
  if (qty === 0) {
    return (
      <button className="add" onClick={() => onChange(1)} aria-label={`${name}をカートに追加`}>
        追加
      </button>
    );
  }
  return (
    <span className="stepper">
      <button onClick={() => onChange(-1)} aria-label={`${name}を1つ減らす`}>−</button>
      <output aria-label={`${name}の数量`}>{qty}</output>
      <button onClick={() => onChange(1)} aria-label={`${name}を1つ増やす`}>＋</button>
    </span>
  );
}

// ---------------------------------------------------------------- 状況確認画面

function Tracking({ initial, onNew }: { initial: Order; onNew: () => void }) {
  const [order, setOrder] = useState(initial);
  const [pollError, setPollError] = useState(false);

  useEffect(() => {
    if (order.status === 'READY') return; // 完成で終端。ポーリング停止
    const t = setInterval(async () => {
      try {
        setOrder(await api.get<Order>(`/orders/${initial.id}`));
        setPollError(false);
      } catch {
        setPollError(true); // 通信エラーは表示して再試行を続ける
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [initial.id, order.status]);

  const ready = order.status === 'READY';
  const stepIndex = STEPS.indexOf(order.status);

  return (
    <main className="tracking">
      <p className="label">呼出番号</p>
      <p className="callno" data-testid="call-number">{order.call_number}</p>
      <p className={`status ${ready ? 'ready' : ''}`} data-testid="status" data-status={order.status}>
        {STATUS_LABEL[order.status]}
      </p>
      {ready && <p className="ready-note">できあがりました。呼出番号でお受け取りください。</p>}
      {pollError && <p className="error" role="alert">通信できません。再試行しています…</p>}

      <ol className="steps" aria-label="調理状況">
        {STEPS.map((s, i) => (
          <li key={s} className={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}>
            {STATUS_LABEL[s]}
          </li>
        ))}
      </ol>

      <section className="receipt">
        <h2>ご注文内容</h2>
        <ul>
          {order.lines.map((l) => (
            <li key={l.menu_item_id}>
              <span>{l.name} × {l.qty}</span>
              <span>{yen(l.unit_price * l.qty)}</span>
            </li>
          ))}
        </ul>
        <p className="total"><span>合計</span><b>{yen(order.total)}</b></p>
      </section>

      <button className="secondary" onClick={onNew} data-testid="new-order">
        {ready ? '新しい注文をする' : '別の注文をする'}
      </button>
    </main>
  );
}
