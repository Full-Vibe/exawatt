import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { DelegationMonitor } from './delegation-monitor';
import type { HarnessEvent } from './delegation-state';

/**
 * The monitor is the single publisher of reported delegation (ENG-015 S1.1
 * review). Surfaces must never re-derive what is worth showing.
 */
function harness() {
  const channel = new EventEmitter();
  const manager = new EventEmitter();
  const monitor = new DelegationMonitor();
  monitor.attach(
    channel as unknown as Parameters<DelegationMonitor['attach']>[0],
    manager as unknown as Parameters<DelegationMonitor['attach']>[1]
  );
  const published: Array<unknown> = [];
  monitor.on('delegation', (_id: string, value: unknown) =>
    published.push(value)
  );
  const send = (event: HarnessEvent) => channel.emit('event', 'pty-1', event);
  return { monitor, manager, published, send };
}

describe('DelegationMonitor publication', () => {
  it('publishes a live turn and withdraws it when the Session settles', () => {
    const { monitor, published, send } = harness();
    send({ kind: 'turn-start' });
    expect(published[0]).toMatchObject({ ownTurn: 'generating' });
    expect(monitor.getLive('pty-1')).toMatchObject({ ownTurn: 'generating' });

    send({ kind: 'turn-end' });
    // Withdrawn, not "available with no children": a settled Session hands the
    // question back to inference on every surface at once.
    expect(published[1]).toBeNull();
    expect(monitor.getLive('pty-1')).toBeNull();
    // internal truth is retained, because attention rules still read it
    expect(monitor.get('pty-1')).toMatchObject({ ownTurn: 'available' });
  });

  it('keeps publishing while children outlive the parent turn', () => {
    const { monitor, published, send } = harness();
    send({ kind: 'turn-start' });
    send({
      kind: 'child-start',
      childId: 'a1',
      agentType: 'Explore',
      at: 1_000,
    });
    send({ kind: 'turn-end' });
    expect(monitor.getLive('pty-1')).toMatchObject({
      ownTurn: 'available',
      children: [{ id: 'a1' }],
    });
    expect(published[published.length - 1]).not.toBeNull();

    send({ kind: 'child-end', childId: 'a1' });
    expect(published[published.length - 1]).toBeNull();
    expect(monitor.getLive('pty-1')).toBeNull();
  });

  it('withdraws failed protocol observation without claiming completion', () => {
    const { monitor, published, send } = harness();
    const lifecycle: HarnessEvent[] = [];
    monitor.on('harness-event', (_id: string, event: HarnessEvent) =>
      lifecycle.push(event)
    );
    send({
      kind: 'child-start',
      childId: 'codex-child',
      agentType: 'Codex',
      at: 1,
    });
    monitor.clearReportedChildren('pty-1');

    expect(published[published.length - 1]).toBeNull();
    expect(monitor.getLive('pty-1')).toBeNull();
    expect(lifecycle).toEqual([
      expect.objectContaining({ kind: 'child-start' }),
    ]);
  });

  it('atomically replaces a census without a transient completed result', () => {
    const { monitor, send } = harness();
    send({ kind: 'child-start', childId: 'old', agentType: 'Codex', at: 1 });
    const busyAtCompletion: boolean[] = [];
    monitor.on('harness-event', (_id, event: HarnessEvent) => {
      if (event.kind === 'child-end')
        busyAtCompletion.push(monitor.isBusy('pty-1'));
    });
    const children = [
      { id: 'new', agentType: 'Codex', description: null, startedAt: 2 },
    ];
    monitor.reconcileReportedChildren('pty-1', children, ['old']);
    expect(busyAtCompletion).toEqual([true]);
    const projection = monitor.getLive('pty-1');
    monitor.reconcileReportedChildren(
      'pty-1',
      children.map(child => ({ ...child })),
      ['old']
    );
    expect(monitor.getLive('pty-1')).toBe(projection);
  });

  it('accepts a current census over delta tombstones but never revives a dropped Session', () => {
    const { monitor, send } = harness();
    send({ kind: 'child-end', childId: 'resumed' });
    const children = [
      { id: 'resumed', agentType: 'Codex', description: null, startedAt: 1 },
    ];
    monitor.reconcileReportedChildren('pty-1', children);
    expect(monitor.isBusy('pty-1')).toBe(true);
    monitor.drop('pty-1');
    monitor.reconcileReportedChildren('pty-1', children);
    expect(monitor.getLive('pty-1')).toBeNull();
  });

  it('broadcasts nothing for a label-only change, and never the staging list', () => {
    const { monitor, published, send } = harness();
    send({ kind: 'turn-start' });
    const broadcasts = published.length;
    // A staged spawn label (D3a) is main-process bookkeeping. Nothing an
    // operator can see changed, so nothing may be broadcast.
    send({
      kind: 'child-label',
      toolUseId: 't1',
      agentType: 'Explore',
      description: 'Map the Sessions tab',
      at: 1,
    });
    expect(published.length).toBe(broadcasts);
    expect(monitor.getLive('pty-1')).not.toHaveProperty('pending');

    // The adopted label rides the child, which IS visible.
    send({ kind: 'child-start', childId: 'a1', agentType: 'Explore', at: 2 });
    const latest = published[published.length - 1] as {
      children: Array<{ description: string | null }>;
    };
    expect(latest.children[0].description).toBe('Map the Sessions tab');
    expect(latest).not.toHaveProperty('pending');
  });

  it('keeps an unchanged published reference across label-only edits', () => {
    const { monitor, send } = harness();
    send({ kind: 'turn-start' });
    const before = monitor.getLive('pty-1');
    send({
      kind: 'child-label',
      toolUseId: 't1',
      agentType: 'Explore',
      description: 'Map the Sessions tab',
      at: 1,
    });
    expect(monitor.getLive('pty-1')).toBe(before);
  });

  it('withdraws everything when the Session exits', () => {
    const { monitor, manager, published, send } = harness();
    send({ kind: 'turn-start' });
    manager.emit('exit', 'pty-1');
    expect(published[published.length - 1]).toBeNull();
    expect(monitor.get('pty-1')).toBeNull();
    expect(monitor.isBusy('pty-1')).toBe(false);
  });

  it('ignores stragglers that land after the Session dropped', () => {
    // A hook POST is an in-flight HTTP request; a kill mid-turn can land
    // events after `exit`. They must not recreate state nothing will clean.
    const { monitor, manager, send } = harness();
    send({ kind: 'turn-start' });
    manager.emit('exit', 'pty-1');
    send({ kind: 'turn-start' });
    send({ kind: 'child-start', childId: 'a1', agentType: 'Explore', at: 1 });
    expect(monitor.get('pty-1')).toBeNull();
    expect(monitor.isBusy('pty-1')).toBe(false);
  });

  it('drops a never-published Session silently', () => {
    // A ledger holding only staged labels was never visible; withdrawing it
    // would broadcast a null for a Session no surface has heard of.
    const { manager, published, send } = harness();
    send({
      kind: 'child-label',
      toolUseId: 't1',
      agentType: 'Explore',
      description: 'Staged only',
      at: 1,
    });
    manager.emit('exit', 'pty-1');
    expect(published).toEqual([]);
  });
});

