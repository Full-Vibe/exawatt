import type { DiagnosticFields } from './diagnostics-log';
import type { AddConnectedSourceResult } from './connected-source-store';
import type {
  AddConnectedSourceInput,
  AuthorityRequestResult,
  ConnectSourceResult,
  ConnectedSourceChange,
  MapAgentsResult,
} from '@exawatt/core/desktop-bridge';

/**
 * What the connected-source subsystem records about the operator's own acts
 * in `logs/connected-sources.jsonl` (BUG-154).
 *
 * Before this, the only line that file could ever carry was a refused
 * projection, so a Connect that failed, a Save that threw, and a Connect the
 * operator abandoned all left the same thing behind: nothing. On 2026-09-21
 * the installed app rewrote both connected-source files with zero sources and
 * zero mappings, and nothing on disk could say whether that was a refused
 * tunnel, a mapping that would not save, or a Cancel. A failure that leaves
 * no trace is the same as no failure to anyone reading the logs afterwards.
 *
 * Every field here is one that can sit in a bug report without describing the
 * operator's infrastructure: the derived source id (an unkeyed digest, so a
 * report carries it as this install's pseudonym instead; see
 * `diagnostics-pseudonyms.ts`), the transport KIND and placement, the closed
 * vocabularies the runtime already speaks (outcome, failure class, phase,
 * connection state, authority), counts, and elapsed time. Never an alias,
 * host, user, port, display name, Agent name, issue sentence, or error
 * message: each is either the operator's infrastructure or free text that can
 * carry it, and the redaction pass behind the recorder only knows secrets.
 */

/** Ids this subsystem mints: a destination digest, or the random fallback. */
const SOURCE_ID_SHAPES = [
  /^source-[0-9a-f]{24}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
];

/**
 * A source id fit for a log line, or `unrecognised`.
 *
 * The id reaches main from the renderer as a string, and a string is not
 * evidence that it is a digest. Anything that is not the shape this module
 * mints is recorded as the fact that it was not, never as itself.
 */
export function safeSourceId(value: unknown): string {
  return typeof value === 'string' &&
    SOURCE_ID_SHAPES.some(shape => shape.test(value))
    ? value
    : 'unrecognised';
}

export function describeAdd(
  input: AddConnectedSourceInput,
  result: AddConnectedSourceResult
): DiagnosticFields {
  const shape = {
    transport: input.transport.kind,
    placement: input.placement,
  };
  return result.ok
    ? {
        outcome: 'added',
        sourceId: safeSourceId(result.record.id),
        ...shape,
      }
    : { outcome: 'refused', issueCount: result.issues.length, ...shape };
}

export function describeConnect(result: ConnectSourceResult): DiagnosticFields {
  if (result.ok) {
    return {
      sourceId: safeSourceId(result.sourceId),
      outcome: 'connected',
      agentCount: result.agents.length,
      connection: result.status.connection.state,
    };
  }
  return {
    sourceId: safeSourceId(result.sourceId),
    outcome: result.outcome,
    failure: result.failure,
  };
}

export function describeMapAgents(
  sourceId: string,
  result: MapAgentsResult
): DiagnosticFields {
  return result.ok
    ? {
        sourceId: safeSourceId(sourceId),
        outcome: 'saved',
        mapped: result.mapped,
      }
    : {
        sourceId: safeSourceId(sourceId),
        outcome: 'refused',
        issueCount: result.issues.length,
      };
}

/**
 * The outcome, the authority held afterwards, and how far a one-click
 * approval got; never the sentence and never the request id.
 */
export function describeAuthorityRequest(
  sourceId: string,
  result: AuthorityRequestResult
): DiagnosticFields {
  return {
    sourceId: safeSourceId(sourceId),
    outcome: result.outcome,
    authority: result.authority,
    ...(result.approvalStep === undefined ? {} : { step: result.approvalStep }),
  };
}

export function describeOk(
  sourceId: string,
  result: { ok: boolean }
): DiagnosticFields {
  return {
    sourceId: safeSourceId(sourceId),
    outcome: result.ok ? 'ok' : 'no-op',
  };
}

