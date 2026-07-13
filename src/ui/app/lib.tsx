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

// ---------- routing (hash-based: #/inbox, #/memories/<id>, …) ----------

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

/** Months since last confirmed, when past the staleness threshold. */
export function staleMonths(memory: Memory): number | null {
  const confirmed = Date.parse(memory.lastConfirmed);
  if (!Number.isFinite(confirmed)) return null;
  const days = Math.floor((Date.now() - confirmed) / DAY_MS);
  return days > STALE_AFTER_DAYS ? Math.floor(days / 30) : null;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