/**
 * The census contract shared by every source (ENG-023 D5/D7): Codex's poll
 * and Claude Code's boundary payloads enter the same reconcile, and inference
 * withdraws through it too.
 */
describe('DelegationMonitor census', () => {
  it('reclaims a stale report as ONE publication: turn closed, children withdrawn, nothing completed', () => {
    const { monitor, published, send } = harness();
    const lifecycle: HarnessEvent[] = [];
    monitor.on('harness-event', (_id: string, event: HarnessEvent) =>
      lifecycle.push(event)
    );
    send({ kind: 'turn-start' });
    send({ kind: 'child-start', childId: 'c1', agentType: 'Explore', at: 1 });
    send({ kind: 'child-start', childId: 'c2', agentType: null, at: 2 });
    const broadcasts = published.length;
    const reclaimed = monitor.reclaimStaleReport('pty-1', 9_000);
    expect(reclaimed.ownTurn).toBe('generating');
    expect(reclaimed.withdrawn.map(child => child.id)).toEqual(['c1', 'c2']);
    expect(published.length).toBe(broadcasts + 1);
    expect(published[published.length - 1]).toBeNull();
    expect(monitor.get('pty-1')).toMatchObject({
      ownTurn: 'available',
      children: [],
    });
    expect(lifecycle.filter(event => event.kind === 'child-end')).toEqual([]);
  });

  it('reclaiming an unreported Session is inert', () => {
    const { monitor, published } = harness();
    expect(monitor.reclaimStaleReport('pty-1', 1)).toEqual({
      ownTurn: null,
      withdrawn: [],
    });
    expect(published).toEqual([]);
  });

  it('applies a boundary census before the boundary reaches subscribers', () => {
    // A subscriber reacting to `turn-end` must read the census that same
    // payload carried, or it would withhold a result against children the
    // harness had just said were gone — and admit none it had just named.
    const { monitor, send } = harness();
    send({ kind: 'turn-start' });
    send({ kind: 'child-start', childId: 'gone', agentType: null, at: 1 });
    const seen: Array<{ kind: string; busy: boolean; children: string[] }> = [];
    monitor.on('harness-event', (id: string, event: HarnessEvent) =>
      seen.push({
        kind: event.kind,
        busy: monitor.isBusy(id),
        children: monitor.get(id)?.children.map(child => child.id) ?? [],
      })
    );
    send({
      kind: 'turn-end',
      census: {
        live: [
          {
            id: 'named',
            agentType: 'Explore',
            description: null,
            startedAt: null,
          },
        ],
        completed: [],
        at: 2,
      },
    });
    expect(seen).toEqual([
      { kind: 'child-start', busy: true, children: ['named'] },
      { kind: 'turn-end', busy: true, children: ['named'] },
    ]);
  });

  it('does not report the child a child-end boundary already reported twice', () => {
    const { monitor, send } = harness();
    send({ kind: 'child-start', childId: 'c1', agentType: null, at: 1 });
    const ends: string[] = [];
    monitor.on('harness-event', (_id: string, event: HarnessEvent) => {
      if (event.kind === 'child-end') ends.push(event.childId);
    });
    send({
      kind: 'child-end',
      childId: 'c1',
      census: { live: [], completed: ['c1'], at: 2 },
    });
    expect(ends).toEqual(['c1']);
  });
});

it('withdraws a background task census on process exit and rejects late reports', () => {
  const { monitor, manager, send } = harness();
  const event = {
    kind: 'turn-end' as const,
    census: {
      live: [],
      completed: [],
      at: 1,
      backgroundTasks: [{ id: 'monitor', type: 'monitor' }],
    },
  };
  send(event);
  expect(monitor.isBusy('pty-1')).toBe(true);
  const projection = monitor.getLive('pty-1');
  send(event);
  expect(monitor.getLive('pty-1')).toBe(projection);
  manager.emit('exit', 'pty-1');
  send(event);
  expect(monitor.get('pty-1')).toBeNull();
  expect(monitor.isBusy('pty-1')).toBe(false);
});
