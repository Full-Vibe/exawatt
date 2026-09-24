import { getCommandVerb, SESSION_LIFECYCLE_WORD as WORD } from '@exawatt/core';

/**
 * Session lifecycle vocabulary (ENG-015 S6.4): the one owner of what a
 * Session's lifecycle is CALLED.
 *
 * Four surfaces used to keep their own words for one paused Agent: the tab
 * said "Exited" or "Stopped", the recovery bar said "paused", the pane said
 * "Stopped" and "Resume This Agent", the record said "PAUSED". Each was
 * locally reasonable and together they read as four different Agents. The
 * status vocabularies (turn state, attention, status light) stay layered on
 * purpose, see `switcher-rows.ts`; this module owns only the LIFECYCLE
 * presentation: the word, the one line stating how it ended and what is
 * kept, its tone, and the verb that answers it.
 *
 * Pure over the lifecycle facts a Session already carries, so Demo and Live
 * share it and a test can pin that every surface prints the same words.
 * The words are spelled in `@exawatt/core` (`SESSION_LIFECYCLE_WORD`) so the
 * native menu, built in Electron main, prints the same Paused this module
 * hands the renderer; this module decides which word a Session gets.
 */

export type SessionLifecyclePhase =
  | 'draft'
  | 'running'
  | 'resuming'
  | 'stopped-clean'
  | 'interrupted'
  | 'exited'
  | 'failed';

const PHASES: ReadonlySet<string> = new Set<SessionLifecyclePhase>([
  'draft',
  'running',
  'resuming',
  'stopped-clean',
  'interrupted',
  'exited',
  'failed',
]);

/** Guard for callers that carry the lifecycle as a plain string. */
export function isSessionLifecyclePhase(
  value: string
): value is SessionLifecyclePhase {
  return PHASES.has(value);
}

export interface SessionLifecycleFacts {
  lifecycle: SessionLifecyclePhase;
  /** The process exit code once it has ended; null while it runs or when
   *  nothing was recorded. */
  exitCode: number | null;
  /** The harness id. `shell` is the one harness with no conversation to
   *  resume, only a new shell to start. */
  harness: string;
  /** The source conversation identity needed to resume EXACTLY. Null means
   *  it was never recorded, which is a different fact from ended. */
  harnessSessionId: string | null;
}

export type SessionLifecycleTone = 'neutral' | 'warn' | 'fault';

type SessionLifecycleVerb = 'resume' | 'reconnect' | 'new-shell';

interface SessionLifecyclePresentation {
  /** The one word every surface prints for this state. */
  word: string;
  /** How it ended and what is kept, as one line of product state. Null
   *  while nothing has ended. */
  line: string | null;
  tone: SessionLifecycleTone;
  /** The action that answers this state, or null when none is offered. */
  verb: SessionLifecycleVerb | null;
  /** No local process is behind the tab. A draft has none either, but it
   *  never had one, so it is not `ended`. */
  ended: boolean;
}

/**
 * The verb as a button or menu row prints it. `resume` is the command-verb
 * manifest's own label for `workspace-resume-agent`, so the pane, the tab
 * menu, the recovery bar and ⌘K cannot name the same action twice.
 */
export const SESSION_LIFECYCLE_VERB_LABEL: Record<SessionLifecycleVerb, string> =
  {
    resume: getCommandVerb('workspace-resume-agent').label,
    reconnect: 'Reconnect conversation',
    'new-shell': 'Start new shell',
  };

/**
 * A Project's Agents as one scope (operator, 0.1.13: the Project menu's
 * Pause Agents / Resume Agents). Pause produces the same `stopped-clean`
 * state a clean quit does, which is why both read "Paused" above.
 */
export const SESSION_PROJECT_VERB_LABEL = {
  pause: 'Pause Agents',
  resume: 'Resume Agents',
} as const;

type SessionResumeScope = 'agent' | 'project' | 'all';

