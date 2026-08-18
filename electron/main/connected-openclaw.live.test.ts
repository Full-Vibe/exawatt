import { describe, expect, it, vi } from 'vitest';
import {
  adaptOpenClawTopology,
  projectAgentTopology,
  AGENT_PROJECTION_VERSION,
  type AgentProjectionMapping,
} from '@exawatt/core';
import { OCClient } from '@exawatt/core';
import {
  bootstrapGatewayCredential,
  createSshRemoteExec,
} from './gateway-bootstrap';
import { openSshTunnel } from './ssh-tunnel';

vi.mock('electron', () => ({}));

/**
 * Live proof of the C1 chain against real infrastructure (ENG-010).
 *
 * Skipped unless an operator opts in, because it needs servers only they can
 * reach. Nothing about it is hermetic and nothing about it belongs in CI:
 *
 *   EXAWATT_LIVE_OPENCLAW_ALIASES=my-alias,my-other-alias \
 *     npx vitest run electron/main/connected-openclaw.live.test.ts
 *
 * Alias names come from the environment so no operator's infrastructure is
 * named in this repository. Every call below is read-scoped; the run must not
 * be able to change anything on the server even if it is wrong.
 */

const ALIASES = (process.env.EXAWATT_LIVE_OPENCLAW_ALIASES ?? '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

/**
 * The production client, not a hand-rolled socket. Proving the real
 * `OCClient` completes its device handshake through the forwarded port at
 * `operator.read` is the point: a bespoke probe client could pass while the
 * shipping one fails.
 */
async function connectReadOnly(localPort: number, token: string) {
  const client = new OCClient({
    url: `ws://127.0.0.1:${localPort}`,
    token,
    scopes: ['operator.read'],
    clientId: 'gateway-client',
    clientMode: 'backend',
    clientVersion: 'exawatt-live-probe',
    clientPlatform: process.platform,
    requestTimeoutMs: 20_000,
  });
  await client.connect();
  return client;
}

describe.skipIf(ALIASES.length === 0)('live OpenClaw source', () => {
  it.each(ALIASES)(
    'observes %s read-only and projects its coworkers',
    async alias => {
      const bootstrap = await bootstrapGatewayCredential(
        alias,
        createSshRemoteExec()
      );
      expect(bootstrap.ok, JSON.stringify(bootstrap)).toBe(true);
      if (!bootstrap.ok) return;

      const opened = await openSshTunnel({
        alias,
        remotePort: bootstrap.facts.gatewayPort,
      });
      expect(opened.ok, JSON.stringify(opened)).toBe(true);
      if (!opened.ok) return;

      const gateway = await connectReadOnly(
        opened.tunnel.localPort,
        bootstrap.facts.sharedToken
      );

      try {
        const agentsList = (await gateway.call('agents.list')) as {
          agents: { id: string }[];
        };
        expect(Array.isArray(agentsList.agents)).toBe(true);
        expect(agentsList.agents.length).toBeGreaterThan(0);

        const sessionLists: { nativeAgentId: string; payload: unknown }[] = [];
        for (const agent of agentsList.agents) {
          sessionLists.push({
            nativeAgentId: agent.id,
            payload: await gateway.call('sessions.list', {
              agentId: agent.id,
              limit: 200,
            }),
          });
        }

        const adapted = adaptOpenClawTopology({
          configuredSourceId: `live-${alias}`,
          gatewayId: `live-gateway-${alias}`,
          placement: 'customer-hosted',
          evidenceBasis: 'observed',
          observedAt: Date.now(),
          agentsList,
          sessionLists,
        });
        expect(adapted.ok, JSON.stringify(adapted.issues?.slice(0, 5))).toBe(
          true
        );
        if (!adapted.ok) return;

        // The snapshot the C0 kernel consumes must come back clean from real
        // topology, not only from fixtures.
        const mappings: AgentProjectionMapping[] = adapted.snapshot.agents.map(
          agent => ({
            configuredSourceId: agent.configuredSourceId,
            nativeAgentId: agent.nativeAgentId,
            exawattAgentId: `exawatt-${agent.nativeAgentId}`,
            projectId: `project-${agent.nativeAgentId}`,
            displayNameOverride: null,
          })
        );
        const projected = projectAgentTopology([adapted.snapshot], {
          projectionVersion: AGENT_PROJECTION_VERSION,
          mappings,
        });
        expect(projected.ok, JSON.stringify(projected.issues.slice(0, 5))).toBe(
          true
        );
        if (!projected.ok) return;

        expect(projected.projection.agents.length).toBe(
          agentsList.agents.length
        );

        // Context kinds must come from session keys. A gateway with cron work
        // and no conversation is a real case, so a null primary is allowed and
        // a fabricated one is not.
        for (const agent of projected.projection.agents) {
          const mains = agent.contexts.filter(
            context => context.kind === 'main'
          );
          expect(mains.length).toBeLessThanOrEqual(1);
          if (mains.length === 0) {
            expect(agent.primaryConversation).toBeNull();
          } else {
            expect(agent.primaryConversation?.nativeContextId).toBe(
              mains[0].nativeContextId
            );
          }
        }

        // The read scope is the source's own enforcement, so a write must be
        // refused by the server rather than merely skipped by Exawatt.
        await expect(
          gateway.call('chat.send', { key: 'agent:none:main', text: 'x' })
        ).rejects.toThrow();
      } finally {
        gateway.disconnect();
        await opened.tunnel.close();
      }
    },
    120_000
  );
});
