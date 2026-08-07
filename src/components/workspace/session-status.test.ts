import { describe, expect, it } from 'vitest';
import {
  attentionJumpQueue,
  attentionNeedsOperator,
  paintsAttention,
  delegationCopy,
  delegationElapsedLabel,
  delegationRailRows,
  mergeSessionAttentionMaps,
  mergeSessionAttentionSignals,
  orderedAttentionTargets,
  SESSION_GLYPH_COPY,
  sessionDelegationBusy,
  sessionGlyphCopy,
  sessionGlyphState,
  sessionStatusLightState,
} from './session-status';

describe('sessionStatusLightState', () => {
  it('distinguishes results from human gates without replacing Session truth', () => {
    expect(sessionStatusLightState({ state: 'fresh' })).toBe('off');
    expect(sessionStatusLightState({ state: 'quiet' })).toBe('off');
    expect(sessionStatusLightState({ state: 'working' })).toBe('active');
    expect(sessionStatusLightState({ state: 'done' })).toBe('result');
    expect(
      sessionStatusLightState({
        state: 'done',
        attention: { kind: 'turn-end', since: 1 },
      })
    ).toBe('result');
    expect(
      sessionStatusLightState({
        state: 'working',
        attention: { kind: 'bell', since: 1 },
      })
    ).toBe('needs-you');
    expect(
      sessionStatusLightState({
        state: 'done',
        attention: { kind: 'roadmap-blocked', since: 1 },
      })
    ).toBe('needs-you');
    expect(sessionStatusLightState({ state: 'working', fault: true })).toBe(
      'fault'
    );
  });

  it('puts only visible human gates into the attention queue', () => {
    expect(attentionNeedsOperator(null)).toBe(false);
    expect(attentionNeedsOperator({ kind: 'turn-end' })).toBe(false);
    expect(attentionNeedsOperator({ kind: 'bell' })).toBe(true);
    expect(attentionNeedsOperator({ kind: 'roadmap-blocked' })).toBe(true);
    expect(attentionNeedsOperator({})).toBe(true);
  });

  it('keeps an operator gate visible when a quiet result arrives too', () => {
    expect(
      mergeSessionAttentionSignals(
        { kind: 'turn-end', since: 20 },
        { kind: 'roadmap-blocked', since: 10 }
      )
    ).toEqual({ kind: 'roadmap-blocked', since: 10 });
    expect(
      mergeSessionAttentionSignals(
        { kind: 'turn-end', since: 20 },
        { kind: 'bell', since: 30 }
      )
    ).toEqual({ kind: 'bell', since: 30 });
    expect(
      mergeSessionAttentionMaps(
        { shared: { kind: 'turn-end', since: 20 } },
        { shared: { kind: 'roadmap-blocked', since: 10 } }
      )
    ).toEqual({ shared: { kind: 'roadmap-blocked', since: 10 } });
  });

  it('orders only visible operator targets and skips the active Session', () => {
    expect(
      orderedAttentionTargets(
        {
          result: { kind: 'turn-end', since: 1 },
          active: { kind: 'bell', since: 2 },
          later: { kind: 'roadmap-blocked', since: 4 },
          earlier: { kind: 'bell', since: 3 },
        },
        'active'
      )
    ).toEqual(['earlier', 'later']);
  });
});

/**
 * Delegation in the shared derivation (ENG-023 D1). Every Session surface
 * reads this, so the rule lands in the strip, the overview, and the switcher
 * from one place.
 */
