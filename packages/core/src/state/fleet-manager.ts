import { TypedEmitter, type CoreEventMap } from '../events/emitter';
import type { ExawattAgent, AgentActivity } from '../types/agent';
import type { FleetState, FleetMetrics } from '../types/fleet';
import type { OCClient } from '../oc/client';
import type { OCMethods } from '../oc/methods';
import { ChatAdapter } from '../adapters/chat-adapter';
import { FleetAdapter } from '../adapters/fleet-adapter';
import type { OCCronJob } from '../oc/protocol-types';

const COST_WINDOW_MS = 10 * 60 * 1000;

export class FleetManager extends TypedEmitter<CoreEventMap> {
  private agents = new Map<string, ExawattAgent>();
  private fleetAdapter: FleetAdapter | null = null;
  private chatAdapter: ChatAdapter | null = null;
  private methods: OCMethods | null = null;

  connect(client: OCClient, methods: OCMethods): void {
    this.methods = methods;
    this.fleetAdapter = new FleetAdapter(client, methods);
    this.chatAdapter = new ChatAdapter(client, methods);

    this.chatAdapter.on('chat:message', ({ agentId, activity }) => {
      this._updateAgentActivity(agentId, activity);
    });

    this.chatAdapter.on('chat:tool', ({ agentId, activity }) => {
      this._updateAgentActivity(agentId, activity);
    });

    client.on('connection:status', status => {
      this.emit('connection:status', status);
      if (status === 'connected') {
        void this.refresh();
      }
    });

    client.on('connection:error', error => {
      this.emit('connection:error', error);
    });
  }

  disconnect(): void {
    this.chatAdapter?.destroy();
    this.chatAdapter = null;
    this.fleetAdapter = null;
    this.methods = null;
  }

  getChatAdapter(): ChatAdapter | null {
    return this.chatAdapter;
  }

  getAgent(id: string): ExawattAgent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): ExawattAgent[] {
    return Array.from(this.agents.values());
  }

  getFleetState(): FleetState {
    const agentsRecord: Record<string, ExawattAgent> = {};
    for (const [id, agent] of this.agents) {
      agentsRecord[id] = agent;
    }
    return {
      agents: agentsRecord,
      metrics: this._computeMetrics(),
      lastUpdated: Date.now(),
    };
  }

  getBlockedAgents(): ExawattAgent[] {
    return this.getAllAgents().filter(a => a.status === 'blocked');
  }

  getCostReport(timeWindowMs?: number): {
    totalCost: number;
    costRate: number;
    costByAgent: Record<string, number>;
    costByProject: Record<string, number>;
  } {
    const window = timeWindowMs ?? COST_WINDOW_MS;
    const cutoff = Date.now() - window;

    let totalCost = 0;
    let totalCostRate = 0;
    const costByAgent: Record<string, number> = {};
    const costByProject: Record<string, number> = {};

    for (const agent of this.agents.values()) {
      const agentCost = agent.metrics.estimatedCost;
      totalCost += agentCost;
      costByAgent[agent.id] = agentCost;

      if (agent.project) {
        costByProject[agent.project] =
          (costByProject[agent.project] ?? 0) + agentCost;
      }

      const recent = agent.metrics.costHistory.filter(
        s => s.timestamp >= cutoff
      );
      if (recent.length >= 2) {
        const first = recent[0]!;
        const last = recent[recent.length - 1]!;
        const deltaMs = last.timestamp - first.timestamp;
        const deltaCost = last.cumulativeCost - first.cumulativeCost;
        if (deltaMs > 0) {
          totalCostRate += (deltaCost / deltaMs) * 3_600_000;
        }
      }
    }

    return { totalCost, costRate: totalCostRate, costByAgent, costByProject };
  }

  async listCronJobs(): Promise<OCCronJob[]> {
    if (!this.methods) throw new Error('FleetManager not connected');
    const result = await this.methods.cronList();
    return result.jobs;
  }

  async addCronJob(
    job: Parameters<OCMethods['cronAdd']>[0]
  ): Promise<OCCronJob> {
    if (!this.methods) throw new Error('FleetManager not connected');
    return this.methods.cronAdd(job);
  }

  async runCronJob(jobId: string): Promise<void> {
    if (!this.methods) throw new Error('FleetManager not connected');
    return this.methods.cronRun(jobId);
  }

  async updateCronJob(
    jobId: string,
    patch: Parameters<OCMethods['cronUpdate']>[1]
  ): Promise<OCCronJob> {
    if (!this.methods) throw new Error('FleetManager not connected');
    return this.methods.cronUpdate(jobId, patch);
  }

  async removeCronJob(jobId: string): Promise<void> {
    if (!this.methods) throw new Error('FleetManager not connected');
    return this.methods.cronRemove(jobId);
  }

  async getCronRuns(jobId: string) {
    if (!this.methods) throw new Error('FleetManager not connected');
    return this.methods.cronRuns(jobId);
  }

  async refresh(): Promise<void> {
    if (!this.fleetAdapter) return;

    const freshAgents = await this.fleetAdapter.fetchAgents();

    for (const agent of freshAgents) {
      const existing = this.agents.get(agent.id);
      if (existing) {
        this.agents.set(agent.id, {
          ...existing,
          status: agent.status,
          lastActivityAt: agent.lastActivityAt,
          cronJobId: agent.cronJobId,
        });
      } else {
        this.agents.set(agent.id, agent);
        this.emit('agent:created', agent);
      }
    }

    this.emit('fleet:updated', this.getFleetState());
  }

  private _updateAgentActivity(agentId: string, activity: AgentActivity): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const existingActivities = agent.activities ?? [];
    const existingIndex = existingActivities.findIndex(
      a => a.id === activity.id
    );
    const nextActivities =
      existingIndex >= 0
        ? existingActivities.map((a, idx) =>
            idx === existingIndex ? activity : a
          )
        : [...existingActivities, activity];

    const updatedAgent: ExawattAgent = {
      ...agent,
      lastActivityAt: activity.timestamp,
      activities: nextActivities.slice(-100),
    };

    if (activity.type === 'chat_message' && agent.status === 'idle') {
      updatedAgent.status = 'working';
    }

    this.agents.set(agentId, updatedAgent);
    this.emit('agent:updated', updatedAgent);
    this.emit('fleet:updated', this.getFleetState());
  }

  private _computeMetrics(): FleetMetrics {
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
