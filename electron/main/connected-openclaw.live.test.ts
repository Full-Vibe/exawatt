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
import { describeExawattClient } from './connected-gateway';
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
 * The production client and the production identity, not a hand-rolled socket
 * and not a convenient alternative profile.
 *
 * Both halves are the point. A bespoke probe client could pass while the
 * shipping `OCClient` fails, and a `backend` client would skip device pairing
 * entirely, so a probe that used one would prove nothing about the path that
 * actually ships. `describeExawattClient` is what production sends, so this
 * exercises the real handshake and leaves a real device record behind, which
 * the caller removes when the run finishes.
 */
async function connectReadOnly(localPort: number, token: string) {
  const client = new OCClient({
    url: `ws://127.0.0.1:${localPort}`,
    token,
    scopes: ['operator.read'],
    ...describeExawattClient(process.platform, 'exawatt-live-probe'),
    requestTimeoutMs: 20_000,
  });
  await client.connect();
  return client;
}

/** Device ids the source currently has paired. */
async function pairedDeviceIds(alias: string): Promise<Set<string>> {
  const exec = createSshRemoteExec();
  const listed = await exec(alias, ['openclaw', 'devices', 'list', '--json']);
  const ids = new Set<string>();
  if (listed.code !== 0) return ids;
  try {
    const paired =
      (JSON.parse(listed.stdout) as { paired?: { deviceId?: unknown }[] })
        .paired ?? [];
    for (const device of paired) {
      if (typeof device.deviceId === 'string') ids.add(device.deviceId);
    }
  } catch {
    // An unreadable listing means no cleanup target, never a guess.
  }
  return ids;
}

/** The scopes the source recorded for one device. */
async function pairedDeviceScopes(
  alias: string,
  deviceId: string
): Promise<string[] | null> {
  const listed = await createSshRemoteExec()(alias, [
    'openclaw',
    'devices',
    'list',
    '--json',
  ]);
  if (listed.code !== 0) return null;
  try {
    const paired =
      (
        JSON.parse(listed.stdout) as {
          paired?: { deviceId?: string; scopes?: string[] }[];
        }
      ).paired ?? [];
    return paired.find(device => device.deviceId === deviceId)?.scopes ?? null;
  } catch {
    return null;
  }
}

/**
 * Remove only the devices this run created.
 *
 * Every run generates a fresh keypair, so its device record is dead the moment
 * the socket closes, and leaving dead read-only credentials on someone else's
 * server is not acceptable. The target set is computed by difference against a
 * listing taken BEFORE connecting, so a real Exawatt device belonging to the
 * operator can never be caught by it: matching on client id or scopes would
 * eventually delete the very device production is supposed to keep.
 */
async function removeDevicesCreatedDuringRun(
  alias: string,
  before: Set<string>
): Promise<void> {
  const exec = createSshRemoteExec();
  for (const id of await pairedDeviceIds(alias)) {
    if (before.has(id)) continue;
    await exec(alias, ['openclaw', 'devices', 'remove', id]);
  }
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

      const devicesBefore = await pairedDeviceIds(alias);
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

        // H1: source Sessions, cron runs, and helper contexts stay
        // subordinate. Nothing beneath an Agent may surface as a coworker.
        const projectedIds = new Set(
          projected.projection.agents.map(agent => agent.nativeAgentId)
        );
        for (const agent of projected.projection.agents) {
          for (const context of agent.contexts) {
            expect(projectedIds.has(context.nativeContextId)).toBe(false);
          }
        }

        // H1: an Agent retained only as history never rejoins the roster
        // without an explicit choice. Whatever the servers still hold on
        // disk, discovery offers only what the source declares configured.
        for (const agent of projected.projection.agents) {
          expect(agent.discoveryState).toBe('configured');
        }

        // H1: Agents sharing one Gateway stay distinct coworkers.
        expect(new Set(projectedIds).size).toBe(
          projected.projection.agents.length
        );

        // H1: relaunch resnapshots authoritatively and reconciles by stable
        // identity, so observing twice must not duplicate or drift. This is
        // the quit-and-reopen promise reduced to what a probe can assert.
        const second = adaptOpenClawTopology({
          configuredSourceId: `live-${alias}`,
          gatewayId: `live-gateway-${alias}`,
          placement: 'customer-hosted',
          evidenceBasis: 'observed',
          observedAt: Date.now(),
          agentsList: (await gateway.call('agents.list')) as typeof agentsList,
          sessionLists: await Promise.all(
            agentsList.agents.map(async agent => ({
              nativeAgentId: agent.id,
              payload: await gateway.call('sessions.list', {
                agentId: agent.id,
                limit: 200,
              }),
            }))
          ),
        });
        expect(second.ok).toBe(true);
        if (second.ok) {
          const identity = (snapshot: typeof adapted.snapshot) =>
            snapshot.agents.map(agent => agent.nativeAgentId).sort();
          expect(identity(second.snapshot)).toEqual(identity(adapted.snapshot));
          const reprojected = projectAgentTopology([second.snapshot], {
            projectionVersion: AGENT_PROJECTION_VERSION,
            mappings,
          });
          expect(reprojected.ok).toBe(true);
          if (reprojected.ok) {
            expect(reprojected.projection.agents.map(a => a.id).sort()).toEqual(
              projected.projection.agents.map(a => a.id).sort()
            );
          }
        }

        // The paired device must carry exactly the scope Exawatt asked for.
        // This is the custody claim the project doc makes, checked against the
        // source's own record rather than against Exawatt's intent.
        const created = [...(await pairedDeviceIds(alias))].filter(
          id => !devicesBefore.has(id)
        );
        expect(created).toHaveLength(1);
        expect(await pairedDeviceScopes(alias, created[0])).toEqual([
          'operator.read',
        ]);

        // The read scope is the source's own enforcement, so a write must be
        // refused by the server rather than merely skipped by Exawatt. Both
        // the conversation path and the automation path are checked, because
        // H2 and H3 arrive separately and neither may leak in early.
        await expect(
          gateway.call('chat.send', { key: 'agent:none:main', text: 'x' })
        ).rejects.toThrow();
        await expect(
          gateway.call('cron.add', { name: 'probe', schedule: '0 0 * * *' })
        ).rejects.toThrow();
        await expect(gateway.call('sessions.create', {})).rejects.toThrow();
      } finally {
        gateway.disconnect();
        await opened.tunnel.close();
        await removeDevicesCreatedDuringRun(alias, devicesBefore);
      }
    },
    120_000
  );
});
