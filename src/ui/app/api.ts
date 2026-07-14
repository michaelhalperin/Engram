import type {
  DetailResponse,
  Memory,
  SemanticMapResponse,
  StateQuery,
  StateResponse,
  UiMemory,
} from './types';

/** The custom header forces a CORS preflight for cross-origin callers — the server's CSRF guard. */
const MUTATE_HEADERS = { 'x-engram': '1', 'content-type': 'application/json' };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export function getState(params: StateQuery = {}): Promise<StateResponse> {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  if (params.status) search.set('status', params.status);
  if (params.type) search.set('type', params.type);
  if (params.scope) search.set('scope', params.scope);
  if (params.tag) search.set('tag', params.tag);
  if (params.pinned) search.set('pinned', '1');
  const qs = search.toString();
  return request(`/api/state${qs ? `?${qs}` : ''}`);
}

export function getMemory(id: string): Promise<DetailResponse> {
  return request(`/api/memories/${id}`);
}

export function getProfile(): Promise<{ markdown: string; pinned: Memory[] }> {
  return request('/api/profile');
}

export function getSemanticMap(): Promise<SemanticMapResponse> {
  return request('/api/semantic-map');
}

export function createMemory(input: {
  text: string;
  type?: string;
  tags?: string;
  scope?: string;
  pinned?: boolean;
}): Promise<{ memory: Memory; existing: boolean; conflicts: Memory[] }> {
  return request('/api/memories', {
    method: 'POST',
    headers: MUTATE_HEADERS,
    body: JSON.stringify(input),
  });
}

export function patchMemory(
  id: string,
  patch: Partial<{
    text: string;
    type: string;
    tags: string;
    status: string;
    pinned: boolean;
    scope: string | null;
  }>,
): Promise<{ memory: Memory }> {
  return request(`/api/memories/${id}`, {
    method: 'PATCH',
    headers: MUTATE_HEADERS,
    body: JSON.stringify(patch),
  });
}

export function reviewAction(
  id: string,
  action: 'approve' | 'reject' | 'confirm',
): Promise<{ memory: Memory; restored?: Memory }> {
  return request(`/api/memories/${id}/${action}`, { method: 'POST', headers: MUTATE_HEADERS });
}

export function reviewBulk(
  action: 'approve' | 'reject',
  ids: string[],
): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }> }> {
  return request('/api/review/bulk', {
    method: 'POST',
    headers: MUTATE_HEADERS,
    body: JSON.stringify({ action, ids }),
  });
}

export function archiveMemory(id: string): Promise<{ memory: UiMemory }> {
  return request(`/api/memories/${id}`, { method: 'DELETE', headers: MUTATE_HEADERS });
}

export function hardDeleteMemory(id: string): Promise<{ deleted: string }> {
  return request(`/api/memories/${id}?hard=1`, { method: 'DELETE', headers: MUTATE_HEADERS });
}
