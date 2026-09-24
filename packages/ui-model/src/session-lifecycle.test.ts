import { describe, expect, it } from 'vitest';
import {
  agentsNoun,
  pausedAgentsCopy,
  pausedAgentsNoun,
  reconnectAgentsCopy,
  resumingAgentsCopy,
  SESSION_LIFECYCLE_VERB_LABEL,
  SESSION_RESUME_SCOPE_LABEL,
  sessionLifecyclePresentation,
  type SessionLifecycleFacts,
  type SessionLifecyclePhase,
} from './session-lifecycle';

const facts = (
  over: Partial<SessionLifecycleFacts> = {}
): SessionLifecycleFacts => ({
  lifecycle: 'stopped-clean',
  exitCode: null,
  harness: 'claude',
  harnessSessionId: 'prov-1',
  ...over,
});

const PHASES: SessionLifecyclePhase[] = [
  'draft',
  'running',
  'resuming',
  'stopped-clean',
  'interrupted',
  'exited',
  'failed',
];

describe('sessionLifecyclePresentation', () => {
  it('names every phase with one word and states an ending for every ended one', () => {
    for (const lifecycle of PHASES) {
      const p = sessionLifecyclePresentation(facts({ lifecycle }));
      expect(p.word, lifecycle).toMatch(/\S/);
      if (p.ended) {
        expect(p.line, lifecycle).toMatch(/\S/);
        // The line sits beside the word on every surface, so it must add a
        // fact rather than repeat the word.
        expect(p.line, lifecycle).not.toBe(p.word);
        expect(p.line?.startsWith(`${p.word} ·`), lifecycle).toBe(false);
      } else expect(p.line, lifecycle).toBeNull();
    }
  });

  it('reads how it ended, not which code path recorded it', () => {
    expect(sessionLifecyclePresentation(facts())).toMatchObject({
      word: 'Paused',
      verb: 'resume',
      tone: 'neutral',
      ended: true,
    });
    expect(
      sessionLifecyclePresentation(facts({ lifecycle: 'exited', exitCode: 0 }))
    ).toEqual(sessionLifecyclePresentation(facts()));
    const killed = sessionLifecyclePresentation(
      facts({ lifecycle: 'exited', exitCode: 137 })
    );
    expect(killed.word).toBe('Exited');
    expect(killed.line).toContain('137');
    expect(killed.tone).toBe('warn');
    expect(killed.verb).toBe('resume');
  });

  it('offers the verb the facts allow: resume exactly, reconnect first, or a new shell', () => {
    expect(
      sessionLifecyclePresentation(facts({ harnessSessionId: null }))
    ).toMatchObject({ word: 'Paused', verb: 'reconnect', tone: 'warn' });
    expect(
      sessionLifecyclePresentation(facts({ harnessSessionId: null })).line
    ).toContain('not recorded');
    const shell = sessionLifecyclePresentation(
      facts({ harness: 'shell', harnessSessionId: null })
    );
    expect(shell).toMatchObject({ word: 'Closed', verb: 'new-shell' });
    expect(shell.line).toContain('history kept');
    expect(
      sessionLifecyclePresentation(
        facts({ harness: 'shell', harnessSessionId: null, exitCode: 2 })
      )
    ).toMatchObject({ word: 'Exited', verb: 'new-shell' });
  });

  it('keeps interruption and a failed resume distinct from a clean pause', () => {
    const interrupted = sessionLifecyclePresentation(
      facts({ lifecycle: 'interrupted' })
    );
    expect(interrupted).toMatchObject({
      word: 'Interrupted',
      tone: 'warn',
      verb: 'resume',
    });
    const failed = sessionLifecyclePresentation(facts({ lifecycle: 'failed' }));
    expect(failed).toMatchObject({
      word: 'Resume failed',
      tone: 'fault',
      verb: 'resume',
    });
    const resuming = sessionLifecyclePresentation(
      facts({ lifecycle: 'resuming' })
    );
    expect(resuming).toMatchObject({ word: 'Resuming', verb: null, ended: true });
  });

  it('never calls a draft or a running Session ended', () => {
    expect(sessionLifecyclePresentation(facts({ lifecycle: 'draft' }))).toMatchObject({
      word: 'Draft',
      ended: false,
      verb: null,
    });
    expect(
      sessionLifecyclePresentation(facts({ lifecycle: 'running', harnessSessionId: null }))
    ).toMatchObject({ word: 'Running', ended: false, verb: null });
  });

  it('writes operator copy without em dashes', () => {
    const strings = [
      ...Object.values(SESSION_LIFECYCLE_VERB_LABEL),
      ...Object.values(SESSION_RESUME_SCOPE_LABEL),
      pausedAgentsCopy(2),
      pausedAgentsNoun(2),
      reconnectAgentsCopy(1),
      resumingAgentsCopy(1, 2),
      ...PHASES.flatMap(lifecycle => {
        const p = sessionLifecyclePresentation(facts({ lifecycle, exitCode: 3 }));
        return [p.word, p.line ?? ''];
      }),
    ];
    for (const s of strings) expect(s).not.toContain('—');
  });
});

describe('recovery counts', () => {
  it('counts the paused noun in the product register', () => {
    expect(agentsNoun(1)).toBe('1 Agent');
    expect(agentsNoun(3)).toBe('3 Agents');
    expect(pausedAgentsCopy(1)).toBe('1 Agent paused');
    expect(reconnectAgentsCopy(1)).toBe('1 Agent needs reconnection');
    expect(reconnectAgentsCopy(2)).toBe('2 Agents need reconnection');
    expect(resumingAgentsCopy(1, 2)).toBe('Resuming 1 of 2 Agents…');
  });

  it('scopes the resume verb from the same label the pane prints', () => {
    expect(SESSION_RESUME_SCOPE_LABEL.agent).toBe(
      SESSION_LIFECYCLE_VERB_LABEL.resume
    );
  });
});
