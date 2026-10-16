'use client';

import { useSyncExternalStore } from 'react';
import type {
  AgentNameRecord,
  AgentNameRequest,
  AgentRenameResult,
} from '@exawatt/core';

/**
 * The renderer's read of Agent names (ENG-029 C4).
 *
 * Electron main owns the names (`electron/main/pty/agent-name-store.ts`);
 * this module mirrors them for every surface that prints one, so the tab,
 * the Team tile, the Fleet label and ⌘K all read the same name at the same
 * moment. It never invents a name: a Session main has not named yet reads
 * as `null`, and Demo Mode publishes its own fixture names through the same
 * door.
 */

export type AgentNames = ReadonlyMap<string, AgentNameRecord>;

const EMPTY: AgentNames = new Map();

let snapshot: AgentNames = EMPTY;
const listeners = new Set<() => void>();
let bridgeAttached = false;

function emit(): void {
  for (const listener of listeners) listener();
}

/** Replace the whole mirror. Main's push and Demo Mode both land here. */
export function publishAgentNames(records: readonly AgentNameRecord[]): void {
  snapshot = new Map(records.map(record => [record.durableSessionId, record]));
  emit();
}

/** Merge records main answered for one request, without dropping others. */
function mergeAgentNames(records: readonly AgentNameRecord[]): void {
  if (records.length === 0) return;
  const next = new Map(snapshot);
  for (const record of records) next.set(record.durableSessionId, record);
  snapshot = next;
  emit();
}

function attachBridge(): void {
  if (bridgeAttached || typeof window === 'undefined') return;
  const pty = window.electron?.pty;
  if (!pty?.agentNames || !pty.onAgentNamesChanged) return;
  bridgeAttached = true;
  pty.onAgentNamesChanged(records => publishAgentNames(records));
  void pty
    .agentNames()
    .then(records => {
      // Anything that arrived while this read was in flight is newer.
      const next = new Map(
        records.map(record => [record.durableSessionId, record])
      );
      for (const [id, record] of snapshot) next.set(id, record);
      snapshot = next;
      emit();
    })
    .catch(error => {
      console.warn('Agent names are unavailable', error);
    });
}

function subscribe(listener: () => void): () => void {
  attachBridge();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(): AgentNames {
  return snapshot;
}

function readServer(): AgentNames {
  return EMPTY;
}

/** Every Agent's name, by durable Session id. */
export function useAgentNames(): AgentNames {
  return useSyncExternalStore(subscribe, read, readServer);
}

/** One Agent's name, or null while main has not named it. */
export function agentNameOf(
  names: AgentNames,
  durableSessionId: string | null | undefined
): string | null {
  return durableSessionId ? (names.get(durableSessionId)?.name ?? null) : null;
}

/** One request's inputs: a changed input is a new question for main. */
function requestKey(request: AgentNameRequest): string {
  return [
    request.durableSessionId,
    request.projectKey,
    request.harness,
    request.preferredName ?? '',
  ].join('\u001f');
}

/** Requests main is answering now: asked once, however often the layout
 *  changes meanwhile. */
const inFlight = new Set<string>();
/** Requests main answered it can never satisfy, with its reason: never
 *  asked again until their inputs change (a new key). */
const skipped = new Map<string, string>();

/**
 * Ask main to name Sessions that have none. Fire-and-forget by design: a
 * name that cannot be dealt leaves the surface on its fallback, never
 * blocks the workspace. A request already in flight is not re-sent, and one
 * main skipped (or never answered) is terminal for those exact inputs.
 */
export async function ensureAgentNames(
  requests: readonly AgentNameRequest[]
): Promise<void> {
  const pty = typeof window === 'undefined' ? undefined : window.electron?.pty;
  if (!pty?.ensureAgentNames) return;
  const asking = requests.filter(request => {
    const key = requestKey(request);
    return !inFlight.has(key) && !skipped.has(key);
  });
  if (asking.length === 0) return;
  const keys = asking.map(requestKey);
  for (const key of keys) inFlight.add(key);
  try {
    const answer = await pty.ensureAgentNames([...asking]);
    mergeAgentNames(answer.records);
    const reasons = new Map(
      answer.skipped.map(skip => [skip.durableSessionId, skip.reason])
    );
    const answered = new Set(
      answer.records.map(record => record.durableSessionId)
    );
    asking.forEach((request, index) => {
      const reason =
        reasons.get(request.durableSessionId) ??
        (answered.has(request.durableSessionId) ? null : 'No answer');
      if (reason !== null) skipped.set(keys[index]!, reason);
    });
  } catch (error) {
    console.warn('Could not name Agents', error);
    const reason =
      error instanceof Error && error.message
        ? error.message
        : 'Could not name Agents';
    for (const key of keys) skipped.set(key, reason);
  } finally {
    for (const key of keys) inFlight.delete(key);
  }
}

/** The operator's rename, answered by main with the name or the reason. */
export async function renameAgent(
  durableSessionId: string,
  name: string
): Promise<AgentRenameResult> {
  const pty = typeof window === 'undefined' ? undefined : window.electron?.pty;
  if (!pty?.renameAgent) {
    return {
      ok: false,
      code: 'unknown',
      reason: 'Renaming is available in the desktop app',
    };
  }
  const result = await pty.renameAgent(durableSessionId, name);
  if (result.ok) mergeAgentNames([result.record]);
  return result;
}
