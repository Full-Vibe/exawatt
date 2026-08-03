import { describe, expect, it } from 'vitest';
import {
  applyHarnessEvent,
  delegationBusy,
  delegationIsLive,
  EMPTY_DELEGATION,
  type SessionDelegation,
} from './delegation-state';

/**
 * The two-fact model (ENG-023 D1). These tests pin the behavior that the whole
 * feature rests on: a parent's own turn and its team's work are separate, and
 * every transition survives repeated delivery.
 */

const reduce = (events: Parameters<typeof applyHarnessEvent>[1][]) =>
  events.reduce(applyHarnessEvent, EMPTY_DELEGATION);

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
      { id: 'a1', agentType: 'Explore', startedAt: 1_000 },
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
    const start: SessionDelegation = applyHarnessEvent(EMPTY_DELEGATION, {
      kind: 'turn-start',
    });
    expect(applyHarnessEvent(start, { kind: 'turn-start' })).toBe(start);
    expect(applyHarnessEvent(start, { kind: 'child-end', childId: 'x' })).toBe(
      start
    );
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
  const child = { id: 'a1', agentType: 'Explore', startedAt: 1 };

  it('publishes a Session whose own turn is running', () => {
    expect(delegationIsLive({ ownTurn: 'generating', children: [] })).toBe(
      true
    );
  });

  it('publishes a Session with delegated children, turn over or not', () => {
    expect(delegationIsLive({ ownTurn: 'available', children: [child] })).toBe(
      true
    );
    expect(delegationIsLive({ ownTurn: 'generating', children: [child] })).toBe(
      true
    );
  });

  it('publishes nothing once a Session has settled', () => {
    // This is the case that diverged. Both surfaces must return to inference
    // at the same instant rather than one holding a stale reported answer.
    expect(delegationIsLive({ ownTurn: 'available', children: [] })).toBe(
      false
    );
    expect(delegationIsLive(EMPTY_DELEGATION)).toBe(false);
    expect(delegationIsLive(null)).toBe(false);
    expect(delegationIsLive(undefined)).toBe(false);
  });
});