describe('delegated work', () => {
  const busyChild = {
    ownTurn: 'available' as const,
    children: [{ id: 'a1', agentType: 'Explore', startedAt: 1 }],
  };

  it('reads as working while children run, even with the parent quiet', () => {
    expect(
      sessionGlyphState({ working: false, agent: true, started: true })
    ).toBe('done');
    expect(
      sessionGlyphState({
        working: false,
        agent: true,
        started: true,
        delegatedBusy: true,
      })
    ).toBe('working');
  });

  it('never manufactures a ready result from a delegating Session', () => {
    const state = sessionGlyphState({
      working: false,
      agent: true,
      started: true,
      delegatedBusy: true,
    });
    expect(sessionStatusLightState({ state, attention: null })).toBe('active');
  });

  it('leaves needs-you and fault untouched — delegation is not an escalation', () => {
    const state = sessionGlyphState({
      working: false,
      agent: true,
      started: true,
      delegatedBusy: true,
    });
    expect(
      sessionStatusLightState({ state, attention: { kind: 'bell', since: 1 } })
    ).toBe('needs-you');
    expect(sessionStatusLightState({ state, fault: true })).toBe('fault');
  });

  it('defaults to unreported, so a source without the capability is unchanged', () => {
    expect(
      sessionGlyphState({ working: false, agent: true, started: true })
    ).toBe('done');
    expect(sessionDelegationBusy(null)).toBe(false);
    expect(sessionDelegationBusy(undefined)).toBe(false);
    expect(sessionDelegationBusy({ ownTurn: 'available', blockedOn: null, children: [] })).toBe(
      false
    );
  });

  it('explains a quiet delegating Session honestly', () => {
    // "output streaming" is the wrong reason for a Session that is quiet
    // precisely because it handed the work to someone else.
    expect(sessionGlyphCopy('working', busyChild)).toBe(
      'working — delegated agents running'
    );
    expect(sessionGlyphCopy('working', null)).toBe(
      'working — output streaming'
    );
    expect(sessionGlyphCopy('done', busyChild)).toBe(SESSION_GLYPH_COPY.done);
  });

  it('names the work, deduplicating kinds and pluralizing', () => {
    expect(delegationCopy(busyChild)).toBe(
      '1 delegated agent working — Explore'
    );
    expect(
      delegationCopy({
        ownTurn: 'available',
        children: [
          { id: 'a', agentType: 'Explore', startedAt: 1 },
          { id: 'b', agentType: 'Explore', startedAt: 2 },
          { id: 'c', agentType: 'general-purpose', startedAt: 3 },
        ],
      })
    ).toBe('3 delegated agents working — Explore, general-purpose');
  });

  it('still names the count when a source reports no kind', () => {
    expect(
      delegationCopy({
        ownTurn: 'available',
        children: [{ id: 'a', agentType: null, startedAt: 1 }],
      })
    ).toBe('1 delegated agent working');
    expect(delegationCopy(null)).toBeNull();
    expect(delegationCopy({ ownTurn: 'available', blockedOn: null, children: [] })).toBeNull();
  });
});

/**
 * Reported turn truth (ENG-015 S1.1). Measured on a real Session, byte
 * inference trailed the harness's own boundary by 6-7 s on every turn — long
 * enough to read "working" for an Agent that had provably finished. A source
 * that declares its boundary therefore outranks inference in BOTH directions,
 * while sources that report nothing keep the inferred behavior exactly.
 */
describe('reported turn truth', () => {
  const agent = { agent: true, started: true };

  it('is a no-op for every source that reports nothing', () => {
    // The full inference matrix must be untouched when ownTurn is undefined.
    expect(sessionGlyphState({ ...agent, working: true })).toBe('working');
    expect(sessionGlyphState({ ...agent, working: false })).toBe('done');
    expect(
      sessionGlyphState({ working: false, agent: true, started: false })
    ).toBe('fresh');
    expect(
      sessionGlyphState({ working: false, agent: false, started: true })
    ).toBe('quiet');
    expect(
      sessionGlyphState({ working: true, agent: false, started: true })
    ).toBe('working');
  });

  it('shows a reported turn as working even when the stream is silent', () => {
    // A turn can go quiet without ending — inference cannot tell those apart.
    expect(
      sessionGlyphState({ ...agent, working: false, ownTurn: 'generating' })
    ).toBe('working');
  });

  it('settles a reported turn end while bytes are still arriving', () => {
    // This is the measured 6-7s lie: the Agent has finished, the TUI is still
    // repainting, and the strip claimed "working" the whole time.
    expect(
      sessionGlyphState({ ...agent, working: true, ownTurn: 'available' })
    ).toBe('done');
  });

  it('keeps the rest vocabulary intact under a reported turn', () => {
    expect(
      sessionGlyphState({
        working: true,
        agent: true,
        started: false,
        ownTurn: 'available',
      })
    ).toBe('fresh');
    expect(
      sessionGlyphState({
        working: true,
        agent: false,
        started: true,
        ownTurn: 'available',
      })
    ).toBe('quiet');
  });

  it('lets delegated children outrank a finished own turn', () => {
    // "If the team is working, they're working" (ENG-023) survives S1.1: the
    // parent's own turn ending is exactly the case delegation exists for.
    expect(
      sessionGlyphState({
        ...agent,
        working: false,
        ownTurn: 'available',
        delegatedBusy: true,
      })
    ).toBe('working');
  });

  it('projects a reported turn end into a ready result, not a gate', () => {
    const state = sessionGlyphState({
      ...agent,
      working: true,
      ownTurn: 'available',
    });
    expect(sessionStatusLightState({ state, attention: null })).toBe('result');
    expect(
      sessionStatusLightState({
        state,
        attention: { kind: 'turn-end', since: 1 },
      })
    ).toBe('result');
    // a real gate still wins over a finished turn
    expect(
      sessionStatusLightState({ state, attention: { kind: 'bell', since: 1 } })
    ).toBe('needs-you');
    expect(sessionStatusLightState({ state, fault: true })).toBe('fault');
  });
});

