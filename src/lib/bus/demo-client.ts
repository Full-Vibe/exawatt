/**
 * The Demo `BusClient` (ENG-027 Demo Mode is first-class): Voltaic's authored
 * chatter (`DEMO_CHATTER`) stamped on the shell's clock, addressed with the
 * same Session ids the Demo Workspace's tabs carry, so the Chatter tab and
 * the Fleet board's unread counts read the Demo exactly as they read a live
 * bus. Sending is honest: the Demo has no Agents to deliver to.
 */
import {
  DEMO_BASE_AGENTS,
  DEMO_CHATTER,
  DEMO_PROJECTS_BY_KEY,
} from '@exawatt/core';
import type { BusClient } from './client';
import type { BusEndpoint, BusMessage } from './types';
import { BUS_OPERATOR } from './operator';

function endpointFor(agentId: string): BusEndpoint {
  if (agentId === BUS_OPERATOR.sessionId) return BUS_OPERATOR;
  const agent = DEMO_BASE_AGENTS.find(candidate => candidate.id === agentId);
  if (!agent) throw new Error(`Unknown demo chatter Agent ${agentId}`);
  return {
    sessionId: agent.id,
    name: agent.name,
    harness: agent.harness,
  };
}

/** The authored chatter as stamped messages, oldest first (ledger order). */
export function demoBusMessages(nowMs: number): BusMessage[] {
  return DEMO_CHATTER.map(entry => {
    const project = DEMO_PROJECTS_BY_KEY.get(entry.projectKey);
    if (!project) throw new Error(`Unknown demo Project ${entry.projectKey}`);
    return {
      id: entry.id,
      projectId: project.dir,
      from: endpointFor(entry.from),
      to: endpointFor(entry.to),
      kind: entry.from === BUS_OPERATOR.sessionId ? 'operator' : 'agent',
      at: nowMs - entry.minutesAgo * 60_000,
      text: entry.text,
      delivery: { ...entry.delivery },
    } satisfies BusMessage;
  }).sort((a, b) => a.at - b.at);
}

export const DEMO_CANNOT_SEND = 'Demo cannot send';

export function createDemoBusClient(nowMs: number): BusClient {
  const messages = demoBusMessages(nowMs);
  return {
    kind: 'demo',
    async list(projectId) {
      return {
        status: 'ok',
        messages: messages.filter(message => message.projectId === projectId),
      };
    },
    async thread(projectId, a, b) {
      return {
        status: 'ok',
        messages: messages.filter(
          message =>
            message.projectId === projectId &&
            ((message.from.sessionId === a && message.to.sessionId === b) ||
              (message.from.sessionId === b && message.to.sessionId === a))
        ),
      };
    },
    async send() {
      return { status: 'refused', reason: DEMO_CANNOT_SEND };
    },
    subscribe() {
      return () => {};
    },
  };
}
