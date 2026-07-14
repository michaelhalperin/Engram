import { useCallback, useEffect, useState } from 'react';
import { Toasts } from './components';
import {
  AppProvider,
  applyTheme,
  cycleTheme,
  isLandingRoute,
  isVaultRoute,
  legacyRouteTarget,
  readTheme,
  useApp,
  useRoute,
  vaultSubroute,
} from './lib';
import { AddMemory } from './views/AddMemory';
import { Dashboard } from './views/Dashboard';
import { Inbox } from './views/Inbox';
import { Landing } from './views/Landing';
import { Memories } from './views/Memories';
import { MemoryDetail } from './views/MemoryDetail';
import { Profile } from './views/Profile';

const VAULT_NAV = [
  { path: '', label: 'Overview', hint: 'Status' },
  { path: 'memories', label: 'Memories', hint: 'Catalog' },
  { path: 'inbox', label: 'Inbox', hint: 'Review' },
  { path: 'profile', label: 'Profile', hint: 'Pinned' },
] as const;

function themeLabel(theme: string): string {
  if (theme === 'dark') return 'Dark';
  if (theme === 'light') return 'Light';
  return 'System';
}

function VaultShell() {
  const { state, error } = useApp();
  const [route, navigate] = useRoute();
  const [adding, setAdding] = useState(false);
  const [, bump] = useState(0);

  const { section, detailId } = vaultSubroute(route);
  const openMemory = useCallback((id: string) => navigate(`vault/memories/${id}`), [navigate]);
  const closeDetail = useCallback(() => navigate('vault/memories'), [navigate]);

  const toggleTheme = () => {
    applyTheme(cycleTheme(document.documentElement.dataset.theme));
    bump((n) => n + 1);
  };

  const theme = readTheme();
  const inboxCount = state?.counts.unreviewed ?? 0;

  return (
    <div className="v-shell">
      <aside className="v-rail">
        <a className="v-brand" href="#/vault">
          <span className="v-brand-mark" aria-hidden="true" />
          <span className="v-brand-text">engram</span>
        </a>

        <nav className="v-nav" aria-label="Vault navigation">
          {VAULT_NAV.map((item) => (
            <a
              key={item.path}
              className={`v-nav-link${section === item.path ? ' v-nav-active' : ''}`}
              href={item.path ? `#/vault/${item.path}` : '#/vault'}
            >
              <span className="v-nav-hint">{item.hint}</span>
              <span className="v-nav-label">{item.label}</span>
              {item.path === 'inbox' && inboxCount > 0 && (
                <span className="v-nav-badge">{inboxCount}</span>
              )}
            </a>
          ))}
        </nav>

        <div className="v-rail-foot">
          <button className="v-btn v-btn-accent v-btn-block" onClick={() => setAdding(true)}>
            New memory
          </button>
          <div className="v-rail-meta">
            <a className="v-link-quiet" href="#/">
              Docs / landing
            </a>
            <button className="v-btn v-btn-ghost v-btn-sm" onClick={toggleTheme} aria-label="Cycle theme">
              {themeLabel(theme)}
            </button>
          </div>
        </div>
      </aside>

      <div className="v-workspace">
        <div className="v-workspace-bg" aria-hidden="true" />
        <main className="v-main">
          {error && <div className="v-alert">Server unreachable: {error}</div>}
          {section === '' && <Dashboard onOpen={openMemory} />}
          {section === 'memories' && <Memories onOpen={openMemory} />}
          {section === 'inbox' && <Inbox onOpen={openMemory} />}
          {section === 'profile' && <Profile onOpen={openMemory} />}
        </main>
      </div>

      {detailId && <MemoryDetail id={detailId} onClose={closeDetail} />}
      {adding && <AddMemory onClose={() => setAdding(false)} />}
      <Toasts />
    </div>
  );
}

function Router() {
  const [route, navigate] = useRoute();

  useEffect(() => {
    const legacy = legacyRouteTarget(route);
    if (legacy !== null) navigate(legacy);
  }, [route, navigate]);

  if (isLandingRoute(route)) {
    return (
      <>
        <Landing />
        <Toasts />
      </>
    );
  }

  if (isVaultRoute(route)) return <VaultShell />;

  return (
    <>
      <Landing />
      <Toasts />
    </>
  );
}

export function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
