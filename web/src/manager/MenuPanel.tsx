import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { MenuItem } from '../../../contracts/types';
import { api } from '../shared/api';
import { yen } from './format';

interface FormValues {
  name: string;
  category: string;
  price: string;
  is_available: boolean;
}

const EMPTY: FormValues = { name: '', category: '', price: '', is_available: true };

function validate(v: FormValues): string | null {
  if (v.name.trim() === '') return '商品名を入力してください';
  if (v.category.trim() === '') return 'カテゴリを入力してください';
  if (!/^\d+$/.test(v.price.trim())) return '価格は 0 以上の整数(円)で入力してください';
  return null;
}

function MenuForm(props: {
  title: string;
  initial: FormValues;
  categories: string[];
  submitLabel: string;
  busy: boolean;
  onSubmit: (v: FormValues) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(props.initial);
  const [localError, setLocalError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate(v);
    setLocalError(err ?? '');
    if (!err) props.onSubmit(v);
  };

  return (
    <form className="mgr-form" onSubmit={submit} aria-label={props.title}>
      <h2>{props.title}</h2>
      <label>
        商品名
        <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </label>
      <label>
        カテゴリ
        <input list="mgr-categories" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
        <datalist id="mgr-categories">
          {props.categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label>
        価格(円)
        <input inputMode="numeric" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
      </label>
      <label className="mgr-check">
        <input type="checkbox" checked={v.is_available} onChange={(e) => setV({ ...v, is_available: e.target.checked })} />
        販売中(外すと売り切れ)
      </label>
      {localError && <p className="mgr-error" role="alert">{localError}</p>}
      <div className="mgr-actions">
        <button type="submit" className="primary" disabled={props.busy}>{props.submitLabel}</button>
        {props.onCancel && (
          <button type="button" onClick={props.onCancel} disabled={props.busy}>キャンセル</button>
        )}
      </div>
    </form>
  );
}

export default function MenuPanel() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0); // 追加フォームを保存後にリセットするため

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: MenuItem[] }>('/menu');
      setItems(r.items);
      setError('');
    } catch (e) {
      setError(`メニューを取得できませんでした: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const grouped = useMemo(
    () => categories.map((c) => ({ category: c, items: items.filter((i) => i.category === c) })),
    [categories, items],
  );

  /** 変更系の共通処理: 実行 → 再読込 → 結果表示 */
  const run = async (action: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    setNotice('');
    try {
      await action();
      setError('');
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const body = (v: FormValues) => ({
    name: v.name.trim(),
    category: v.category.trim(),
    price: Number(v.price.trim()),
    is_available: v.is_available,
  });

  const add = async (v: FormValues) => {
    if (await run(() => api.post<MenuItem>('/manager/menu', body(v)), `「${v.name.trim()}」を追加しました`)) {
      setFormKey((k) => k + 1);
    }
  };

  const save = async (id: number, v: FormValues) => {
    if (await run(() => api.put<MenuItem>(`/manager/menu/${id}`, body(v)), `「${v.name.trim()}」を保存しました`)) {
      setEditingId(null);
    }
  };

  const toggle = (item: MenuItem) =>
    run(
      () => api.patch<MenuItem>(`/manager/menu/${item.id}/availability`, { is_available: !item.is_available }),
      `「${item.name}」を${item.is_available ? '売り切れ' : '販売中'}にしました`,
    );

  return (
    <section aria-label="メニュー管理">
      {error && <p className="mgr-error" role="alert">{error}</p>}
      {notice && <p className="mgr-notice" role="status">{notice}</p>}

      <MenuForm
        key={formKey}
        title="メニューを追加"
        initial={EMPTY}
        categories={categories}
        submitLabel="追加する"
        busy={busy}
        onSubmit={add}
      />

      {!loaded && <p>読み込み中…</p>}
      {loaded && items.length === 0 && !error && <p>メニューがありません。上のフォームから追加してください。</p>}

      {grouped.map((g) => (
        <div key={g.category} className="mgr-category">
          <h2>{g.category}</h2>
          <ul className="mgr-list">
            {g.items.map((item) => (
              <li key={item.id} className={item.is_available ? '' : 'soldout'} data-testid="menu-item">
                {editingId === item.id ? (
                  <MenuForm
                    title={`「${item.name}」を編集`}
                    initial={{ name: item.name, category: item.category, price: String(item.price), is_available: item.is_available }}
                    categories={categories}
                    submitLabel="保存する"
                    busy={busy}
                    onSubmit={(v) => save(item.id, v)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="mgr-row">
                    <div className="mgr-info">
                      <span className="mgr-name">{item.name}</span>
                      <span className="mgr-price">{yen(item.price)}</span>
                    </div>
                    <div className="mgr-actions">
                      <button
                        className={item.is_available ? 'on' : 'off'}
                        aria-pressed={!item.is_available}
                        disabled={busy}
                        onClick={() => toggle(item)}
                        title="クリックで販売中 / 売り切れを切り替え"
                      >
                        {item.is_available ? '販売中' : '売り切れ'}
                      </button>
                      <button disabled={busy} onClick={() => setEditingId(item.id)}>編集</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