/**
 * A thrown handler, recorded by the error's class name alone. Messages are
 * free text, and this subsystem's messages routinely name the server.
 */
export function describeThrown(error: unknown): DiagnosticFields {
  const name =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
      ? error.name
      : 'unknown';
  return { outcome: 'threw', errorName: name };
}

/** One line the tracker asks to be written. */
interface PhaseLine {
  event: 'connected-sources.phase' | 'connected-sources.retrying';
  fields: DiagnosticFields;
}

interface PhaseTracker {
  /** The lines this change is worth: none, a transition, or a summary too. */
  observe(change: ConnectedSourceChange): PhaseLine[];
  /** Detach: the next observation of this source is news again. */
  forget(sourceId: string): void;
}

/** A retry ladder in progress for one source. */
interface RetryEpisode {
  /** Transitions already written during this episode. */
  seen: Set<string>;
  /** The transition that opened it; each return to it is one more attempt. */
  opening: string;
  attempts: number;
  /** Attempts the last `retrying` line reported. */
  reported: number;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/**
 * Phase and freshness transitions, one line per real transition.
 *
 * The runtime reports a change on every topology replacement, which is every
 * thirty seconds on a healthy source, so recording each would bury the one
 * line that matters. A line is written when the phase, the connection state,
 * or the failure class differs from the last line written for that source.
 * This is also the only record of what happens without an operator act: a
 * relaunch that reconnects on its own, a drop, and the reconnect ladder.
 *
 * The ladder repeats itself, so it is summarised rather than transcribed. A
 * source that stays Reconnecting retries once a minute for as long as its
 * server is away, and writing every transition of every attempt used the
 * whole run's log budget in about five hours; after that, a Connect that
 * failed left no line, which is the failure BUG-154 exists to prevent. So
 * within one Reconnecting episode each distinct transition is written once,
 * a repeat is counted instead, a `retrying` line reports the count at the
 * 1st, 2nd, 4th, 8th... repeat, and the episode's end writes the final count
 * beside the transition that ended it. A day-long outage costs about a dozen
 * lines instead of three thousand.
 */
export function createPhaseTracker(): PhaseTracker {
  const last = new Map<string, string>();
  const episodes = new Map<string, RetryEpisode>();
  return {
    observe(change) {
      const fields = {
        sourceId: safeSourceId(change.sourceId),
        phase: change.phase,
        connection: change.connection.state,
        failure: change.connection.failure,
      };
      const key = `${fields.phase}|${fields.connection}|${fields.failure ?? ''}`;
      if (last.get(change.sourceId) === key) return [];
      last.set(change.sourceId, key);

      const transition: PhaseLine = {
        event: 'connected-sources.phase',
        fields,
      };
      const summary = (
        episode: RetryEpisode,
        extra: DiagnosticFields = {}
      ): PhaseLine => {
        episode.reported = episode.attempts;
        return {
          event: 'connected-sources.retrying',
          fields: {
            sourceId: fields.sourceId,
            attempts: episode.attempts,
            failure: fields.failure,
            ...extra,
          },
        };
      };

      if (change.connection.state === 'reconnecting') {
        const episode = episodes.get(change.sourceId);
        if (!episode) {
          episodes.set(change.sourceId, {
            seen: new Set([key]),
            opening: key,
            attempts: 0,
            reported: 0,
          });
          return [transition];
        }
        if (key === episode.opening) {
          episode.attempts += 1;
          return isPowerOfTwo(episode.attempts) ? [summary(episode)] : [];
        }
        if (episode.seen.has(key)) return [];
        episode.seen.add(key);
        return [transition];
      }

      const episode = episodes.get(change.sourceId);
      episodes.delete(change.sourceId);
      return episode && episode.attempts > episode.reported
        ? [summary(episode, { ended: true }), transition]
        : [transition];
    },
    forget(sourceId) {
      last.delete(sourceId);
      episodes.delete(sourceId);
    },
  };
}
