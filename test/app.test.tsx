// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
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

const EMPTY_STATE: StateResponse = {
  counts: { active: 0, unreviewed: 0, archived: 0, pinned: 0 },
  stale: 0,
  facets: { types: {}, sources: {}, scopes: {}, tags: {} },
  inbox: [],
  memories: [],
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
  it('renders the vault overview with counts from the api', async () => {
    window.location.hash = '#/vault';
    render(<App />);
    expect(screen.getByText('engram')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('active memories')).toBeTruthy());
    expect(screen.getByText('awaiting review')).toBeTruthy();
    expect(screen.getByText('Michael prefers TypeScript for new projects')).toBeTruthy();
    expect(document.querySelector('.v-nav-badge')?.textContent).toBe('1');
  });

  it('lands on the explainer for an empty vault', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => EMPTY_STATE,
      })),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText('The loop')).toBeTruthy());
    expect(window.location.hash === '' || window.location.hash === '#/').toBe(true);
    expect(screen.getByText(/One memory\./)).toBeTruthy();
  });

  it('shows the landing page at #/', async () => {
    window.location.hash = '#/';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => EMPTY_STATE,
      })),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText('Connect a tool')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Open vault' })).toBeTruthy();
  });

  it('keeps the landing page reachable when the vault has memories', async () => {
    window.location.hash = '#/';
    render(<App />);
    await waitFor(() => expect(screen.getByText('What it is')).toBeTruthy());
    expect(window.location.hash === '' || window.location.hash === '#/').toBe(true);
  });

  it('routes to the review inbox via the hash', async () => {
    window.location.hash = '#/vault/inbox';
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review inbox' })).toBeTruthy());
    expect(screen.getByText('Agent scribble awaiting review')).toBeTruthy();
    expect(screen.getAllByText('Approve').length).toBeGreaterThan(0);
    expect(document.querySelector('.v-kbd-bar')).toBeTruthy();
  });

  it('routes to memories and shows scope badges', async () => {
    window.location.hash = '#/vault/memories';
    render(<App />);
    await waitFor(() => expect(document.querySelector('.v-tag-scope')?.textContent).toBe('@acme-api'));
  });
});
