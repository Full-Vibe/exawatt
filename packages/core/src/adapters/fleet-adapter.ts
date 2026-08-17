import type { OCGatewayClient } from '../oc/client';
import type { OCMethods } from '../oc/methods';
import type {
  OCSession,
  OCCronJob,
  PresencePayload,
} from '../oc/protocol-types';
import { createAgent, INITIAL_AGENT_METRICS } from '../types/agent';
import type { ExawattAgent, AgentStatus } from '../types/agent';

export class FleetAdapter {
  private presenceMap = new Map<string, boolean>(); // sessionKey → online

  constructor(
    private client: OCGatewayClient,
    private methods: OCMethods
  ) {
    this._subscribeToPresence();
  }

  private _subscribeToPresence(): void {
    this.client.onOCEvent('presence', payload => {
      const p = payload as PresencePayload;
      this.presenceMap.set(p.agentId, p.online);
    });
  }

  /**
   * Fetch all OC sessions and cron jobs, compose into ExawattAgent[].
   */
  async fetchAgents(): Promise<ExawattAgent[]> {
    const [sessionsResult, cronResult] = await Promise.all([
      this.methods.sessionsList(),
      this.methods.cronList().catch(() => ({ jobs: [] as OCCronJob[] })),
    ]);

    // Build a cron job map keyed by sessionKey (if provided)
    const cronBySession = new Map<string, OCCronJob>();
    for (const job of cronResult.jobs) {
      if (job.sessionKey) {
        cronBySession.set(job.sessionKey, job);
      }
    }

    return sessionsResult.sessions.map(session =>
      this._sessionToAgent(session, cronBySession.get(session.key))
    );
  }

  /**
   * Create a new agent (OC session + optional cron job).
   */
  async createAgent(goal: string, sessionKey?: string): Promise<ExawattAgent> {
    // For OC, we use an existing session or a new session key
    const key = sessionKey ?? `session-${Date.now()}`;

    // Build a minimal agent from the session key
    return createAgent({
      id: key,
      name: key,
      goal,
      sessionKey: key,
      status: 'idle',
    });
  }

  /**
   * Convert a single OC session + optional cron job into an ExawattAgent.
   */
  private _sessionToAgent(
    session: OCSession,
    cronJob?: OCCronJob
  ): ExawattAgent {
    const status = this._deriveStatus(session, cronJob);

    return createAgent({
      id: session.key,
      name: session.key,
      status,
      goal: cronJob?.prompt ?? '',
      project: '', // OC sessions don't have projects — let caller set this
      sessionKey: session.key,
      cronJobId: cronJob?.id,
      lastActivityAt: session.lastActiveAt ?? Date.now(),
      createdAt: session.createdAt ?? Date.now(),
      metrics: {
        ...INITIAL_AGENT_METRICS,
        startedAt: session.createdAt ?? null,
      },
    });
  }

  /**
   * Derive Exawatt AgentStatus from OC session + cron composite state.
   *
   * Status derivation logic (ordered priority):
   * - Session error → 'error'
   * - Session blocked → 'blocked'
   * - Session has recent activity (< 5 min) + online → 'working'
   * - Cron job has next scheduled run → 'idle' (scheduled)
   * - No recent activity + online → 'idle'
   * - Not online → 'idle'
   */
  private _deriveStatus(session: OCSession, cronJob?: OCCronJob): AgentStatus {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const isOnline = this.presenceMap.get(session.key) ?? true; // assume online if no presence data
    const lastActive = session.lastActiveAt ?? 0;
    const hasRecentActivity = lastActive > fiveMinutesAgo;

    if (cronJob?.status === 'error') return 'error';
    if (hasRecentActivity && isOnline) return 'working';
    return 'idle';
  }
}
