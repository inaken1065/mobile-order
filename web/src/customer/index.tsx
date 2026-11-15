// UA(客)の画面。B0 のスケルトン: メニューのボタン → POST /orders。B1 が本実装に置き換える。
import { useEffect, useState } from 'react';
import type { MenuItem, Order } from '../../../contracts/types';
import { api } from '../shared/api';

export default function Customer() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<{ items: MenuItem[] }>('/menu').then((r) => setItems(r.items), (e) => setError(String(e)));
  }, []);

  const order = async (item: MenuItem) => {
    setError('');
    try {
      setPlaced(await api.post<Order>('/orders', { lines: [{ menu_item_id: item.id, qty: 1 }] }));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1>メニュー(客)</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {placed && (
        <p data-testid="placed">
          注文を受け付けました。呼出番号 <b>{placed.call_number}</b>({placed.status})
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((i) => (
          <li key={i.id} style={{ margin: '8px 0' }}>
            {i.name} ¥{i.price}{' '}
            <button onClick={() => order(i)} disabled={!i.is_available}>
              {i.is_available ? '注文する' : '売り切れ'}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
