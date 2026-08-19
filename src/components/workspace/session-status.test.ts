import { describe, expect, it } from 'vitest';
import {
  attentionJumpQueue,
  attentionNeedsOperator,
  paintsAttention,
  delegationCopy,
  delegationElapsedLabel,
  delegationRailRows,
  attentionAt,
  fleetAttention,
  mergeAttention,
  mergeFleetAttention,
  mergeSessionAttentionSignals,
  NO_FLEET_ATTENTION,
  scopedAttention,
  orderedAttentionTargets,
  SESSION_GLYPH_COPY,
  sessionDelegationBusy,
  sessionGlyphCopy,
  sessionGlyphState,
  sessionLensTurnState,
  sessionStateWord,
  sessionStatusLightState,
  sessionTurnFacts,
  type SessionAttentionSignal,
  type SessionGlyphState,
} from './session-status';
import {
  AGENT_STATUS_LIGHT_STATE,
  STATUS_LIGHT_STATES,
  statusLightWord,
} from '@/components/status-light/protocol';

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
      mergeFleetAttention(
        fleetAttention('pty', { shared: { kind: 'turn-end', since: 20 } }),
        fleetAttention('roadmap', {
          shared: { kind: 'roadmap-blocked', since: 10 },
        })
      )
    ).toEqual({ shared: { kind: 'roadmap-blocked', since: 10 } });
  });

  it('orders only visible operator targets and skips the active Session', () => {
    expect(
      orderedAttentionTargets(
        mergeFleetAttention(
          fleetAttention('pty', {
            result: { kind: 'turn-end', since: 1 },
            active: { kind: 'bell', since: 2 },
            later: { kind: 'roadmap-blocked', since: 4 },
            earlier: { kind: 'bell', since: 3 },
          })
        ),
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
    expect(
      sessionDelegationBusy({
        ownTurn: 'available',
        blockedOn: null,
        children: [],
      })
    ).toBe(false);
  });

  it('explains a quiet delegating Session honestly', () => {
    // A generic "turn in progress" is true but incurious for a Session that
    // is quiet precisely because it handed the work to someone else.
    expect(sessionGlyphCopy('working', busyChild)).toBe(
      'working — delegated agents running'
    );
    // And the generic one never names a mechanism the operator can see is not
    // happening: the light is active for a silent reported-open turn too.
    expect(sessionGlyphCopy('working', null)).toBe(
      'working — turn in progress'
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
    expect(
      delegationCopy({ ownTurn: 'available', blockedOn: null, children: [] })
    ).toBeNull();
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
    expect(delegationElapsedLabel(start + 3 * 60_000 + 19_000, start)).toBe(
      '3m'
    );
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
  /** One producer, and it covers the fleet — the tests below are about
   *  eligibility, not coverage (that contract lives in its own block). */
  const fleet = (signals: Record<string, SessionAttentionSignal>) =>
    mergeFleetAttention(fleetAttention('pty', signals));

  it('paints exactly what the queue will visit', () => {
    const attention = fleet({ s1: bell });
    const live = { sessionId: 's1', live: true };
    const dead = { sessionId: 's1', live: false };
    expect(paintsAttention(live, attention)).toBe(true);
    expect(paintsAttention(dead, attention)).toBe(false);
    expect(attentionJumpQueue([live], attention, null)).toEqual(['s1']);
    expect(attentionJumpQueue([dead], attention, null)).toEqual([]);
  });

  it('reaches a marked Session whose process already exited', () => {
    // the exact shape of the regression: adopted, still `live`, exit code set
    const attention = fleet({ s1: bell });
    expect(
      attentionJumpQueue([{ sessionId: 's1', live: true }], attention, null)
    ).toEqual(['s1']);
  });

  it('never navigates to a Session carrying no visible marker', () => {
    const attention = fleet({ s1: bell });
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
    const attention = fleet({ s1: bell, s2: older });
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
    const attention = fleet({ s1: { kind: 'turn-end' as const, since: 1 } });
    expect(
      attentionJumpQueue([{ sessionId: 's1', live: true }], attention, null)
    ).toEqual([]);
  });

  it('ignores a candidate with no session id', () => {
    expect(
      paintsAttention({ sessionId: null, live: true }, NO_FLEET_ATTENTION)
    ).toBe(false);
  });
});

// ── BUG-026: one shared rule fed an INCOMPLETE map still lies. PTY attention
// was fleet-wide, roadmap attention was the active Project's lens only, and
// the merge could not express the difference — so a Session blocked in
// another Project came back from the map indistinguishable from a quiet one.
describe('a producer declares its scope (BUG-026)', () => {
  const blocked = { kind: 'roadmap-blocked' as const, since: 10 };
  // "the operator is standing in Project B": a producer that only looked at
  // B's Sessions. `a1` lives in Project A and is blocked, unseen.
  const narrow = scopedAttention('roadmap', { b1: blocked }, ['b1']);
  const pty = fleetAttention('pty', {});

  it('answers unknown outside a source scope, never quiet', () => {
    const view = mergeAttention(pty, narrow);
    expect(attentionAt(view, 'b1')).toEqual({ known: true, signal: blocked });
    expect(attentionAt(view, 'a1')).toEqual({
      known: false,
      unseenBy: ['roadmap'],
    });
  });

  it('narrows the whole view: one blind producer blinds the merge', () => {
    const view = mergeAttention(pty, narrow);
    expect(view.scope).toEqual({
      kind: 'sessions',
      sessionIds: new Set(['b1']),
    });
    // and coverage is the INTERSECTION, not the union
    const other = scopedAttention('other', {}, ['b1', 'c1']);
    expect(mergeAttention(narrow, other).scope).toEqual({
      kind: 'sessions',
      sessionIds: new Set(['b1']),
    });
  });

  it('cannot be merged as if it were complete', () => {
    // The whole prevention, in one line: a narrow producer has no way into
    // the map the strip, the Project dot and ⌘J paint from.
    // @ts-expect-error a scoped producer is not a fleet producer
    mergeFleetAttention(pty, narrow);
    // ...and a partial merge has no record form, so it cannot be handed to a
    // fleet-wide surface either.
    const view = mergeAttention(pty, narrow);
    // @ts-expect-error a partial view is not a proven-complete signal map
    paintsAttention({ sessionId: 'a1', live: true }, view);
    // @ts-expect-error same for the jump queue
    attentionJumpQueue([{ sessionId: 'a1', live: true }], view, null);
  });

  it('stays complete when every producer covers the fleet', () => {
    const view = mergeAttention(
      pty,
      fleetAttention('roadmap', { b1: blocked })
    );
    expect(view.scope).toEqual({ kind: 'fleet' });
    expect(attentionAt(view, 'a1')).toEqual({ known: true, signal: undefined });
    const signals = mergeFleetAttention(
      pty,
      fleetAttention('roadmap', { b1: blocked })
    );
    expect(
      attentionJumpQueue([{ sessionId: 'b1', live: true }], signals, null)
    ).toEqual(['b1']);
  });
});

/**
 * One composition, one collapse (BUG-008's surface half).
 *
 * Five surfaces used to assemble a Session's turn facts by hand, and the ones
 * that reached for the activity map alone are exactly the ones that lied.
 * These cases pin the shared composer and the lens projection built on it.
 */
describe('shared turn facts', () => {
  const tab = {
    sessionId: 's1',
    harness: 'claude',
    durableSessionId: 'd1',
  };
  const generating = {
    ownTurn: 'generating' as const,
    blockedOn: null,
    children: [],
  };
  const empty = {
    activity: {},
    engaged: {},
    summaries: {},
    delegation: {},
  };

  it('carries every channel, not just the bytes', () => {
    expect(
      sessionTurnFacts(tab, {
        ...empty,
        activity: { s1: true },
        engaged: { s1: true },
      })
    ).toEqual({
      working: true,
      agent: true,
      started: true,
      delegatedBusy: false,
      blocked: false,
      ownTurn: undefined,
    });

    // A silent Agent whose harness says the turn is open is WORKING, and a
    // goal subtitle counts as started for Sessions older than the engaged bit.
    const midTurn = sessionTurnFacts(tab, {
      ...empty,
      summaries: { d1: 'Wire the intake form' },
      delegation: { s1: generating },
    });
    expect(midTurn).toMatchObject({
      working: false,
      started: true,
      ownTurn: 'generating',
    });
    expect(sessionGlyphState(midTurn)).toBe('working');
  });

  it('reports a shell as a shell and an absent process as unstarted', () => {
    expect(sessionTurnFacts({ ...tab, harness: 'shell' }, empty).agent).toBe(
      false
    );
    expect(
      sessionTurnFacts(
        { ...tab, sessionId: null },
        { ...empty, activity: { s1: true } }
      )
    ).toMatchObject({ working: false, started: false });
  });

  it('collapses the five lights into the lens’s three by the same rules', () => {
    const lens = (
      sources: Parameters<typeof sessionTurnFacts>[1],
      attention?: SessionAttentionSignal
    ) =>
      sessionLensTurnState({
        facts: sessionTurnFacts(tab, sources),
        attention,
      });

    // The case the lens used to get wrong: mid-tool-call, no bytes, open turn.
    expect(lens({ ...empty, delegation: { s1: generating } })).toBe('working');
    // And the other one: a question the operator is looking at, so no unseen
    // attention signal exists to fall back on.
    expect(
      lens({
        ...empty,
        delegation: {
          s1: { ...generating, blockedOn: 'question' as const },
        },
      })
    ).toBe('needs-you');
    expect(lens({ ...empty, activity: { s1: true } })).toBe('working');
    expect(lens({ ...empty, engaged: { s1: true } })).toBe('waiting');
    expect(lens(empty, { kind: 'bell', since: 1 })).toBe('needs-you');
  });
});

describe('the D40 word (ENG-033 H2)', () => {
  const GLYPH_STATES: SessionGlyphState[] = [
    'working',
    'blocked',
    'done',
    'fresh',
    'quiet',
  ];

  it('gives every D40 signal exactly one operator-facing word', () => {
    const words = STATUS_LIGHT_STATES.map(statusLightWord);
    // Exhaustive by construction: STATUS_LIGHT_STATES is pinned to the union,
    // so a sixth signal fails to compile rather than rendering blank here.
    expect(words).toHaveLength(5);
    expect(new Set(words).size).toBe(5);
    for (const word of words) {
      expect(word.trim()).toBe(word);
      expect(word.length).toBeGreaterThan(0);
      // Product copy, not an enum: no screaming case, no punctuation smell.
      expect(word).not.toBe(word.toUpperCase());
      expect(word).not.toContain('—');
      expect(word).not.toMatch(/[_-]/);
    }
  });

  it('speaks the same words for a remote Agent status as for a local one', () => {
    // Every AgentStatus the roster can carry, local or remote, lands on a word.
    const spoken = Object.entries(AGENT_STATUS_LIGHT_STATE).map(
      ([status, light]) => [status, statusLightWord(light)] as const
    );
    expect(Object.fromEntries(spoken)).toEqual({
      idle: 'Idle',
      working: 'Working',
      reviewing: 'Working',
      complete: 'Result ready',
      blocked: 'Needs you',
      error: 'Error',
    });
  });

  it('derives every local state word from the projection the mark uses', () => {
    for (const state of GLYPH_STATES) {
      for (const attention of [
        undefined,
        { kind: 'bell', since: 1 } as const,
        { kind: 'turn-end', since: 1 } as const,
      ]) {
        for (const fault of [false, true]) {
          const input = { state, attention, fault };
          // One state in, one mark and one word out: the word is nothing but
          // the name of the light the same inputs draw.
          expect(sessionStateWord(input)).toBe(
            statusLightWord(sessionStatusLightState(input))
          );
        }
      }
    }
  });

  it('never renders a blank word for a state the local path can produce', () => {
    for (const state of GLYPH_STATES) {
      expect(sessionStateWord({ state })).toBeTruthy();
    }
    expect(sessionStateWord({ state: 'working' })).toBe('Working');
    expect(sessionStateWord({ state: 'blocked' })).toBe('Needs you');
    expect(sessionStateWord({ state: 'done' })).toBe('Result ready');
    expect(sessionStateWord({ state: 'fresh' })).toBe('Idle');
    expect(sessionStateWord({ state: 'quiet' })).toBe('Idle');
    expect(sessionStateWord({ state: 'working', fault: true })).toBe('Error');
  });

  it('reports the work state and never the connection state', () => {
    // A remote Agent whose connection has gone stale keeps the last work
    // state Exawatt saw. Freshness is a separate readout and must not leak
    // into this word.
    const lastKnown = sessionStateWord({ state: 'working' });
    expect(lastKnown).toBe('Working');
    for (const light of STATUS_LIGHT_STATES) {
      expect(statusLightWord(light)).not.toMatch(
        /stale|reconnect|unavailable|offline|disconnected/i
      );
    }
  });
});

describe('the local path and the unreported word (ENG-010)', () => {
  const GLYPH_STATES = [
    'working',
    'blocked',
    'done',
    'fresh',
    'quiet',
  ] as const;

  it('never says "Not reported" about a Session on this machine', () => {
    // A local Session is directly observed: Exawatt watches the PTY, so there
    // is always a report. The unreported word belongs to sources Exawatt only
    // hears from, and the local derivation must not be able to reach it.
    for (const state of GLYPH_STATES) {
      for (const attention of [
        undefined,
        { kind: 'bell', since: 1 } as const,
        { kind: 'turn-end', since: 1 } as const,
      ]) {
        for (const fault of [false, true]) {
          const word = sessionStateWord({ state, attention, fault });
          expect(word).not.toBe(statusLightWord('unreported'));
          expect(word).not.toMatch(/not reported/i);
        }
      }
    }
  });

  it('still reads a quiet local Session as idle', () => {
    expect(sessionStateWord({ state: 'quiet' })).toBe('Idle');
    expect(sessionStateWord({ state: 'fresh' })).toBe('Idle');
  });

  it('keeps the unreported word out of the five-signal vocabulary', () => {
    expect(STATUS_LIGHT_STATES.map(statusLightWord)).not.toContain(
      statusLightWord('unreported')
    );
  });
});
