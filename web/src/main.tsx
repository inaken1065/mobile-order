// U0: Web シェル。Wave 1 中は読み取り専用。各ロールの画面は src/<role>/index.tsx の default export。
import { createRoot } from 'react-dom/client';
import Customer from './customer';
import Kitchen from './kitchen';
import Manager from './manager';

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/customer')) return <Customer />;
  if (path.startsWith('/kitchen')) return <Kitchen />;
  if (path.startsWith('/manager')) return <Manager />;
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1>Mobile Order</h1>
      <ul>
        <li><a href="/customer">客</a></li>
        <li><a href="/kitchen">厨房</a></li>
        <li><a href="/manager">店長</a></li>
      </ul>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
