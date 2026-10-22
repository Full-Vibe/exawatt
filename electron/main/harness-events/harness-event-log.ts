/**
 * The harness-event log (BUG-102's evidence half): `logs/harness-events.jsonl`.
 *
 * One line per thing a Session's process or its harness did — a start, an
 * exit, an identity learned, every event a harness reported through either
 * transport — keyed by the durable Session and the provider conversation, so
 * it reads across a relaunch. PTY ids restart at `pty-1` every launch and the
 * per-launch hook settings are deleted at startup on purpose, so before this
 * nothing a relaunch left behind could say what a wedged Session had been
 * doing.
 *
 * Content-free like `main.jsonl`: identities, kinds, counts and reasons,
 * never a prompt, a reply, a spawn label or a path. Bounded like the other
 * logs under `logs/`: one rotated generation of `MAX_BYTES` each and a
 * per-minute cap per family (`session`, `harness`), so a fleet fanning out
 * children cannot silence its own process lifecycle. There is no per-run cap:
 * rotation already bounds the disk, and a run cap falls silent on exactly the
 * long-lived day a wedge appears.
 */
import path from 'path';
import type { PtySessionRecord } from '@exawatt/core/desktop-bridge';
import type { SessionDelegation } from '@exawatt/core/desktop-bridge';
import {
  boundDiagnosticRecorderPerFamily,
  createDiagnosticsLog,
  type DiagnosticFields,
  type DiagnosticRecorder,
} from '../diagnostics-log';
import type { HarnessEvent } from './delegation-state';

/** Bytes per generation; the log keeps this and one rotated generation. */
const MAX_BYTES = 1_000_000;
const PER_MINUTE_PER_FAMILY = 120;

/** The Session owner as the log reads it: `PtySessionManager`'s events. */
interface SessionEvents {
  on(event: 'created', listener: (record: PtySessionRecord) => void): unknown;
  on(
    event: 'identity',
    listener: (
      id: string,
      durableSessionId: string,
      harnessSessionId: string
    ) => void
  ): unknown;
  on(
    event: 'exit',
    listener: (
      id: string,
      exitCode: number | null,
      durableSessionId: string,
      exitSignal: string | null,
      stopRequested: boolean
    ) => void
  ): unknown;
  on(
    event: 'session-forgotten',
    listener: (durableSessionId: string) => void
  ): unknown;
  list(): PtySessionRecord[];
  sessionProcessId(id: string): number | null;
}

/** Every reported event, after the delegation record has applied it. */
interface HarnessEvents {
  on(
    event: 'harness-event',
    listener: (sessionId: string, event: HarnessEvent) => void
  ): unknown;
  get(sessionId: string): SessionDelegation | null;
}

/**
 * Open `logs/harness-events.jsonl` under `userDataPath`. A log that cannot
 * open degrades to a no-op: instrumentation never keeps a Session from
 * starting.
 */
export function openHarnessEventLog(
  userDataPath: string,
  { maxBytes = MAX_BYTES }: { maxBytes?: number } = {}
): DiagnosticRecorder {
  let file: DiagnosticRecorder;
  try {
    file = createDiagnosticsLog(
      path.join(userDataPath, 'logs', 'harness-events.jsonl'),
      maxBytes
    );
  } catch {
    return () => {};
  }
  return boundDiagnosticRecorderPerFamily(file, {
    perMinute: PER_MINUTE_PER_FAMILY,
    perRun: Number.POSITIVE_INFINITY,
  });
}

/** What an event adds beyond its kind. Content never: a child's spawn label
 *  is the operator's task in the Agent's words, so it stays out. */
function eventDetail(event: HarnessEvent): DiagnosticFields {
  switch (event.kind) {
    case 'blocked':
      return {
        reason: event.reason,
        ...(event.request ? { request: event.request } : {}),
      };
    case 'unblocked':
      return event.reason ? { reason: event.reason } : {};
    case 'request-coverage':
      return { coverage: event.coverage };
    case 'turn-unknown':
      return event.preserveResult ? { preserveResult: true } : {};
    case 'child-label':
      return { agentType: event.agentType };
    case 'child-start':
      return { childId: event.childId, agentType: event.agentType };
    case 'child-end':
      return {
        childId: event.childId,
        ...(event.census ? censusDetail(event.census) : {}),
      };
    case 'turn-end':
      return event.census ? censusDetail(event.census) : {};
    case 'census':
      return censusDetail(event.census);
    default:
      return {};
  }
}

function censusDetail(census: {
  live: readonly unknown[];
  completed: readonly unknown[];
}): DiagnosticFields {
  return {
    censusLive: census.live.length,
    censusCompleted: census.completed.length,
  };
}

/**
 * Write every Session start, identity, exit and forget, and every harness
 * event, to `record`. Returns the one line the IPC door adds: how an ask for
 * a Session was answered when it started nothing (BUG-305's evidence).
 */
export function attachHarnessEventLog(
  record: DiagnosticRecorder,
  sessions: SessionEvents,
  delegation: HarnessEvents,
  now: () => number = Date.now
): {
  ensured(answer: 'joined' | 'running', session: PtySessionRecord): void;
} {
  const identity = (session: PtySessionRecord) => ({
    durableSessionId: session.durableSessionId,
    ptyId: session.id,
    harness: session.harness,
    harnessSessionId: session.harnessSessionId,
  });
  const byPtyId = (id: string) =>
    sessions.list().find(session => session.id === id);

  sessions.on('created', session => {
    record('session.start', {
      ...identity(session),
      pid: sessions.sessionProcessId(session.id),
    });
  });
  sessions.on('identity', (id, durableSessionId, harnessSessionId) => {
    record('session.identity', {
      durableSessionId,
      ptyId: id,
      harness: byPtyId(id)?.harness ?? null,
      harnessSessionId,
    });
  });
  sessions.on(
    'exit',
    (id, exitCode, durableSessionId, exitSignal, stopRequested) => {
      const session = byPtyId(id);
      record('session.exit', {
        ...(session ? identity(session) : { durableSessionId, ptyId: id }),
        exitCode,
        exitSignal,
        stopRequested,
        ...(session ? { ranMs: now() - session.startedAt } : {}),
      });
    }
  );
  sessions.on('session-forgotten', durableSessionId => {
    record('session.forgotten', { durableSessionId });
  });
  delegation.on('harness-event', (id, event) => {
    const session = byPtyId(id);
    const truth = delegation.get(id);
    record(`harness.${event.kind}`, {
      ...(session ? identity(session) : { ptyId: id }),
      ...eventDetail(event),
      ownTurn: truth?.ownTurn ?? null,
      blockedOn: truth?.blockedOn ?? null,
      childCount: truth?.children.length ?? 0,
      ...(truth?.requestCoverage
        ? { requestCoverage: truth.requestCoverage }
        : {}),
      backgroundTypes: truth?.backgroundTasks?.map(task => task.type) ?? [],
    });
  });

  return {
    ensured(answer, session) {
      record('session.ensure', { ...identity(session), answer });
    },
  };
}
