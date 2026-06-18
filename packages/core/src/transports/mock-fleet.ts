/**
 * MockFleetTransport — Demo Mode Simulation Engine
 *
 * Populates a FleetManager with realistic mock agents and evolves their state
 * over time. Used for UI testing without a live OC instance.
 */

import type { FleetManager } from '../state/fleet-manager';
import {
  createAgent,
  INITIAL_AGENT_METRICS,
  type ExawattAgent,
  type AgentStatus,
  type AgentActivity,
  type AgentBlocker,
} from '../types/agent';
import type { FleetState, FleetMetrics } from '../types/fleet';
import type {
  ExawattCronJob,
  ExawattCronRun,
  ExawattCronJobCreate,
} from '../types/cron';

// Speed configs matching SIMULATION_SPEED_CONFIG in V1
export type SimulationSpeed = 'realistic' | 'fast' | 'rapid';

const SPEED_MULTIPLIERS: Record<SimulationSpeed, number> = {
  realistic: 1,
  fast: 10,
  rapid: 100,
};

// Base interval between simulation ticks (ms, before speed multiplier)
const BASE_TICK_INTERVAL_MS = 5000;

// Demo fleet size, for exercising fleet-scale readiness (V0.5). 'small' is the
// default and keeps the 8 hand-authored agents unchanged; larger sizes add
// synthetic agents across more Projects so the surface can be tested at scale.
export type FleetScale = 'small' | 'medium' | 'large';

const SCALE_COUNTS: Record<FleetScale, number> = {
  small: 8,
  medium: 40,
  large: 150,
};

// Projects synthetic agents are distributed across (the 3 canonical demo
// Projects plus more, so high-altitude clustering has many zones to summarize).
const SYNTHETIC_PROJECTS = [
  'Exawatt Demo Polish',
  'OpenClaw Local Parity',
  'Investor Pipeline Research',
  'Mobile App',
  'Infra Hardening',
  'Growth Experiments',
  'Support Triage',
  'Docs & DX',
  'Billing & Metering',
  'Security Review',
];

// Weighted status pool for synthetic agents (mostly quiet work, a slice blocked).
const SYNTHETIC_STATUSES: AgentStatus[] = [
  'working',
  'working',
  'working',
  'idle',
  'idle',
  'idle',
  'reviewing',
  'complete',
  'blocked',
  'error',
];

const SYNTHETIC_GOALS = [
  'Triage incoming issues and label by severity',
  'Refactor the data layer for the new schema',
  'Draft release notes from the merged PRs',
  'Investigate elevated error rate in checkout',
  'Add end-to-end tests for the auth flow',
  'Summarize this week customer feedback',
  'Optimize the slowest three API endpoints',
  'Prepare the migration runbook',
];

const MOCK_AGENTS_DATA: Array<{
  id: string;
  name: string;
  project: string;
  goal: string;
  status: AgentStatus;
}> = [
  {
    id: 'demo-alpha',
    name: 'Alpha',
    project: 'Exawatt Demo Polish',
    goal: 'Improve onboarding flow and add analytics tracking to key conversion steps',
    status: 'working',
  },
  {
    id: 'demo-beta',
    name: 'Beta',
    project: 'Exawatt Demo Polish',
    goal: 'Audit and fix all TypeScript errors in the legacy module, add missing tests',
    status: 'idle',
  },
  {
    id: 'demo-gamma',
    name: 'Gamma',
    project: 'OpenClaw Local Parity',
    goal: 'Research competitor pricing, compile report with recommendations',
    status: 'blocked',
  },
  {
    id: 'demo-delta',
    name: 'Delta',
    project: 'Investor Pipeline Research',
    goal: 'Migrate database schema to support multi-tenancy',
    status: 'complete',
  },
  {
    id: 'demo-epsilon',
    name: 'Epsilon',
    project: 'Investor Pipeline Research',
    goal: 'Build marketing landing page with A/B test variants',
    status: 'idle',
  },
  {
    id: 'demo-zeta',
    name: 'Zeta',
    project: 'Exawatt Demo Polish',
    goal: 'Performance optimization sprint: reduce bundle size by 40%',
    status: 'working',
  },
  {
    id: 'demo-eta',
    name: 'Eta',
    project: 'OpenClaw Local Parity',
    goal: 'Review and merge 12 open PRs, resolve conflicts',
    status: 'reviewing',
  },
  {
    id: 'demo-theta',
    name: 'Theta',
    project: 'OpenClaw Local Parity',
    goal: 'Set up CI/CD pipeline for the new microservice',
    status: 'blocked',
  },
];

