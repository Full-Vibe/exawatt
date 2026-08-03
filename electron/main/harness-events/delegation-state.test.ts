import { describe, expect, it } from 'vitest';
import {
  applyHarnessEvent,
  delegationBusy,
  delegationIsLive,
  EMPTY_DELEGATION,
  EMPTY_LEDGER,
  type DelegationLedger,
} from './delegation-state';

/**
 * The two-fact model (ENG-023 D1). These tests pin the behavior that the whole
 * feature rests on: a parent's own turn and its team's work are separate, and
 * every transition survives repeated delivery.
 */

const reduce = (events: Parameters<typeof applyHarnessEvent>[1][]) =>
  events.reduce(applyHarnessEvent, EMPTY_LEDGER);

describe('delegation state', () => {
  it('keeps the parent available while its children work', () => {
    // The measured sequence: the parent finished its own turn 74s before its
    // child did. Both facts must be readable at once.
    const state = reduce([
      { kind: 'turn-start' },
      { kind: 'child-start', childId: 'a1', agentType: 'Explore', at: 1_000 },
      { kind: 'turn-end' },
    ]);
    expect(state.ownTurn).toBe('available');
    expect(delegationBusy(state)).toBe(true);
    expect(state.children).toEqual([
      { id: 'a1', agentType: 'Explore', description: null, startedAt: 1_000 },
    ]);
  });

  it('reopens the parent turn when a child returns its result', () => {
    const state = reduce([
      { kind: 'child-start', childId: 'a1', agentType: null, at: 1 },
      { kind: 'turn-end' },
      { kind: 'child-end', childId: 'a1' },
      // the returning child's notification is what opens the next turn
      { kind: 'turn-start' },
    ]);
    expect(state.ownTurn).toBe('generating');
    expect(delegationBusy(state)).toBe(false);
  });

  it('tracks concurrent children independently and in start order', () => {
    const state = reduce([
      { kind: 'child-start', childId: 'a1', agentType: 'Explore', at: 1 },
      { kind: 'child-start', childId: 'a2', agentType: 'general', at: 2 },
      { kind: 'child-start', childId: 'a3', agentType: 'Explore', at: 3 },
      { kind: 'child-end', childId: 'a2' },
    ]);
    expect(state.children.map(child => child.id)).toEqual(['a1', 'a3']);
  });

  it('is idempotent — repeated delivery never double-counts or resets timing', () => {
    const state = reduce([
      { kind: 'child-start', childId: 'a1', agentType: 'Explore', at: 1_000 },
      { kind: 'child-start', childId: 'a1', agentType: 'Explore', at: 9_000 },
      { kind: 'turn-start' },
      { kind: 'turn-start' },
    ]);
    expect(state.children).toHaveLength(1);
    // elapsed time an operator reads must not jump because a hook retried
    expect(state.children[0].startedAt).toBe(1_000);
  });

  it('ignores an end for a child it never saw start', () => {
    const state = reduce([
      { kind: 'child-start', childId: 'a1', agentType: null, at: 1 },
      { kind: 'child-end', childId: 'ghost' },
      { kind: 'child-end', childId: 'a1' },
      { kind: 'child-end', childId: 'a1' },
    ]);
    expect(state.children).toEqual([]);
    expect(delegationBusy(state)).toBe(false);
  });

  it('returns the same reference for a no-op so callers can skip a broadcast', () => {
    const start: DelegationLedger = applyHarnessEvent(EMPTY_LEDGER, {
      kind: 'turn-start',
    });
    expect(applyHarnessEvent(start, { kind: 'turn-start' })).toBe(start);
    expect(applyHarnessEvent(start, { kind: 'child-end', childId: 'x' })).toBe(
      start
    );
  });

  it('adopts a staged spawn label by agent type, oldest first (D3a)', () => {
    const state = reduce([
      { kind: 'turn-start' },
      {
        kind: 'child-label',
        toolUseId: 't1',
        agentType: 'Explore',
        description: 'Map the Sessions tab',
        at: 1,
      },
      {
        kind: 'child-label',
        toolUseId: 't2',
        agentType: 'general-purpose',
        description: 'Trace the fleet provider',
        at: 2,
      },
      // starts arrive out of label order — the type match must win over FIFO
      { kind: 'child-start', childId: 'g1', agentType: 'general-purpose', at: 3 },
      { kind: 'child-start', childId: 'e1', agentType: 'Explore', at: 4 },
    ]);
    expect(state.children).toEqual([
      {
        id: 'g1',
        agentType: 'general-purpose',
        description: 'Trace the fleet provider',
        startedAt: 3,
      },
      {
        id: 'e1',
        agentType: 'Explore',
        description: 'Map the Sessions tab',
        startedAt: 4,
      },
    ]);
    expect(state.pending).toEqual([]);
  });

  it('never invents a description when no label matches', () => {
    const state = reduce([
      {
        kind: 'child-label',
        toolUseId: 't1',
        agentType: 'Explore',
        description: 'Map the Sessions tab',
        at: 1,
      },
      // a typed child with a DIFFERENT type must not steal a typed label
      { kind: 'child-start', childId: 'c1', agentType: 'code-reviewer', at: 2 },
    ]);
    expect(state.children[0].description).toBeNull();
    // the unmatched label stays staged for the child it belongs to
    expect(state.pending).toHaveLength(1);
  });

  it('falls back to the oldest label when types are unknown', () => {
    const state = reduce([
      {
        kind: 'child-label',
        toolUseId: 't1',
        agentType: null,
        description: 'First task',
        at: 1,
      },
      { kind: 'child-start', childId: 'c1', agentType: 'Explore', at: 2 },
    ]);
    expect(state.children[0].description).toBe('First task');
  });

  it('dedupes labels by tool_use_id — hooks deliver at least once', () => {
    const label = {
      kind: 'child-label' as const,
      toolUseId: 't1',
      agentType: 'Explore',
      description: 'Map the Sessions tab',
      at: 1,
    };
    const once = reduce([label]);
    expect(applyHarnessEvent(once, label)).toBe(once);
  });

  it('clears staged labels at either turn boundary', () => {
    const staged = reduce([
      { kind: 'turn-start' },
      {
        kind: 'child-label',
        toolUseId: 't1',
        agentType: 'Explore',
        description: 'Stale label',
        at: 1,
      },
    ]);
    expect(applyHarnessEvent(staged, { kind: 'turn-end' }).pending).toEqual([]);
    // the next turn's first child must not inherit last turn's label
    const nextTurn = applyHarnessEvent(
      applyHarnessEvent(staged, { kind: 'turn-end' }),
      { kind: 'turn-start' }
    );
    const child = applyHarnessEvent(nextTurn, {
      kind: 'child-start',
      childId: 'c1',
      agentType: 'Explore',
      at: 5,
    });
    expect(child.children[0].description).toBeNull();
  });

  it('keeps published fields reference-stable on a label-only change', () => {
    // The monitor broadcasts on visible change; a staged label is invisible.
    const before = reduce([{ kind: 'turn-start' }]);
    const after = applyHarnessEvent(before, {
      kind: 'child-label',
      toolUseId: 't1',
      agentType: 'Explore',
      description: 'Map the Sessions tab',
      at: 1,
    });
    expect(after).not.toBe(before);
    expect(after.children).toBe(before.children);
    expect(after.ownTurn).toBe(before.ownTurn);
    expect(after.blockedOn).toBe(before.blockedOn);
  });

  it('reads unreported delegation as absent, never as zero', () => {
    // A Codex Session reports nothing. "No delegated work reported" and
    // "delegated nothing" must not be told apart by an empty count here —
    // the capability, not this state, is what makes that distinction.
    expect(delegationBusy(null)).toBe(false);
    expect(delegationBusy(undefined)).toBe(false);
  });
});

