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
    project: 'Demo Project A',
    goal: 'Improve onboarding flow and add analytics tracking to key conversion steps',
    status: 'working',
  },
  {
    id: 'demo-beta',
    name: 'Beta',
    project: 'Demo Project B',
    goal: 'Audit and fix all TypeScript errors in the legacy module, add missing tests',
    status: 'idle',
  },
  {
    id: 'demo-gamma',
    name: 'Gamma',
    project: 'Demo Project C',
    goal: 'Research competitor pricing, compile report with recommendations',
    status: 'blocked',
  },
  {
    id: 'demo-delta',
    name: 'Delta',
    project: 'Demo Project D',
    goal: 'Migrate database schema to support multi-tenancy',
    status: 'complete',
  },
  {
    id: 'demo-epsilon',
    name: 'Epsilon',
    project: 'Demo Project E',
    goal: 'Build marketing landing page with A/B test variants',
    status: 'idle',
  },
  {
    id: 'demo-zeta',
    name: 'Zeta',
    project: 'Demo Project F',
    goal: 'Performance optimization sprint: reduce bundle size by 40%',
    status: 'working',
  },
  {
    id: 'demo-eta',
    name: 'Eta',
    project: 'Demo Project G',
    goal: 'Review and merge 12 open PRs, resolve conflicts',
    status: 'reviewing',
  },
  {
    id: 'demo-theta',
    name: 'Theta',
    project: 'Demo Project H',
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
  'Analyzing the codebase structure and identifying key files...',
  'Found 12 components that need updates for the new design system.',
  'Implementing the responsive grid layout with 4 columns on desktop...',
  'Running tests to verify the authentication flow works correctly.',
  'Applying the favicon fix — creating SVG version and ICO fallback.',
  'Setting up the live visitor counter with WebSocket connection.',
  'Generating testimonials section with 3 customer quotes and avatars.',
  'Building comparison page with feature matrix and pricing table.',
  'All changes committed. Opening PR for review.',
];

export class MockFleetTransport {
  private fleetManager: FleetManager | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private speed: SimulationSpeed = 'realistic';
  private running = false;
  private agents = new Map<string, ExawattAgent>();
  private cronJobs = new Map<string, ExawattCronJob>(
    MOCK_CRON_JOBS.map(j => [j.id, j])
  );
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

  reset(): void {
    this.stop();
    this.agents.clear();
    this._seedAgents();
    if (this.fleetManager) {
      this._pushAllAgentsToManager();
    }
  }

  resolveBlocker(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'blocked') return;

    const updated: ExawattAgent = {
      ...agent,
      status: 'working',
      blockerInfo: undefined,
      lastActivityAt: Date.now(),
    };
    this.agents.set(agentId, updated);
    this._emitAgentUpdate(updated);
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
      });

      // Add blocker info for blocked agents
      if (data.status === 'blocked') {
        const blocker =
          MOCK_BLOCKERS[Math.floor(Math.random() * MOCK_BLOCKERS.length)]!;
        agent.blockerInfo = {
          ...blocker,
          createdAt: now - Math.floor(Math.random() * 1800000),
        };
      }

      this.agents.set(agent.id, agent);
    }
  }

  private _pushAllAgentsToManager(): void {
    if (!this.fleetManager) return;
    for (const agent of this.agents.values()) {
      this.fleetManager.emit('agent:created', agent);
    }
    this.fleetManager.emit('fleet:updated', this.getMockFleetState());
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
    this.fleetManager.emit('agent:updated', updated);
    this.fleetManager.emit('fleet:updated', this.getMockFleetState());
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

    this.fleetManager.emit('agent:updated', updated);
  }

  private _emitAgentUpdate(agent: ExawattAgent): void {
    if (!this.fleetManager) return;
    this.fleetManager.emit('agent:updated', agent);
    this.fleetManager.emit('fleet:updated', this.getMockFleetState());
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
