import { describe, expect, it } from 'vitest';
import {
  agentsNoun,
  reconnectAgentsCopy,
  resumableAgents,
  resumableAgentsCopy,
  resumableAgentsNoun,
  resumingAgentsCopy,
  SESSION_LIFECYCLE_VERB_LABEL,
  SESSION_RESUME_SCOPE_LABEL,
  SESSION_RESUME_UNAVAILABLE,
  sessionCanResume,
  sessionLifecyclePresentation,
  type SessionLifecycleFacts,
  type SessionLifecyclePhase,
} from './session-lifecycle';

const facts = (
  over: Partial<SessionLifecycleFacts> = {}
): SessionLifecycleFacts => ({
  lifecycle: 'stopped-clean',
  exitCode: null,
  exitSignal: null,
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

  it('reads a signal as how it ended, never as a clean stop (BUG-186)', () => {
    // node-pty reports a SIGKILL as exit code 0 plus the signal.
    const killed = sessionLifecyclePresentation(
      facts({ lifecycle: 'exited', exitCode: 0, exitSignal: 'SIGKILL' })
    );
    expect(killed).toMatchObject({
      word: 'Exited',
      tone: 'warn',
      verb: 'resume',
    });
    expect(killed.line).toContain('SIGKILL');
    expect(killed.line).not.toContain('cleanly');
    // A record from before exits carried their signal is not clean either.
    const unknown = sessionLifecyclePresentation(
      facts({ lifecycle: 'exited', exitCode: 0, exitSignal: undefined })
    );
    expect(unknown.word).toBe('Exited');
    expect(unknown.line).not.toContain('cleanly');
    // Exawatt's own clean stop is clean whatever the record's age.
    expect(
      sessionLifecyclePresentation(facts({ exitSignal: undefined })).word
    ).toBe('Paused');
  });

  it('offers the verb the facts allow: resume exactly, reconnect first, or a new shell', () => {
    // Paused promises resume, so a Session with no recorded conversation
    // never wears it (BUG-185).
    expect(
      sessionLifecyclePresentation(facts({ harnessSessionId: null }))
    ).toMatchObject({ word: 'Closed', verb: 'reconnect', tone: 'warn' });
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
    expect(resuming).toMatchObject({
      word: 'Resuming',
      verb: null,
      ended: true,
    });
  });

  it('never calls a draft or a running Session ended', () => {
    expect(
      sessionLifecyclePresentation(facts({ lifecycle: 'draft' }))
    ).toMatchObject({
      word: 'Draft',
      ended: false,
      verb: null,
    });
    expect(
      sessionLifecyclePresentation(
        facts({ lifecycle: 'running', harnessSessionId: null })
      )
    ).toMatchObject({ word: 'Running', ended: false, verb: null });
  });

  it('writes operator copy without em dashes', () => {
    const strings = [
      ...Object.values(SESSION_LIFECYCLE_VERB_LABEL),
      ...Object.values(SESSION_RESUME_SCOPE_LABEL),
      resumableAgentsCopy({ count: 2, allPaused: true }),
      resumableAgentsCopy({ count: 2, allPaused: false }),
      resumableAgentsNoun({ count: 2, allPaused: true }),
      ...Object.values(SESSION_RESUME_UNAVAILABLE),
      reconnectAgentsCopy(1),
      resumingAgentsCopy(1, 2),
      ...PHASES.flatMap(lifecycle => {
        const p = sessionLifecyclePresentation(
          facts({ lifecycle, exitCode: 3 })
        );
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
    expect(resumableAgentsCopy(resumableAgents([facts()]))).toBe(
      '1 Agent paused'
    );
    expect(reconnectAgentsCopy(1)).toBe('1 Agent needs reconnection');
    expect(reconnectAgentsCopy(2)).toBe('2 Agents need reconnection');
    expect(resumingAgentsCopy(1, 2)).toBe('Resuming 1 of 2 Agents…');
  });

  it('keeps "paused" only while it is true of every Agent counted', () => {
    const interrupted = facts({ lifecycle: 'interrupted' });
    const mixed = resumableAgents([facts(), interrupted]);
    expect(mixed).toEqual({ count: 2, allPaused: false });
    expect(resumableAgentsCopy(mixed)).toBe('2 Agents to resume');
    expect(resumableAgentsNoun(mixed)).toBe('2 Agents');
    const clean = resumableAgents([facts(), facts()]);
    expect(resumableAgentsCopy(clean)).toBe('2 Agents paused');
    expect(resumableAgentsNoun(clean)).toBe('2 paused Agents');
  });

  it('resumes exactly the Sessions whose verb is resume', () => {
    expect(sessionCanResume(facts())).toBe(true);
    expect(sessionCanResume(facts({ lifecycle: 'interrupted' }))).toBe(true);
    expect(sessionCanResume(facts({ harnessSessionId: null }))).toBe(false);
    expect(sessionCanResume(facts({ harness: 'shell' }))).toBe(false);
    expect(sessionCanResume(facts({ lifecycle: 'running' }))).toBe(false);
    expect(sessionCanResume(facts({ lifecycle: 'resuming' }))).toBe(false);
  });

  it('scopes the resume verb from the same label the pane prints', () => {
    expect(SESSION_RESUME_SCOPE_LABEL.agent).toBe(
      SESSION_LIFECYCLE_VERB_LABEL.resume
    );
  });
});
