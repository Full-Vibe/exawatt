import { createHash } from 'crypto';
import path from 'path';
import {
  parseRoadmap,
  deriveFleetRoadmapBlocked,
  type RoadmapAttentionRead,
} from '@exawatt/core';
import type {
  PtySessionRecord,
  RoadmapAttentionObservation,
  RoadmapReadResult,
} from '@exawatt/core/desktop-bridge';

function projectKey(dir: string): string {
  return path.resolve(dir);
}

/** Source read provenance and one authoritative join against current Session evidence.
 * Only the latest requested read may install a token. Duplicate
 * windows can publish the same current observation without owning alert state. */
export class RoadmapAttentionObservations {
  private generation = new Map<string, number>();
  private tokens = new Map<string, string>();
  private documents = new Map<string, RoadmapAttentionRead>();
  private pending = new Map<string, Promise<RoadmapReadResult>>();

  constructor(
    private readonly ports: {
      read(projectDir: string): Promise<RoadmapReadResult>;
      sessions(): Array<
        PtySessionRecord & {
          contextSummary: string | null;
          initialTask: string | null;
        }
      >;
      update(sessionId: string, requestIds: readonly string[]): void;
    }
  ) {}

  async read(projectDir: string): Promise<RoadmapReadResult> {
    const key = projectKey(projectDir);
    const generation = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, generation);
    let result: RoadmapReadResult;
    try {
      const pending = this.ports.read(projectDir);
      this.pending.set(key, pending);
      result = await pending;
    } catch (error) {
      if (this.generation.get(key) === generation) {
        this.tokens.delete(key);
        this.documents.delete(key);
        this.pending.delete(key);
      }
      throw error;
    }
    if (this.generation.get(key) === generation) this.pending.delete(key);
    if (result.status === 'error') {
      if (this.generation.get(key) === generation) {
        this.tokens.delete(key);
        this.documents.delete(key);
      }
      return result;
    }
    const observationToken = createHash('sha256')
      .update(JSON.stringify([key, result]))
      .digest('hex');
    if (this.generation.get(key) === generation) {
      this.tokens.set(key, observationToken);
      this.documents.set(
        key,
        result.status === 'ok'
          ? {
              status: 'ok',
              doc: parseRoadmap(result.text, {
                projectDir: key,
                file: result.file,
              }),
            }
          : { status: 'absent' }
      );
    }
    return { ...result, observationToken };
  }

  /** Return false for stale/invalid coverage. Never turn an unobserved Session
   * or an unread Project into source-confirmed resolution. */
  async publish(value: unknown): Promise<boolean> {
    const observation = readObservation(value);
    if (!observation) return false;
    const key = projectKey(observation.projectDir);
    // The active Project lens and fleet producer can read concurrently. Wait
    // for newer evidence rather than refusing an equivalent first observation
    // only because the other reader has not returned yet.
    while (this.pending.has(key)) {
      try {
        await this.pending.get(key);
      } catch {
        return false;
      }
    }
    if (this.tokens.get(key) !== observation.observationToken) return false;
    const sessions = new Map(
      this.ports.sessions().map(session => [session.id, session])
    );
    // Validate the entire coverage claim before applying any of it.
    for (const claimed of observation.sessions) {
      const actual = sessions.get(claimed.sessionId);
      if (
        !actual ||
        actual.exited ||
        actual.durableSessionId !== claimed.durableSessionId ||
        projectKey(actual.projectDir) !== key
      )
        return false;
    }
    this.reconcile(
      key,
      observation.sessions.map(session => session.sessionId)
    );
    return true;
  }
  /** Recompute from current main-owned Session evidence, never renderer links. */
  reconcile(projectDir: string, sessionIds?: readonly string[]): void {
    const key = projectKey(projectDir);
    const read = this.documents.get(key);
    if (!read || !this.tokens.has(key) || this.pending.has(key)) return;
    const sessions = this.ports
      .sessions()
      .filter(
        session =>
          !session.exited &&
          projectKey(session.projectDir) === key &&
          (!sessionIds || sessionIds.includes(session.id))
      );
    const fleet = deriveFleetRoadmapBlocked([
      {
        dir: key,
        read,
        sessions: sessions.map(session => ({
          sessionId: session.id,
          durableSessionId: session.durableSessionId,
          tabId: null,
          title: session.title,
          cwd: session.cwd,
          contextSummary: session.contextSummary,
          initialTask: session.initialTask,
          declaredItemId: session.roadmapItemId ?? null,
        })),
      },
    ]);
    for (const session of sessions) {
      this.ports.update(
        session.id,
        fleet.blocked
          .filter(item => item.sessionId === session.id)
          .map(item =>
            JSON.stringify([key, session.durableSessionId, item.itemId])
          )
      );
    }
  }
}

function readObservation(value: unknown): RoadmapAttentionObservation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { projectDir, observationToken, sessions } =
    value as Partial<RoadmapAttentionObservation>;
  if (
    typeof projectDir !== 'string' ||
    !path.isAbsolute(projectDir) ||
    projectDir.length > 4096 ||
    projectDir.includes('\0') ||
    typeof observationToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(observationToken) ||
    !Array.isArray(sessions) ||
    sessions.length > 512
  )
    return null;
  const ids = new Set<string>();
  for (const session of sessions) {
    if (
      !session ||
      typeof session !== 'object' ||
      typeof session.sessionId !== 'string' ||
      session.sessionId.length > 200 ||
      typeof session.durableSessionId !== 'string' ||
      session.durableSessionId.length > 200 ||
      ids.has(session.sessionId)
    )
      return null;
    ids.add(session.sessionId);
  }
  return { projectDir, observationToken, sessions };
}