/**
 * One rule, one place (ENG-015 S1.1 review). This predicate briefly existed in
 * both the main process and the renderer and they drifted: main retained
 * settled records forever while the renderer dropped them, so after a turn
 * ended the ⌘K switcher answered "result ready" from the reported fact while
 * the tab strip answered "working" from inference.
 */
describe('what surfaces may see', () => {
  const child = {
    id: 'a1',
    agentType: 'Explore',
    description: null,
    startedAt: 1,
  };

  it('publishes a Session whose own turn is running', () => {
    expect(
      delegationIsLive({ ownTurn: 'generating', blockedOn: null, children: [] })
    ).toBe(true);
  });

  it('publishes a Session with delegated children, turn over or not', () => {
    expect(
      delegationIsLive({
        ownTurn: 'available',
        blockedOn: null,
        children: [child],
      })
    ).toBe(true);
    expect(
      delegationIsLive({
        ownTurn: 'generating',
        blockedOn: null,
        children: [child],
      })
    ).toBe(true);
  });

  it('publishes nothing once a Session has settled', () => {
    // This is the case that diverged. Both surfaces must return to inference
    // at the same instant rather than one holding a stale reported answer.
    expect(
      delegationIsLive({ ownTurn: 'available', blockedOn: null, children: [] })
    ).toBe(false);
    expect(delegationIsLive(EMPTY_DELEGATION)).toBe(false);
    expect(delegationIsLive(null)).toBe(false);
    expect(delegationIsLive(undefined)).toBe(false);
  });
});