/**
 * The Sessions child rail projection (ENG-023 D3a). The row budget is a
 * constant: children arriving or finishing may change what the rows say,
 * never how much room the rail can take.
 */
describe('delegation rail rows', () => {
  const child = (id: string, description: string | null = null) => ({
    id,
    agentType: 'Explore',
    description,
    startedAt: 1_000,
  });

  it('shows every child when they fit the row budget', () => {
    const { rows, overflow } = delegationRailRows({
      ownTurn: 'available',
      blockedOn: null,
      children: [child('a', 'First'), child('b'), child('c', 'Third')],
    });
    expect(rows.map(row => row.key)).toEqual(['a', 'b', 'c']);
    expect(overflow).toBe(0);
  });

  it('summarizes past the budget instead of growing', () => {
    const { rows, overflow } = delegationRailRows({
      ownTurn: 'available',
      blockedOn: null,
      children: [child('a'), child('b'), child('c'), child('d'), child('e')],
    });
    // two labeled rows + the summary row = the same three-row footprint
    expect(rows).toHaveLength(2);
    expect(overflow).toBe(3);
  });

  it('projects nothing for absent or empty delegation', () => {
    expect(delegationRailRows(null).rows).toEqual([]);
    expect(delegationRailRows(undefined).overflow).toBe(0);
  });
});

describe('delegation elapsed labels', () => {
  it('renders minute granularity, never a stopwatch', () => {
    const start = 1_000_000;
    expect(delegationElapsedLabel(start + 30_000, start)).toBe('<1m');
    expect(delegationElapsedLabel(start + 3 * 60_000 + 19_000, start)).toBe('3m');
    expect(delegationElapsedLabel(start + 72 * 60_000, start)).toBe('1h 12m');
  });

  it('never goes negative on clock skew', () => {
    expect(delegationElapsedLabel(0, 5_000)).toBe('<1m');
  });
});

// ── BUG-009 (operator, 2026-08-07): "I see an orange needs-attention tab but
// cmd+j doesn't jump to it, it does nothing." The strip painted from
// `tabIsLive(tab)`; the jump queue filtered on `tab.exitCode === null`. One
// reconciliation branch sets resumeState 'live' AND a non-null exitCode for a
// session that exited while adopted, so that tab wore a marker ⌘J refused.
describe('attention eligibility is one rule (BUG-009)', () => {
  const bell = { kind: 'bell' as const, since: 10 };
  const older = { kind: 'bell' as const, since: 1 };

  it('paints exactly what the queue will visit', () => {
    const attention = { 's1': bell };
    const live = { sessionId: 's1', live: true };
    const dead = { sessionId: 's1', live: false };
    expect(paintsAttention(live, attention)).toBe(true);
    expect(paintsAttention(dead, attention)).toBe(false);
    expect(attentionJumpQueue([live], attention, null)).toEqual(['s1']);
    expect(attentionJumpQueue([dead], attention, null)).toEqual([]);
  });

  it('reaches a marked Session whose process already exited', () => {
    // the exact shape of the regression: adopted, still `live`, exit code set
    const attention = { 's1': bell };
    expect(
      attentionJumpQueue([{ sessionId: 's1', live: true }], attention, null)
    ).toEqual(['s1']);
  });

  it('never navigates to a Session carrying no visible marker', () => {
    const attention = { 's1': bell };
    // s2 has no signal at all; s3 is not live
    const queue = attentionJumpQueue(
      [
        { sessionId: 's1', live: true },
        { sessionId: 's2', live: true },
        { sessionId: 's3', live: false },
      ],
      attention,
      null
    );
    expect(queue).toEqual(['s1']);
  });

  it('keeps the oldest-first order and skips where you already are', () => {
    const attention = { 's1': bell, 's2': older };
    const candidates = [
      { sessionId: 's1', live: true },
      { sessionId: 's2', live: true },
    ];
    expect(attentionJumpQueue(candidates, attention, null)).toEqual([
      's2',
      's1',
    ]);
    expect(attentionJumpQueue(candidates, attention, 's2')).toEqual(['s1']);
  });

  it('a finished turn is a result to read, not an operator gate', () => {
    const attention = { 's1': { kind: 'turn-end' as const, since: 1 } };
    expect(
      attentionJumpQueue([{ sessionId: 's1', live: true }], attention, null)
    ).toEqual([]);
  });

  it('ignores a candidate with no session id', () => {
    expect(paintsAttention({ sessionId: null, live: true }, {})).toBe(false);
  });
});
