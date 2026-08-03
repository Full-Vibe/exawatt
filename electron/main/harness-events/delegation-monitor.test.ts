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
});
