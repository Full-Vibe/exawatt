import { describe, expect, it, vi } from 'vitest';
import type { AgentSourceRegistrySnapshot } from '@exawatt/core';
import {
  DelegationObservations,
  type DelegationObservation,
} from './delegation-observation';

const complete: DelegationObservation = {
  state: 'complete',
  reason: null,
  version: '0.153.4',
  observedAt: 1,
};

describe('delegation observation coverage', () => {
  it('does not let a healthy root hide another root, and clears on exit', () => {
    const store = new DelegationObservations();
    store.report('codex', 'blind', {
      ...complete,
      state: 'unavailable',
      reason: 'unsupported',
    });
    store.report('codex', 'healthy', complete);
    expect(store.fact('codex')).toMatchObject({
      basis: 'observed',
      state: 'degraded',
    });
    expect(store.fact('codex')?.detail).toContain(complete.version);
    expect(store.fact('claude')).toBeNull();
    store.drop('blind');
    expect(store.fact('codex')?.state).toBe('ready');
    store.drop('healthy');
    expect(store.fact('codex')).toBeNull();
  });

  it('publishes transitions without broadcasting every poll and projects without changing launch truth', () => {
    const store = new DelegationObservations();
    const changed = vi.fn();
    store.on('changed', changed);
    store.report('codex', 'root', complete);
    store.report('codex', 'root', { ...complete, observedAt: 2 });
    expect(changed).toHaveBeenCalledTimes(1);
    const source = {
      adapterId: 'codex',
      state: 'ready',
      launchable: true,
      facts: {},
    };
    const snapshot = { sources: [source] } as AgentSourceRegistrySnapshot;
    expect(store.project(snapshot).sources[0]).toMatchObject({
      state: 'ready',
      launchable: true,
      facts: { delegation: { state: 'ready' } },
    });
    store.report('codex', 'root', {
      ...complete,
      state: 'unavailable',
      reason: 'read-failed',
    });
    expect(store.project(snapshot).sources[0]).toMatchObject({
      state: 'ready',
      launchable: true,
      facts: { delegation: { state: 'unavailable' } },
    });
    expect(source.facts).toEqual({});
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