const MOCK_BLOCKERS: Array<
  Pick<AgentBlocker, 'type' | 'title' | 'description' | 'suggestedResponses'>
> = [
  {
    type: 'approval_required',
    title: '3 products awaiting launch approval',
    description: 'Product Hunt, social media scheduling needs sign-off',
    suggestedResponses: ['Approve all', 'Review each', 'Defer to tomorrow'],
  },
  {
    type: 'approval_required',
    title: 'OpenClaw 2026.3.13 available — update requires approval',
    description:
      'New version with improved tool handling and reduced token usage',
    suggestedResponses: ['Update now', 'Update tonight', 'Skip this version'],
  },
  {
    type: 'input_needed',
    title: 'Which authentication provider to prioritize?',
    description: 'Current options: Supabase Auth, Auth0, Clerk',
    suggestedResponses: ['Supabase Auth', 'Auth0', 'Clerk'],
  },
  {
    type: 'credentials_needed',
    title: 'Stripe API keys required',
    description: 'Cannot proceed with payment integration without live keys',
    suggestedResponses: ['Provide keys', 'Use test mode', 'Skip payment step'],
  },
];

// Mock cron jobs
const MOCK_CRON_JOBS: ExawattCronJob[] = [
  {
    id: 'cron-1',
    name: 'Daily Pulse check-in',
    schedule: '0 8 * * *',
    prompt:
      'Check email, analytics, GitHub activity, and generate morning briefing',
    enabled: true,
    lastRun: Date.now() - 86400000,
    nextRun: Date.now() + 3600000,
    status: 'idle',
  },
  {
    id: 'cron-2',
    name: 'VantageMap deploy heartbeat',
    schedule: '*/30 * * * *',
    prompt: 'Check deploy status and report any failures',
    enabled: true,
    lastRun: Date.now() - 1800000,
    nextRun: Date.now() + 1800000,
    status: 'idle',
  },
  {
    id: 'cron-3',
    name: 'Code review sweep',
    schedule: '0 18 * * 1-5',
    prompt: 'Review open PRs and leave AI-generated review comments',
    enabled: true,
    lastRun: Date.now() - 7200000,
    nextRun: Date.now() + 14400000,
    status: 'idle',
  },
  {
    id: 'cron-4',
    name: 'Marketing content scheduler',
    schedule: '0 9 * * *',
    prompt: 'Schedule social media posts for the day',
    enabled: false,
    lastRun: Date.now() - 172800000,
    status: 'idle',
  },
];

const MOCK_CHAT_MESSAGES = [
  'Mapped the next dependency boundary and queued the adapter change.',
  'Found a stale assumption in the implementation notes. Recording the decision before changing code.',
  'Running the focused test suite before widening the change.',
  'Comparing the demo source output with the live gateway contract.',
  'Generated a candidate patch and waiting on verification output.',
  'Summarizing artifacts from the current session for handoff.',
  'Watching for a policy threshold before continuing autonomous work.',
  'Checking the heartbeat schedule against the active initiative.',
  'Prepared the next action. No human input required right now.',
];

const USER_REPLY_ACKS = [
  'Acknowledged. I have the missing context and am continuing the session.',
  'Received. I cleared the blocker and resumed the current objective.',
  'Thanks. I am applying that decision and updating the activity trail.',
  'Understood. I will proceed under that constraint.',
];

