// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/app/App';
import type { StateResponse } from '../src/ui/app/types';

const STATE: StateResponse = {
  counts: { active: 2, unreviewed: 1, archived: 0, pinned: 1 },
  stale: 0,
  facets: {
    types: { fact: 2, preference: 1 },
    sources: { cli: 2, 'claude-code': 1 },
    scopes: { 'acme-api': 1 },
    tags: { tooling: 1 },
  },
  inbox: [
    {
      id: '20260713-agent-scribble',
      type: 'fact',
      tags: [],
      source: 'claude-code',
      status: 'unreviewed',
      pinned: false,
      created: '2026-07-13T00:00:00.000Z',
      updated: '2026-07-13T00:00:00.000Z',
      lastConfirmed: '2026-07-13T00:00:00.000Z',
      body: 'Agent scribble awaiting review',
      conflicts: [],
    },
  ],
  memories: [
    {
      id: '20260713-prefers-typescript',
      type: 'preference',
      tags: ['tooling'],
      source: 'cli',
      status: 'active',
      pinned: true,
      scope: 'acme-api',
      created: '2026-07-13T00:00:00.000Z',
      updated: '2026-07-13T00:00:00.000Z',
      lastConfirmed: '2026-07-13T00:00:00.000Z',
      body: 'Michael prefers TypeScript for new projects',
    },
  ],
};

beforeEach(() => {
  window.location.hash = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => STATE,
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('web app', () => {
  it('renders the dashboard with counts from the api', async () => {
    render(<App />);
    expect(screen.getByText('engram')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('active memories')).toBeTruthy());
    expect(screen.getByText('awaiting review')).toBeTruthy();
    expect(screen.getByText('Michael prefers TypeScript for new projects')).toBeTruthy();
    // The inbox nav badge shows the unreviewed count.
    expect(document.querySelector('.nav-badge')?.textContent).toBe('1');
  });

  it('routes to the review inbox via the hash', async () => {
    window.location.hash = '#/inbox';
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review inbox' })).toBeTruthy());
    expect(screen.getByText('Agent scribble awaiting review')).toBeTruthy();
    expect(screen.getAllByText('✓ approve').length).toBeGreaterThan(0);
  });

  it('routes to memories and shows scope badges', async () => {
    window.location.hash = '#/memories';
    render(<App />);
    await waitFor(() => expect(document.querySelector('.badge-scope')?.textContent).toBe('@acme-api'));
  });
});
