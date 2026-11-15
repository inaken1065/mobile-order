// UC(店長)の画面: メニュー管理(追加・編集・価格変更・売り切れ)と日次売上。
import { useState } from 'react';
import './manager.css';
import MenuPanel from './MenuPanel';
import SalesPanel from './SalesPanel';

type Tab = 'menu' | 'sales';

export default function Manager() {
  const [tab, setTab] = useState<Tab>('menu');

  return (
    <main className="mgr">
      <header className="mgr-header">
        <h1>店長</h1>
        <nav className="mgr-tabs" role="tablist" aria-label="店長メニュー">
          <button role="tab" aria-selected={tab === 'menu'} className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>
            メニュー管理
          </button>
          <button role="tab" aria-selected={tab === 'sales'} className={tab === 'sales' ? 'active' : ''} onClick={() => setTab('sales')}>
            売上
          </button>
        </nav>
      </header>
      {tab === 'menu' ? <MenuPanel /> : <SalesPanel />}
    </main>
  );
}