export class MockFleetTransport {
  private fleetManager: FleetManager | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private speed: SimulationSpeed = 'realistic';
  private scale: FleetScale = 'small';
  private running = false;
  private agents = new Map<string, ExawattAgent>();
  private cronJobs = new Map<string, ExawattCronJob>();
  private cronRuns = new Map<string, ExawattCronRun[]>();

  /**
   * Wire this transport to a FleetManager and seed mock data.
   * Immediately pushes agents through FleetManager events.
   */
  initialize(fleetManager: FleetManager): void {
    this.fleetManager = fleetManager;
    this._seedAgents();
    this._pushAllAgentsToManager();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this._scheduleTick();
  }

  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  setSpeed(speed: SimulationSpeed): void {
    this.speed = speed;
    if (this.running) {
      if (this.tickTimer) clearTimeout(this.tickTimer);
      this._scheduleTick();
    }
  }

  getScale(): FleetScale {
    return this.scale;
  }

  /** Resize the demo fleet (small/medium/large), reseed, and re-emit live. */
  setScale(scale: FleetScale): void {
    if (this.scale === scale) return;
    this.scale = scale;
    const wasRunning = this.running;
    this.stop();
    this.agents.clear();
    this._seedAgents();
    if (this.fleetManager) this._pushAllAgentsToManager();
    if (wasRunning) this.start();
  }

  reset(): void {
    this.stop();
    this.agents.clear();
    this.cronJobs = this._cloneCronJobs();
    this.cronRuns.clear();
    this._seedAgents();
    if (this.fleetManager) {
      this._pushAllAgentsToManager();
    }
  }

  sendMessage(agentId: string, text: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return Promise.resolve();

    if (agent.status === 'blocked') {
      this.resolveBlocker(agentId, text);
      return Promise.resolve();
    }

    this._appendActivity(agentId, {
      id: this._activityId('user'),
      timestamp: Date.now(),
      type: 'chat_message',
      content: text,
      metadata: { role: 'user', demo: true },
    });

    const reply =
      USER_REPLY_ACKS[Math.floor(Math.random() * USER_REPLY_ACKS.length)]!;
    const updated = this._mergeAgent(agentId, {
      status: 'working',
      lastActivityAt: Date.now(),
    });

    if (updated) {
      this._appendActivity(agentId, {
        id: this._activityId('reply'),
        timestamp: Date.now(),
        type: 'chat_message',
        content: reply,
        metadata: { role: 'agent', demo: true },
      });
    }

    return Promise.resolve();
  }

  resolveBlocker(agentId: string, response?: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'blocked') return;

    const activities = [...(agent.activities ?? [])];
    if (response?.trim()) {
      activities.push({
        id: this._activityId('user'),
        timestamp: Date.now(),
        type: 'chat_message',
        content: response.trim(),
        metadata: { role: 'user', demo: true, resolvesBlocker: true },
      });
    }

    const resolvedActivities: AgentActivity[] = [
      ...activities,
      {
        id: this._activityId('resolved'),
        timestamp: Date.now(),
        type: 'blocker_resolved',
        content: response?.trim()
          ? `Blocker resolved: ${response.trim()}`
          : 'Blocker resolved. Agent resumed work.',
        metadata: { demo: true, response },
      },
      {
        id: this._activityId('reply'),
        timestamp: Date.now() + 1,
        type: 'chat_message',
        content: 'Blocker cleared. I am back on the objective now.',
        metadata: { role: 'agent', demo: true },
      },
    ];

