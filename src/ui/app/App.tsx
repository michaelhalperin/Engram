import { useCallback, useState } from 'react';
import { Toasts } from './components';
import { AppProvider, useApp, useRoute } from './lib';
import { AddMemory } from './views/AddMemory';
import { Dashboard } from './views/Dashboard';
import { Inbox } from './views/Inbox';
import { Memories } from './views/Memories';
import { MemoryDetail } from './views/MemoryDetail';
import { Profile } from './views/Profile';

const NAV = [
  { path: '', label: 'Dashboard', icon: '◉' },
  { path: 'memories', label: 'Memories', icon: '🗂' },
  { path: 'inbox', label: 'Review inbox', icon: '👁' },
  { path: 'profile', label: 'Profile', icon: '★' },
] as const;

function nextTheme(current: string | undefined): string | undefined {
  if (current === undefined) return 'dark';
  if (current === 'dark') return 'light';
  return undefined;
}

function Shell() {
  const { state, error } = useApp();
  const [route, navigate] = useRoute();
  const [adding, setAdding] = useState(false);
  const [, forceRender] = useState(0);

  const section = route[0]?.split('?')[0] ?? '';
  const detailId = section === 'memories' ? route[1] : undefined;

  const openMemory = useCallback((id: string) => navigate(`memories/${id}`), [navigate]);
  const closeDetail = useCallback(() => navigate('memories'), [navigate]);

  const toggleTheme = () => {
    const next = nextTheme(document.documentElement.dataset.theme);
    if (next === undefined) {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem('engram-theme');
    } else {
      document.documentElement.dataset.theme = next;
      localStorage.setItem('engram-theme', next);
    }
    forceRender((n) => n + 1);
  };

  const theme = document.documentElement.dataset.theme ?? 'auto';
  const inboxCount = state?.counts.unreviewed ?? 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="logo" href="#/">
          <span className="logo-dot">◉</span> engram
        </a>
        <nav>
          {NAV.map((item) => (
            <a
              key={item.path}
              className={`nav-item${section === item.path ? ' nav-active' : ''}`}
              href={`#/${item.path}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.path === 'inbox' && inboxCount > 0 && <span className="nav-badge">{inboxCount}</span>}
            </a>
          ))}
        </nav>
        <button className="primary add-button" onClick={() => setAdding(true)}>
          + Add memory
        </button>
        <div className="sidebar-foot">
          <button className="ghost" onClick={toggleTheme} title="Cycle theme">
            {theme === 'auto' ? '◐ auto' : theme === 'dark' ? '● dark' : '○ light'}
          </button>
          <span className="muted small">local only · 127.0.0.1</span>
        </div>
      </aside>

      <main className="main">
        {error && <div className="error-banner">engram server unreachable: {error}</div>}
        {section === '' && <Dashboard onOpen={openMemory} />}
        {section === 'memories' && <Memories onOpen={openMemory} />}
        {section === 'inbox' && <Inbox onOpen={openMemory} />}
        {section === 'profile' && <Profile onOpen={openMemory} />}
      </main>

      {detailId && <MemoryDetail id={detailId} onClose={closeDetail} />}
      {adding && <AddMemory onClose={() => setAdding(false)} />}
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
