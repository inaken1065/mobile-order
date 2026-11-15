import { useCallback, useEffect, useState } from 'react';
import type { DailySales } from '../../../contracts/types';
import { api } from '../shared/api';
import { shiftDate, todayJst, yen } from './format';

export default function SalesPanel() {
  const [date, setDate] = useState(todayJst);
  const [sales, setSales] = useState<DailySales | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      setSales(await api.get<DailySales>(`/manager/sales/daily?date=${encodeURIComponent(d)}`));
      setError('');
    } catch (e) {
      setSales(null);
      setError(`売上を取得できませんでした: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) void load(date);
  }, [date, load]);

  return (
    <section aria-label="日次売上">
      <div className="mgr-datebar">
        <button onClick={() => setDate(shiftDate(date, -1))} aria-label="前の日">‹</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="売上日" />
        <button onClick={() => setDate(shiftDate(date, 1))} aria-label="次の日">›</button>
        <button onClick={() => setDate(todayJst())}>今日</button>
        <button onClick={() => load(date)} disabled={loading}>更新</button>
      </div>

      {error && <p className="mgr-error" role="alert">{error}</p>}
      {loading && !sales && <p>読み込み中…</p>}

      {sales && (
        <>
          <div className="mgr-cards" data-testid="sales-summary">
            <div className="mgr-card">
              <span className="mgr-card-label">売上合計</span>
              <span className="mgr-card-value" data-testid="sales-total">{yen(sales.total)}</span>
            </div>
            <div className="mgr-card">
              <span className="mgr-card-label">完成した注文</span>
              <span className="mgr-card-value" data-testid="sales-count">{sales.order_count} 件</span>
            </div>
          </div>
          <p className="mgr-hint">完成(READY)した注文のみ、完成日({sales.date})で集計しています。</p>

          {sales.items.length === 0 ? (
            <p>この日の売上はありません。</p>
          ) : (
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>商品</th>
                  <th className="num">数量</th>
                  <th className="num">金額</th>
                </tr>
              </thead>
              <tbody>
                {sales.items.map((i) => (
                  <tr key={i.menu_item_id} data-testid="sales-item">
                    <td>{i.name}</td>
                    <td className="num">{i.qty}</td>
                    <td className="num">{yen(i.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>合計</th>
                  <th className="num">{sales.items.reduce((a, i) => a + i.qty, 0)}</th>
                  <th className="num">{yen(sales.items.reduce((a, i) => a + i.amount, 0))}</th>
                </tr>
              </tfoot>
            </table>
          )}
        </>
      )}
    </section>
  );
}
