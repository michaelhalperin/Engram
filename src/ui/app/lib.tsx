import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getState } from './api';
import { STALE_AFTER_DAYS, type Memory, type StateResponse } from './types';

// ---------- routing (hash: #/, #/vault/memories/<id>, …) ----------

export function parseHash(): string[] {
  return window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export function useRoute(): [string[], (path: string) => void] {
  const [route, setRoute] = useState<string[]>(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((path: string) => {
    window.location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\/+/, '')}`;
  }, []);
  return [route, navigate];
}

export function isLandingRoute(route: string[]): boolean {
  const root = route[0] ?? '';
  return root === '' || root === 'landing';
}

export function isVaultRoute(route: string[]): boolean {
  return route[0] === 'vault';
}

export function vaultSubroute(route: string[]): { section: string; detailId?: string } {
  const section = route[1]?.split('?')[0] ?? '';
  const detailId = section === 'memories' ? route[2] : undefined;
  return { section, detailId };
}

/** Map old hash paths (#/memories, #/about) to the new structure. */
export function legacyRouteTarget(route: string[]): string | null {
  const root = route[0] ?? '';
  if (root === 'about') return '';
  if (root === 'memories' || root === 'inbox' || root === 'profile') {
    const tail = route.slice(1).join('/');
    return `vault/${root}${tail ? `/${tail}` : ''}`;
  }
  return null;
}

export function cycleTheme(current: string | undefined): string | undefined {
  if (current === undefined) return 'dark';
  if (current === 'dark') return 'light';
  return undefined;
}

export function readTheme(): string {
  return document.documentElement.dataset.theme ?? 'auto';
}

export function applyTheme(next: string | undefined): void {
  if (next === undefined) {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem('engram-theme');
  } else {
    document.documentElement.dataset.theme = next;
    localStorage.setItem('engram-theme', next);
  }
}

// ---------- app context: vault state + toasts ----------

export interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'warn' | 'error';
  undo?: () => void;
}

interface AppContextValue {
  state: StateResponse | null;
  error: string | null;
  refresh: () => Promise<void>;
  toasts: Toast[];
  toast: (message: string, kind?: Toast['kind'], undo?: () => void) => void;
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const refresh = useCallback(async () => {
    try {
      setState(await getState());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: Toast['kind'] = 'ok', undo?: () => void) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, message, kind, undo }]);
      window.setTimeout(() => dismissToast(id), undo ? 8000 : 4000);
    },
    [dismissToast],
  );

  return (
    <AppContext.Provider value={{ state, error, refresh, toasts, toast, dismissToast }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp outside AppProvider');
  return value;
}

// ---------- small formatting helpers ----------

export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

const DAY_MS = 86_400_000;

export function staleMonths(memory: Memory): number | null {
  const confirmed = Date.parse(memory.lastConfirmed);
  if (!Number.isFinite(confirmed)) return null;
  const days = Math.floor((Date.now() - confirmed) / DAY_MS);
  return days > STALE_AFTER_DAYS ? Math.floor(days / 30) : null;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function totalMemories(counts: { active: number; unreviewed: number; archived: number }): number {
  return counts.active + counts.unreviewed + counts.archived;
}

export function vaultIsEmpty(state: StateResponse | null): boolean {
  return state !== null && totalMemories(state.counts) === 0;
}
