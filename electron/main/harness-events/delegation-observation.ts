/** Runtime observation coverage, separate from child lifecycle and turn truth. */
import { EventEmitter } from 'events';
import type {
  AgentSourceAdapterId,
  AgentSourceFact,
  AgentSourceRegistrySnapshot,
} from '@exawatt/core';

export interface DelegationObservation {
  state: 'complete' | 'partial' | 'unavailable';
  /**
   * Whose limit was met (BUG-183). `unsupported`: the installed source
   * cannot serve a read, a fact about the binary. `unreadable`: this
   * Session's data is past one of Exawatt's own read limits (frame size,
   * lineage length, record shape), a fact about this Session and about
   * Exawatt. `read-failed`: the attempt failed and is being retried.
   */
  reason: 'unsupported' | 'unreadable' | 'read-failed' | null;
  version: string | null;
  observedAt: number;
}

/** One owner for source health. A healthy Session cannot hide a blind sibling. */
export class DelegationObservations extends EventEmitter {
  private sessions = new Map<
    string,
    { source: AgentSourceAdapterId; observation: DelegationObservation }
  >();

  report(
    source: AgentSourceAdapterId,
    sessionId: string,
    observation: DelegationObservation
  ): void {
    const previous = this.sessions.get(sessionId);
    this.sessions.set(sessionId, { source, observation });
    if (
      previous?.source === source &&
      previous.observation.state === observation.state &&
      previous.observation.reason === observation.reason &&
      previous.observation.version === observation.version
    )
      return;
    this.emit('changed', source, this.fact(source));
  }

  drop(sessionId: string): void {
    const previous = this.sessions.get(sessionId);
    if (!previous) return;
    this.sessions.delete(sessionId);
    this.emit('changed', previous.source, this.fact(previous.source));
  }

  fact(source: AgentSourceAdapterId): AgentSourceFact | null {
    const observations = [...this.sessions.values()]
      .filter(entry => entry.source === source)
      .map(entry => entry.observation);
    if (!observations.length) return null;
    const incomplete = observations.filter(item => item.state !== 'complete');
    const unsupported = incomplete.find(item => item.reason === 'unsupported');
    const unreadable = incomplete.filter(
      item => item.reason === 'unreadable'
    ).length;
    const partial =
      incomplete.length > 0 &&
      (incomplete.length < observations.length ||
        incomplete.some(item => item.state === 'partial'));
    const version = unsupported?.version;
    const label = source === 'codex' ? 'Codex' : 'This source';
    return {
      basis: 'observed',
      state: incomplete.length
        ? partial
          ? 'degraded'
          : 'unavailable'
        : 'ready',
      value: incomplete.length
        ? partial
          ? 'Delegation partially observable'
          : 'Delegation unobservable'
        : 'Delegation observable',
      detail: incomplete.length
        ? unsupported
          ? `${label}${version ? ` ${version}` : ''} does not support a read Exawatt needs to verify children. Children it cannot verify are hidden until ${label} is updated.`
          : unreadable
            ? `Exawatt could not read the delegation data of ${unreadable === 1 ? 'one Session' : `${unreadable} Sessions`}. Unverified children there are hidden while Exawatt retries; other Sessions are unaffected, and this does not stop their work.`
            : 'Some delegation reads are unavailable. Unverified children are hidden while Exawatt retries; this does not stop their work.'
        : 'Live Session child censuses were read successfully. An empty census means no live children were reported.',
      provenance: {
        kind: 'source-protocol',
        label: 'Live delegation observer',
        observedAt: Math.max(...observations.map(item => item.observedAt)),
      },
    };
  }

  project(snapshot: AgentSourceRegistrySnapshot): AgentSourceRegistrySnapshot {
    return {
      ...snapshot,
      sources: snapshot.sources.map(source => {
        const delegation = this.fact(source.adapterId);
        return delegation
          ? { ...source, facts: { ...source.facts, delegation } }
          : source;
      }),
    };
  }
}

export const delegationObservations = new DelegationObservations();
