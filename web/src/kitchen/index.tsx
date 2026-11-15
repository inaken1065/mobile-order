// UB(厨房)の画面。B0 のスケルトン: 注文一覧を2秒ごとに表示するだけ。B2 が本実装に置き換える。
import { useEffect, useState } from 'react';
import type { Order } from '../../../contracts/types';
import { api } from '../shared/api';

export default function Kitchen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () =>
      api.get<{ orders: Order[] }>('/kitchen/orders').then(
        (r) => (setOrders(r.orders), setError('')),
        (e) => setError(String(e)),
      );
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1>注文一覧(厨房)</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {orders.map((o) => (
          <li key={o.id} data-testid="order" style={{ margin: '8px 0', padding: 8, border: '1px solid #ccc' }}>
            <b>#{o.call_number}</b> [{o.status}] {o.lines.map((l) => `${l.name}×${l.qty}`).join(', ')}
          </li>
        ))}
      </ul>
    </main>
  );
}