    const updated: ExawattAgent = {
      ...agent,
      status: 'working',
      blockerInfo: undefined,
      lastActivityAt: Date.now(),
      activities: resolvedActivities.slice(-80),
    };
    this.agents.set(agentId, updated);
    this._emitAgentUpdate(updated);
  }

  abortAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return Promise.resolve();

    const abortActivities: AgentActivity[] = [
      ...(agent.activities ?? []),
      {
        id: this._activityId('abort'),
        timestamp: Date.now(),
        type: 'status_change',
        content: 'Run aborted by operator. Agent is idle.',
        metadata: { demo: true, from: agent.status, to: 'idle' },
      },
    ];

    const updated: ExawattAgent = {
      ...agent,
      status: 'idle',
      lastActivityAt: Date.now(),
      activities: abortActivities.slice(-80),
    };

    this.agents.set(agentId, updated);
    this._emitAgentUpdate(updated);
    return Promise.resolve();
  }

  /**
   * Returns all mock agents (for inspection / UI bridging).
   */
  getAllAgents(): ExawattAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Returns a FleetState computed from mock agents internal state.
   */
  getMockFleetState(): FleetState {
    const agentsRecord: Record<string, ExawattAgent> = {};
    for (const [id, agent] of this.agents) {
      agentsRecord[id] = agent;
    }
    return {
      agents: agentsRecord,
      metrics: this._computeMockMetrics(),
      lastUpdated: Date.now(),
    };
  }

  // ---- Cron interface (matches FleetManager cron passthroughs) ----

  listCronJobs(): Promise<ExawattCronJob[]> {
    return Promise.resolve(Array.from(this.cronJobs.values()));
  }

  addCronJob(job: ExawattCronJobCreate): Promise<ExawattCronJob> {
    const newJob: ExawattCronJob = {
      id: `cron-${Date.now()}`,
      name: job.name,
      schedule: job.schedule,
      prompt: job.prompt,
      sessionKey: job.sessionKey,
      enabled: job.enabled ?? true,
      status: 'idle',
    };
    this.cronJobs.set(newJob.id, newJob);
    return Promise.resolve(newJob);
  }

  runCronJob(jobId: string): Promise<void> {
    const job = this.cronJobs.get(jobId);
    if (job) {
      const updated: ExawattCronJob = {
        ...job,
        lastRun: Date.now(),
        status: 'idle' as const,
      };
      this.cronJobs.set(jobId, updated);
      const run: ExawattCronRun = {
        id: `run-${Date.now()}`,
        jobId,
        startedAt: Date.now(),
        completedAt: Date.now() + 1000,
        status: 'success',
      };
      const runs = this.cronRuns.get(jobId) ?? [];
      this.cronRuns.set(jobId, [run, ...runs].slice(0, 20));
      const targetAgent =
        (job.sessionKey && this.agents.get(job.sessionKey)) ||
        this._pickAgentForHeartbeat();

      if (targetAgent) {
        this._appendActivity(targetAgent.id, {
          id: this._activityId('heartbeat'),
          timestamp: Date.now(),
          type: 'tool_use',
          content: `Heartbeat ran: ${job.name}`,
          metadata: {
            demo: true,
            toolName: 'heartbeat.run',
            jobId,
            schedule: job.schedule,
          },
        });
      }
    }
    return Promise.resolve();
  }

  updateCronJob(
    jobId: string,
    patch: Partial<ExawattCronJobCreate>
  ): Promise<ExawattCronJob> {
    const job = this.cronJobs.get(jobId);
    if (!job) return Promise.reject(new Error(`Cron job ${jobId} not found`));
    const updated: ExawattCronJob = { ...job, ...patch };
    this.cronJobs.set(jobId, updated);
    return Promise.resolve(updated);
  }

  removeCronJob(jobId: string): Promise<void> {
    this.cronJobs.delete(jobId);
    return Promise.resolve();
  }

  getCronRuns(jobId: string): Promise<{ runs: ExawattCronRun[] }> {
    return Promise.resolve({ runs: this.cronRuns.get(jobId) ?? [] });
  }

  // ---- Private ----

  private _seedAgents(): void {
    const now = Date.now();
    this.cronJobs = this.cronJobs.size ? this.cronJobs : this._cloneCronJobs();
    for (const data of MOCK_AGENTS_DATA) {
      const agent = createAgent({
        ...data,
        sessionKey: data.id,
        lastActivityAt: now - Math.floor(Math.random() * 7200000),
        createdAt: now - Math.floor(Math.random() * 86400000),
        metrics: {
          ...INITIAL_AGENT_METRICS,
          tokensIn: Math.floor(Math.random() * 50000),
          tokensOut: Math.floor(Math.random() * 20000),
          estimatedCost: Math.random() * 2,
          startedAt: now - Math.floor(Math.random() * 3600000),
        },
        activities: [
          {
            id: this._activityId('seed'),
            timestamp: now - Math.floor(Math.random() * 5400000),
            type: 'status_change',
            content: `Session entered ${data.status} state.`,
            metadata: { demo: true, status: data.status },
          },
        ],
      });

      // Add blocker info for blocked agents
      if (data.status === 'blocked') {
        // Gamma is seeded as the deterministic hero blocker: a stable
        // credentials_needed blocker created oldest, so selectOperatorQueue
        // (oldest-first) always lifts it into the attention lane on load.
        const isPrimaryHero = data.id === 'demo-gamma';
        const blocker = isPrimaryHero
          ? MOCK_BLOCKERS[3]! // credentials_needed: 'Stripe API keys required'
          : MOCK_BLOCKERS[Math.floor(Math.random() * MOCK_BLOCKERS.length)]!;
        agent.blockerInfo = {
          ...blocker,
          createdAt: isPrimaryHero
            ? now - 3_000_000
            : now - Math.floor(Math.random() * 1_500_000),
        };
        agent.activities = [
          ...(agent.activities ?? []),
          {
            id: this._activityId('blocked'),
            timestamp: agent.blockerInfo.createdAt,
            type: 'blocker_created',
            content: agent.blockerInfo.title,
            metadata: { demo: true, blocker: agent.blockerInfo },
          },
        ];
      }

      this.agents.set(agent.id, agent);
    }

    // Fleet-scale (V0.5): top up with synthetic agents for medium/large demos.
    // The 8 hand-authored agents (incl. Gamma, the deterministic credentials
    // hero) are always present, so a stable hero exists at every scale.
    const target = SCALE_COUNTS[this.scale];
    for (let i = this.agents.size; i < target; i++) {
      const synthetic = this._makeSyntheticAgent(i, now);
      this.agents.set(synthetic.id, synthetic);
    }
  }

  private _makeSyntheticAgent(index: number, now: number): ExawattAgent {
    const status =
      SYNTHETIC_STATUSES[
        Math.floor(Math.random() * SYNTHETIC_STATUSES.length)
      ]!;
    const id = `demo-syn-${index}`;
    const agent = createAgent({
      id,
      name: `Agent ${index}`,
      // Concentrate ~1/3 into the lead Project so a large fleet has one big
      // Project (>~48 agents) that exercises the instanced tile path on drill-in,
      // while the rest spread across the others for a realistic cluster mix.
      project:
        index % 3 === 0
          ? SYNTHETIC_PROJECTS[0]!
          : SYNTHETIC_PROJECTS[1 + (index % (SYNTHETIC_PROJECTS.length - 1))]!,
      goal: SYNTHETIC_GOALS[index % SYNTHETIC_GOALS.length]!,
      status,
      sessionKey: id,
      lastActivityAt: now - Math.floor(Math.random() * 7200000),
      createdAt: now - Math.floor(Math.random() * 86400000),
      metrics: {
        ...INITIAL_AGENT_METRICS,
        tokensIn: Math.floor(Math.random() * 50000),
        tokensOut: Math.floor(Math.random() * 20000),
        estimatedCost: Math.random() * 2,
        costRate: Math.random() * 1.5,
        startedAt: now - Math.floor(Math.random() * 3600000),
      },
      activities: [
        {
          id: this._activityId('seed'),
          timestamp: now - Math.floor(Math.random() * 5400000),
          type: 'status_change',
          content: `Session entered ${status} state.`,
          metadata: { demo: true, status, synthetic: true },
        },
      ],
    });
    if (status === 'blocked') {
      const blocker =
        MOCK_BLOCKERS[Math.floor(Math.random() * MOCK_BLOCKERS.length)]!;
      agent.blockerInfo = {
        ...blocker,
        // Newer than Gamma's seeded blocker so the default-load hero is stable.
        createdAt: now - Math.floor(Math.random() * 1_500_000),
      };
      agent.activities = [
        ...(agent.activities ?? []),
        {
          id: this._activityId('blocked'),
          timestamp: agent.blockerInfo.createdAt,
          type: 'blocker_created',
          content: agent.blockerInfo.title,
          metadata: { demo: true, blocker: agent.blockerInfo },
        },
      ];
    }
    return agent;
  }

  private _pushAllAgentsToManager(): void {
    if (!this.fleetManager) return;
    this.fleetManager.seedAgents(Array.from(this.agents.values()));
  }

  private _scheduleTick(): void {
    const multiplier = SPEED_MULTIPLIERS[this.speed];
    const interval = BASE_TICK_INTERVAL_MS / multiplier;
    this.tickTimer = setTimeout(() => {
      if (this.running) {
        this._tick();
        this._scheduleTick();
      }
    }, interval);
  }

  private _tick(): void {
    for (const agent of this.agents.values()) {
      this._evolveAgent(agent);
    }
  }

  private _evolveAgent(agent: ExawattAgent): void {
    const roll = Math.random();

    if (agent.status === 'blocked') {
      // Blocked agents stay blocked until resolveBlocker() is called
      return;
    }

    if (agent.status === 'working') {
      // 30% chance to get a blocker
      if (roll < 0.3) {
        const blocker =
          MOCK_BLOCKERS[Math.floor(Math.random() * MOCK_BLOCKERS.length)]!;
        const updated: ExawattAgent = {
          ...agent,
          status: 'blocked',
          blockerInfo: { ...blocker, createdAt: Date.now() },
          lastActivityAt: Date.now(),
        };
        this.agents.set(agent.id, updated);
        this._emitAgentUpdate(updated);
        return;
      }
      // 10% chance to move to reviewing
      if (roll < 0.4) {
        const updated: ExawattAgent = {
          ...agent,
          status: 'reviewing',
          lastActivityAt: Date.now(),
        };
        this.agents.set(agent.id, updated);
        this._emitAgentUpdate(updated);
        return;
      }
      // 5% chance of error
      if (roll < 0.45) {
        const updated: ExawattAgent = {
          ...agent,
          status: 'error',
          lastActivityAt: Date.now(),
        };
        this.agents.set(agent.id, updated);
        this._emitAgentUpdate(updated);
        return;
      }
      // Otherwise, emit a chat message (keep working)
      this._emitChatMessage(agent);
      this._updateMetrics(agent);
      return;
    }

    if (agent.status === 'idle') {
      // 20% chance to start working
      if (roll < 0.2) {
        const updated: ExawattAgent = {
          ...agent,
          status: 'working',
          metrics: { ...agent.metrics, startedAt: Date.now() },
          lastActivityAt: Date.now(),
        };
        this.agents.set(agent.id, updated);
        this._emitAgentUpdate(updated);
      }
      return;
    }

    if (agent.status === 'reviewing') {
      // 40% chance to complete
      if (roll < 0.4) {
        const updated: ExawattAgent = {
          ...agent,
          status: 'complete',
          lastActivityAt: Date.now(),
        };
        this.agents.set(agent.id, updated);
        this._emitAgentUpdate(updated);
      }
      return;
    }

    if (agent.status === 'complete' || agent.status === 'error') {
      // 15% chance to restart (pick up new work)
      if (roll < 0.15) {
        const updated: ExawattAgent = {
          ...agent,
          status: 'idle',
          lastActivityAt: Date.now(),
        };
        this.agents.set(agent.id, updated);
        this._emitAgentUpdate(updated);
      }
    }
  }

  private _emitChatMessage(agent: ExawattAgent): void {
    if (!this.fleetManager) return;
    const content =
      MOCK_CHAT_MESSAGES[
        Math.floor(Math.random() * MOCK_CHAT_MESSAGES.length)
      ]!;
    const activity: AgentActivity = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      type: 'chat_message',
      content,
    };

    const updated: ExawattAgent = {
      ...agent,
      lastActivityAt: Date.now(),
      activities: [...(agent.activities ?? []), activity].slice(-50),
    };
    this.agents.set(agent.id, updated);

    this.fleetManager.emit('chat:message', { agentId: agent.id, activity });
    this.fleetManager.upsertAgent(updated);
  }

  private _updateMetrics(agent: ExawattAgent): void {
    if (!this.fleetManager) return;
    const newTokensIn =
      agent.metrics.tokensIn + Math.floor(Math.random() * 500);
    const newTokensOut =
      agent.metrics.tokensOut + Math.floor(Math.random() * 200);
    const costDelta = 0.001 + Math.random() * 0.005;
    const newCost = agent.metrics.estimatedCost + costDelta;
    const now = Date.now();

    const updated: ExawattAgent = {
      ...agent,
      metrics: {
        ...agent.metrics,
        tokensIn: newTokensIn,
        tokensOut: newTokensOut,
        estimatedCost: newCost,
        turnCount: agent.metrics.turnCount + 1,
        duration: agent.metrics.startedAt ? now - agent.metrics.startedAt : 0,
        costHistory: [
          ...agent.metrics.costHistory,
          { timestamp: now, cumulativeCost: newCost },
        ].slice(-60),
        costRate: 0, // let FleetManager compute from history
      },
    };
    this.agents.set(agent.id, updated);

    this.fleetManager.upsertAgent(updated);
  }

  private _emitAgentUpdate(agent: ExawattAgent): void {
    if (!this.fleetManager) return;
    this.fleetManager.upsertAgent(agent);
  }

  private _appendActivity(agentId: string, activity: AgentActivity): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const updated: ExawattAgent = {
      ...agent,
      lastActivityAt: activity.timestamp,
      activities: [...(agent.activities ?? []), activity].slice(-80),
    };

    this.agents.set(agentId, updated);
    this.fleetManager?.emit(
      activity.type === 'tool_use' ? 'chat:tool' : 'chat:message',
      { agentId, activity }
    );
    this.fleetManager?.upsertAgent(updated);
  }

  private _mergeAgent(
    agentId: string,
    patch: Partial<ExawattAgent>
  ): ExawattAgent | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const updated = { ...agent, ...patch };
    this.agents.set(agentId, updated);
    this._emitAgentUpdate(updated);
    return updated;
  }

  private _pickAgentForHeartbeat(): ExawattAgent | undefined {
    return Array.from(this.agents.values()).find(
      agent => agent.status !== 'blocked' && agent.status !== 'error'
    );
  }

  private _cloneCronJobs(): Map<string, ExawattCronJob> {
    return new Map(
      MOCK_CRON_JOBS.map(job => [
        job.id,
        {
          ...job,
          lastRun: job.lastRun,
          nextRun: job.nextRun,
        },
      ])
    );
  }

  private _activityId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private _computeMockMetrics(): FleetMetrics {
    let activeCount = 0;
    let blockedCount = 0;
    let idleCount = 0;
    let totalCost = 0;
    let totalTokens = 0;
    let totalCostRate = 0;
    const costByProject: Record<string, number> = {};

    for (const agent of this.agents.values()) {
      switch (agent.status) {
        case 'working':
        case 'reviewing':
          activeCount++;
          break;
        case 'blocked':
          blockedCount++;
          break;
        case 'idle':
        case 'complete':
        case 'error':
          idleCount++;
          break;
      }

      totalCost += agent.metrics.estimatedCost;
      totalTokens += agent.metrics.tokensIn + agent.metrics.tokensOut;
      totalCostRate += agent.metrics.costRate;

      if (agent.project) {
        costByProject[agent.project] =
          (costByProject[agent.project] ?? 0) + agent.metrics.estimatedCost;
      }
    }

    return {
      activeCount,
      blockedCount,
      idleCount,
      totalCost,
      totalTokens,
      totalCostRate,
      costByProject,
    };
  }
}