/** The resume verb at each scope the recovery surfaces offer. */
export const SESSION_RESUME_SCOPE_LABEL: Record<SessionResumeScope, string> = {
  agent: SESSION_LIFECYCLE_VERB_LABEL.resume,
  project: SESSION_PROJECT_VERB_LABEL.resume,
  all: 'Resume all',
};

/** The paused noun, as a count reads it: "1 Agent", "3 Agents". */
export function agentsNoun(count: number): string {
  return `${count} ${count === 1 ? 'Agent' : 'Agents'}`;
}

const PAUSED = WORD.paused.toLowerCase();

/** "3 Agents paused" */
export function pausedAgentsCopy(count: number): string {
  return `${agentsNoun(count)} ${PAUSED}`;
}

/** "3 paused Agents", the count a resume verb acts on. */
export function pausedAgentsNoun(count: number): string {
  return `${count} ${PAUSED} ${count === 1 ? 'Agent' : 'Agents'}`;
}

/** "1 Agent needs reconnection" / "2 Agents need reconnection" */
export function reconnectAgentsCopy(count: number): string {
  return `${agentsNoun(count)} need${count === 1 ? 's' : ''} reconnection`;
}

/** "Resuming 1 of 2 Agents…" */
export function resumingAgentsCopy(completed: number, total: number): string {
  return `Resuming ${completed} of ${total === 1 ? '1 Agent' : `${total} Agents`}…`;
}

const KEPT = (facts: SessionLifecycleFacts): string =>
  facts.harness === 'shell'
    ? 'history kept'
    : facts.harnessSessionId
      ? 'conversation kept'
      : 'conversation not recorded';

const verbFor = (facts: SessionLifecycleFacts): SessionLifecycleVerb =>
  facts.harness === 'shell'
    ? 'new-shell'
    : facts.harnessSessionId
      ? 'resume'
      : 'reconnect';

/** An Agent whose conversation was never recorded needs one reconnection
 *  before it can resume exactly; that is worth a warmer tone than a clean
 *  pause. */
const identityTone = (facts: SessionLifecycleFacts): SessionLifecycleTone =>
  facts.harness !== 'shell' && !facts.harnessSessionId ? 'warn' : 'neutral';

export function sessionLifecyclePresentation(
  facts: SessionLifecycleFacts
): SessionLifecyclePresentation {
  switch (facts.lifecycle) {
    case 'draft':
      return {
        word: WORD.draft,
        line: null,
        tone: 'neutral',
        verb: null,
        ended: false,
      };
    case 'running':
      return {
        word: WORD.running,
        line: null,
        tone: 'neutral',
        verb: null,
        ended: false,
      };
    case 'resuming':
      return {
        word: WORD.resuming,
        line: 'Starting a new process for the saved conversation',
        tone: 'neutral',
        verb: null,
        ended: true,
      };
    case 'failed':
      return {
        word: WORD.resumeFailed,
        line: `Last resume attempt failed · ${KEPT(facts)}`,
        tone: 'fault',
        verb: verbFor(facts),
        ended: true,
      };
    case 'interrupted':
      return {
        word: WORD.interrupted,
        line: `Ended without a clean shutdown · ${KEPT(facts)}`,
        tone: 'warn',
        verb: verbFor(facts),
        ended: true,
      };
    case 'stopped-clean':
    case 'exited': {
      // How it ended decides the word, not which code path recorded it: a
      // Session that exited with 0 and one the app stopped cleanly are the
      // same fact to the operator.
      const code = facts.exitCode;
      if (code !== null && code !== 0) {
        return {
          word: WORD.exited,
          line: `Exited with code ${code} · ${KEPT(facts)}`,
          tone: 'warn',
          verb: verbFor(facts),
          ended: true,
        };
      }
      if (facts.harness === 'shell') {
        return {
          word: WORD.closed,
          line: 'Shell closed · history kept',
          tone: 'neutral',
          verb: 'new-shell',
          ended: true,
        };
      }
      return {
        word: WORD.paused,
        line: `Stopped cleanly · ${KEPT(facts)}`,
        tone: identityTone(facts),
        verb: verbFor(facts),
        ended: true,
      };
    }
  }
}
