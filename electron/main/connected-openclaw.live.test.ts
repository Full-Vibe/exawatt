import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn as nodeSpawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  adaptOpenClawTopology,
  projectAgentTopology,
  AGENT_PROJECTION_VERSION,
  type AgentProjectionMapping,
} from '@exawatt/core';
import { OCClient, type OCClientConfig } from '@exawatt/core';
import {
  bootstrapGatewayCredentialOverSsh,
  createSshRemoteExec,
  resolveGatewayCredential,
} from './gateway-bootstrap';
import {
  ConnectedGatewaySession,
  describeExawattClient,
} from './connected-gateway';
import {
  ConnectedSourceStore,
  type AddConnectedSourceInput,
} from './connected-source-store';
import {
  FileConnectedAgentProjectionPlanStore,
  deriveRemoteAgentId,
} from './connected-agent-projection-plan';
import {
  ConnectedSourceRuntime,
  type ConnectedSourceStatusView,
  type DiscoveredSourceAgent,
  type RemoteAgentView,
} from './connected-source-runtime';
import {
  buildSshArgs,
  openSshTunnel,
  type SshDestination,
  type SshTunnel,
} from './ssh-tunnel';

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

/** Every call in this probe addresses an alias from the operator's own config. */
function sshTarget(alias: string) {
  return { kind: 'ssh-alias' as const, alias };
}

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

/**
 * The device listing, as the source itself reports it.
 *
 * Every cleanup and custody assertion below reads this one listing, and it is
 * addressed by DESTINATION rather than by alias so the manual transport can
 * verify and clean up after itself with the same code the alias path uses. A
 * second copy of the cleanup for the second transport would be a second chance
 * to leave a dead device on someone's server.
 */
async function deviceListing(destination: SshDestination): Promise<{
  pending: unknown[];
  paired: { deviceId?: string; scopes?: string[] }[];
}> {
  const listed = await createSshRemoteExec()(destination, [
    'openclaw',
    'devices',
    'list',
    '--json',
  ]);
  if (listed.code !== 0) return { pending: [], paired: [] };
  try {
    const parsed = JSON.parse(listed.stdout) as {
      pending?: unknown[];
      paired?: { deviceId?: string; scopes?: string[] }[];
    };
    return { pending: parsed.pending ?? [], paired: parsed.paired ?? [] };
  } catch {
    // An unreadable listing means no cleanup target, never a guess.
    return { pending: [], paired: [] };
  }
}

/** Device ids the source currently has paired, addressed by destination. */
async function pairedDeviceIdsOn(
  destination: SshDestination
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const device of (await deviceListing(destination)).paired) {
    if (typeof device.deviceId === 'string') ids.add(device.deviceId);
  }
  return ids;
}

/** Device ids the source currently has paired. */
async function pairedDeviceIds(alias: string): Promise<Set<string>> {
  return await pairedDeviceIdsOn(sshTarget(alias));
}

/** The scopes the source recorded for one device, addressed by destination. */
async function pairedDeviceScopesOn(
  destination: SshDestination,
  deviceId: string
): Promise<string[] | null> {
  const paired = (await deviceListing(destination)).paired;
  return paired.find(device => device.deviceId === deviceId)?.scopes ?? null;
}

/** The scopes the source recorded for one device. */
async function pairedDeviceScopes(
  alias: string,
  deviceId: string
): Promise<string[] | null> {
  return await pairedDeviceScopesOn(sshTarget(alias), deviceId);
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
async function removeDevicesCreatedOn(
  destination: SshDestination,
  before: Set<string>
): Promise<void> {
  const exec = createSshRemoteExec();
  for (const id of await pairedDeviceIdsOn(destination)) {
    if (before.has(id)) continue;
    await exec(destination, ['openclaw', 'devices', 'remove', id]);
  }
}

async function removeDevicesCreatedDuringRun(
  alias: string,
  before: Set<string>
): Promise<void> {
  await removeDevicesCreatedOn(sshTarget(alias), before);
}

describe.skipIf(ALIASES.length === 0)('live OpenClaw source', () => {
  it.each(ALIASES)(
    'observes %s read-only and projects its coworkers',
    async alias => {
      const bootstrap = await bootstrapGatewayCredentialOverSsh(
        sshTarget(alias),
        createSshRemoteExec()
      );
      expect(bootstrap.ok, JSON.stringify(bootstrap)).toBe(true);
      if (!bootstrap.ok) return;

      const opened = await openSshTunnel({
        ...sshTarget(alias),
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

/* ==== ENG-010 C3 — lifecycle ============================================== */

/**
 * The lifecycle half of the same proof (ENG-010 C3).
 *
 * The block above proves one observation. This one drives the shipping runtime
 * — `ConnectedSourceStore`, `FileConnectedAgentProjectionPlanStore`,
 * `ConnectedSourceRuntime`, and a real `ConnectedGatewaySession` over a real
 * SSH tunnel — through the transitions the H1 criteria name: quit and
 * relaunch, an outage, a rename and a Project change, detach and reattach, and
 * an Agent the source retains but no longer configures.
 *
 * Nothing is simulated except the outage, and the outage is simulated by
 * closing THIS PROCESS'S OWN tunnel. The remote Gateway is never stopped,
 * restarted, reconfigured, or otherwise disturbed.
 *
 * Two rails carry the whole block, and they are the reason it is safe to point
 * at servers that are running someone's real work:
 *
 * 1. **Every call is read-scoped.** The runtime pairs at `operator.read`, its
 *    own allowlist refuses anything else, and no test here sends a message,
 *    adds or edits an automation, or asks for write authority. Asking would
 *    enqueue a pairing request the operator would have to clear by hand, which
 *    is a change to their server even though it grants nothing.
 * 2. **The source's observable state is read before the run and again after**,
 *    and asserted identical apart from the probe device this run pairs and
 *    then removes. Configured Agents, retained Agent directories, automations,
 *    and stored Session keys all have to come back unchanged. That single
 *    before/after check is the strongest available form of "never mutates the
 *    server": if a later change starts writing, this is what fails.
 *
 * Volatile fields are excluded from the comparison by name, never by
 * wildcard, because the servers hold coworkers that keep working throughout:
 * new Sessions appear, a cron job's last-run bookkeeping moves, and a device's
 * last-seen time advances. What may never move is what Exawatt could write.
 */

/** Where OpenClaw keeps one Agent's retained directory, relative to `~`. */
const SOURCE_AGENT_DIRECTORY = '.openclaw/agents';

/**
 * The automation fields a source's own operator owns.
 *
 * Everything left out is run bookkeeping the Gateway moves on its own
 * schedule: `lastRunAtMs`, `lastRunStatus`, `nextRunAtMs`, `updatedAtMs`,
 * `state`, `status`, and the delivery-status fields. Including them would make
 * the before/after check fail every time a job happened to fire mid-run, which
 * would train the next reader to ignore it. Everything listed here is
 * something only a write could change.
 */
const DURABLE_AUTOMATION_FIELDS = [
  'id',
  'name',
  'agentId',
  'enabled',
  'schedule',
  'sessionTarget',
  'wakeMode',
  'payload',
  'delivery',
  'failureAlert',
  'deleteAfterRun',
  'createdAtMs',
] as const;

/** What a device record says about custody, without its last-seen clock. */
interface ObservedDevice {
  deviceId: string;
  clientId: unknown;
  scopes: readonly string[];
}

/** One read-only photograph of everything Exawatt could plausibly disturb. */
interface ObservedSourceState {
  /** `agents.list` as the source's own CLI prints it, verbatim. */
  configuredAgents: unknown;
  /** Retained Agent directories on disk, configured or not. */
  agentDirectories: readonly string[];
  /** Automations, durable fields only. */
  automations: readonly unknown[];
  /** Every stored Session key, across every Agent. */
  sessionKeys: readonly string[];
  pairedDevices: readonly ObservedDevice[];
  /** Pairing requests waiting for a person. Must be empty before and after. */
  pendingPairings: readonly unknown[];
}

/**
 * One read-only command on the source, through the operator's own SSH
 * configuration. Every command this file runs is a listing; the exec helper's
 * own allowlist is what stops any of them from becoming something else.
 *
 * `stderr` is deliberately not in the thrown message: it names hosts, users,
 * and key paths, and this repository is public.
 */
async function readFromSource(
  alias: string,
  argv: readonly string[]
): Promise<string> {
  const result = await createSshRemoteExec()(sshTarget(alias), argv);
  if (result.code !== 0) {
    throw new Error(
      `Read-only source command failed: ${argv.join(' ')} (exit ${String(result.code)})`
    );
  }
  return result.stdout;
}

function jsonFromSource(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function durableAutomations(payload: unknown): readonly unknown[] {
  const jobs =
    (payload as { jobs?: Record<string, unknown>[] } | null)?.jobs ?? [];
  return jobs
    .map(job =>
      Object.fromEntries(
        DURABLE_AUTOMATION_FIELDS.map(field => [field, job[field] ?? null])
      )
    )
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function observedDevices(payload: unknown): {
  paired: ObservedDevice[];
  pending: unknown[];
} {
  const listing = payload as {
    paired?: { deviceId?: unknown; clientId?: unknown; scopes?: unknown }[];
    pending?: unknown[];
  } | null;
  const paired = (listing?.paired ?? [])
    .filter(device => typeof device.deviceId === 'string')
    .map(device => ({
      deviceId: device.deviceId as string,
      clientId: device.clientId ?? null,
      scopes: Array.isArray(device.scopes)
        ? [...(device.scopes as string[])].sort()
        : [],
    }))
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  return { paired, pending: listing?.pending ?? [] };
}

/** The whole photograph, in four read-only listings. */
async function observeSource(alias: string): Promise<ObservedSourceState> {
  const configuredAgents = jsonFromSource(
    await readFromSource(alias, ['openclaw', 'agents', 'list', '--json'])
  );
  const agentDirectories = (
    await readFromSource(alias, ['ls', '-1', SOURCE_AGENT_DIRECTORY])
  )
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .sort();
  const automations = durableAutomations(
    jsonFromSource(
      await readFromSource(alias, [
        'openclaw',
        'cron',
        'list',
        '--json',
        '--all',
      ])
    )
  );
  const sessions = jsonFromSource(
    await readFromSource(alias, [
      'openclaw',
      'sessions',
      'list',
      '--all-agents',
      '--json',
      '--limit',
      'all',
    ])
  ) as { sessions?: { key?: unknown }[] };
  const sessionKeys = (sessions.sessions ?? [])
    .map(session => session.key)
    .filter((key): key is string => typeof key === 'string')
    .sort();
  const devices = observedDevices(
    jsonFromSource(
      await readFromSource(alias, ['openclaw', 'devices', 'list', '--json'])
    )
  );
  return {
    configuredAgents,
    agentDirectories,
    automations,
    sessionKeys,
    pairedDevices: devices.paired,
    pendingPairings: devices.pending,
  };
}

/** Keys the source held before and no longer holds. Must always be empty. */
function lostSessionKeys(
  before: readonly string[],
  after: readonly string[]
): string[] {
  const held = new Set(after);
  return before.filter(key => !held.has(key));
}

/**
 * The native Agent ids this source retains on disk but no longer configures.
 *
 * Computed from the server rather than named here: which Agents an operator
 * retired is their business, and hard-coding one would make this test a
 * description of two particular machines.
 */
function retainedOnlyAgentIds(state: ObservedSourceState): string[] {
  const configured = new Set(
    ((state.configuredAgents as { id?: unknown }[] | null) ?? [])
      .map(agent => agent.id)
      .filter((id): id is string => typeof id === 'string')
  );
  return state.agentDirectories.filter(name => !configured.has(name));
}

/**
 * Credential storage for the probe: real encryption, key held only in this
 * process.
 *
 * The store fails closed without an encryption provider, and Electron's
 * `safeStorage` is not available here. Writing the operator's device token to
 * a temp file in the clear would be the wrong way to make the test run, so
 * this is AES-GCM under a key that is never written anywhere: the file the run
 * leaves behind is unreadable the moment the process exits, and the run
 * deletes it anyway. One provider is shared across a relaunch, which is what
 * makes the relaunch honest — the OS keychain survives a quit too.
 */
function processOnlyEncryption() {
  const key = randomBytes(32);
  return {
    isAvailable: () => true,
    encryptString: (plain: string): Buffer => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([
        cipher.update(plain, 'utf8'),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString: (encrypted: Buffer): string => {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        encrypted.subarray(0, 12)
      );
      decipher.setAuthTag(encrypted.subarray(12, 28));
      return Buffer.concat([
        decipher.update(encrypted.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

/** Poll for an effect, bounded, and say what was being waited for. */
async function waitFor(
  what: string,
  ready: () => boolean,
  timeoutMs = 90_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** One Exawatt launch: the objects a fresh process would build. */
interface ProbeLaunch {
  store: ConnectedSourceStore;
  runtime: ConnectedSourceRuntime;
}

interface LifecycleContext {
  alias: string;
  userDataDir: string;
  encryption: ReturnType<typeof processOnlyEncryption>;
  sourceInput: AddConnectedSourceInput;
  sourceId: string;
  launch: ProbeLaunch | null;
  /** Every tunnel this run opened, newest last. All are ours to close. */
  tunnels: SshTunnel[];
  sessions: Map<string, ConnectedGatewaySession>;
  before: ObservedSourceState;
  devicesBefore: Set<string>;
  retainedOnly: readonly string[];
  /** Every roster this run observed, so retirement can be checked over all. */
  rosters: { phase: string; nativeAgentIds: readonly string[] }[];
  baseline: readonly RemoteAgentView[];
  lastKnown: readonly RemoteAgentView[];
  /** Phases where a saved credential did not carry a relaunch. */
  credentialResets: string[];
  /** The source's own last words about a refused handshake, for diagnosis. */
  lastGatewayError: string | null;
}

/**
 * A launch, wired exactly as `connected-sources-ipc` wires production, with
 * two seams:
 *
 * - `openTunnel` records the tunnel it opened, so the outage case can close
 *   Exawatt's own transport instead of touching anything remote;
 * - `createSession` records the session, so an assertion can read the
 *   authoritative snapshot the session holds rather than inferring it.
 *
 * Neither seam changes what is sent. The client, the credential path, the
 * allowlist, and the pairing identity are the shipping ones.
 */
function openLaunch(context: LifecycleContext): ProbeLaunch {
  const store = new ConnectedSourceStore({
    userDataDir: context.userDataDir,
    encryption: context.encryption,
  });
  const runtime = new ConnectedSourceRuntime({
    store,
    plans: new FileConnectedAgentProjectionPlanStore(context.userDataDir),
    createSession: record => {
      const session = new ConnectedGatewaySession(record, {
        store,
        openTunnel: async (target, deps) => {
          const opened = await openSshTunnel(target, deps);
          if (opened.ok) context.tunnels.push(opened.tunnel);
          return opened;
        },
        resolveCredential: resolveGatewayCredential,
        remoteExec: createSshRemoteExec(),
        createClient: (config: OCClientConfig) => {
          const client = new OCClient(config);
          /*
           * The session turns a refused handshake into one generic sentence,
           * so the Gateway's own words are kept here. It changes nothing about
           * what is sent; it only means a failure below can name the reason
           * the source gave instead of the shape of the wait that timed out.
           */
          client.on('connection:error', error => {
            context.lastGatewayError = error.message;
          });
          return client;
        },
        now: Date.now,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: handle => clearTimeout(handle as NodeJS.Timeout),
      });
      context.sessions.set(record.id, session);
      return session;
    },
    now: Date.now,
  });
  const launch = { store, runtime };
  context.launch = launch;
  return launch;
}

/** Quit: dispose every session exactly as `before-quit` does. */
async function closeLaunch(context: LifecycleContext): Promise<void> {
  const launch = context.launch;
  context.launch = null;
  await launch?.runtime.dispose();
}

function launchOf(context: LifecycleContext): ProbeLaunch {
  const launch = context.launch;
  if (!launch) throw new Error('No launch is open.');
  return launch;
}

function statusOf(context: LifecycleContext): ConnectedSourceStatusView {
  const status = launchOf(context)
    .runtime.status()
    .find(candidate => candidate.sourceId === context.sourceId);
  if (!status) throw new Error('The source is no longer configured.');
  return status;
}

/** Identity as the roster shows it: who, from where, as whom, in which Project. */
function rosterIdentity(views: readonly RemoteAgentView[]): string[] {
  return views
    .map(view =>
      [
        view.id,
        view.nativeAgentId,
        view.displayName,
        view.projectId,
        view.primaryContextId ?? 'none',
        view.source.id,
      ].join('|')
    )
    .sort();
}

function newestObservation(views: readonly RemoteAgentView[]): number {
  return views.reduce((newest, view) => Math.max(newest, view.observedAt), 0);
}

function recordRoster(
  context: LifecycleContext,
  phase: string,
  views: readonly { nativeAgentId: string }[]
): void {
  context.rosters.push({
    phase,
    nativeAgentIds: views.map(view => view.nativeAgentId),
  });
}

/**
 * Map every configured Agent the source offered, as the Connect flow does.
 *
 * Discovery is also where a retired Agent would first get the chance to come
 * back, so what was offered is recorded here and checked with the rosters: an
 * Agent the source retains but no longer configures may be listed as retired
 * history, and may never be offered as a configured import choice.
 */
function mapDiscovered(
  context: LifecycleContext,
  phase: string,
  agents: readonly DiscoveredSourceAgent[]
): number {
  const configured = agents.filter(
    agent => agent.discoveryState === 'configured'
  );
  for (const agent of agents) {
    if (context.retainedOnly.includes(agent.nativeAgentId)) {
      expect(
        agent.discoveryState,
        `${agent.nativeAgentId} was offered as a configured Agent at "${phase}"`
      ).toBe('retired');
    }
  }
  recordRoster(
    context,
    `${phase} discovery`,
    configured.map(agent => ({ nativeAgentId: agent.nativeAgentId }))
  );
  const result = launchOf(context).runtime.mapAgents(
    context.sourceId,
    configured.map((agent, index) => ({
      nativeAgentId: agent.nativeAgentId,
      projectId: `c3-project-${index + 1}`,
      projectLabel: `C3 Project ${index + 1}`,
      displayNameOverride: null,
    }))
  );
  expect(result, JSON.stringify(result)).toEqual({
    ok: true,
    mapped: configured.length,
  });
  return configured.length;
}

/**
 * Is this launch's view of the source current, rather than merely populated?
 *
 * A retained snapshot with a dead connection is exactly what the outage case
 * is supposed to produce, so "the roster has rows" is not the question. The
 * question is whether the transport is up and the last observation is fresh,
 * which is what `live` means.
 */
function observingLive(context: LifecycleContext): boolean {
  const status = context.launch?.runtime
    .status()
    .find(candidate => candidate.sourceId === context.sourceId);
  return (
    status?.connection.state === 'live' &&
    (context.launch?.runtime.agents().length ?? 0) > 0
  );
}

/**
 * Make sure the source is actually being observed, and record it when the
 * saved credential could not carry the launch.
 *
 * A relaunch or a reconnect that cannot reuse its device credential is a
 * defect, and the relaunch and recovery tests are where it is reported. It
 * must not also make every later criterion unprovable, so this falls back to
 * pairing from the source's own shared secret exactly as a first connect
 * does, and records the phase where it had to. Every device that fallback
 * pairs is removed with the rest at the end of the run.
 */
async function ensureObserving(
  context: LifecycleContext,
  phase: string
): Promise<ProbeLaunch> {
  const launch = context.launch ?? openLaunch(context);
  await launch.runtime.observeSavedSources();
  if (observingLive(context)) return launch;
  const reconnected = await launch.runtime.connect(context.sourceId);
  if (reconnected.ok && observingLive(context)) return launch;

  context.credentialResets.push(phase);
  launch.store.clearDeviceToken(context.sourceId);
  const result = await launch.runtime.connect(context.sourceId);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(observingLive(context)).toBe(true);
  return launch;
}

describe.skipIf(ALIASES.length === 0)('live OpenClaw lifecycle', () => {
  describe.each(ALIASES)('%s', alias => {
    const context: LifecycleContext = {
      alias,
      userDataDir: '',
      encryption: processOnlyEncryption(),
      sourceInput: {
        adapterId: 'openclaw',
        placement: 'customer-hosted',
        // Names Exawatt's own record, never the operator's infrastructure.
        displayName: 'C3 lifecycle probe',
        transport: { kind: 'ssh-alias', alias, remotePort: 0 },
        credentialOwner: 'source-owned-ssh',
      },
      sourceId: '',
      launch: null,
      tunnels: [],
      sessions: new Map(),
      before: {
        configuredAgents: null,
        agentDirectories: [],
        automations: [],
        sessionKeys: [],
        pairedDevices: [],
        pendingPairings: [],
      },
      devicesBefore: new Set(),
      retainedOnly: [],
      rosters: [],
      baseline: [],
      lastKnown: [],
      credentialResets: [],
      lastGatewayError: null,
    };

    beforeAll(async () => {
      context.before = await observeSource(alias);
      context.devicesBefore = new Set(
        context.before.pairedDevices.map(device => device.deviceId)
      );
      context.retainedOnly = retainedOnlyAgentIds(context.before);
      context.userDataDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'exawatt-c3-')
      );

      /*
       * The Gateway port comes from the source's own configuration rather than
       * from a constant, so the record names the port that server declares.
       * `facts.sharedToken` is deliberately not touched here: the session
       * resolves it for itself, holds it for one pairing, and drops it.
       */
      const declared = await bootstrapGatewayCredentialOverSsh(
        sshTarget(alias),
        createSshRemoteExec()
      );
      expect(declared.ok, JSON.stringify(declared)).toBe(true);
      if (!declared.ok) return;
      context.sourceInput = {
        ...context.sourceInput,
        transport: {
          kind: 'ssh-alias',
          alias,
          remotePort: declared.facts.gatewayPort,
        },
      };

      const launch = openLaunch(context);
      const added = launch.store.add(context.sourceInput);
      expect(added.ok, JSON.stringify(added)).toBe(true);
      if (added.ok) context.sourceId = added.record.id;
    }, 120_000);

    afterAll(async () => {
      await closeLaunch(context);
      for (const tunnel of context.tunnels) await tunnel.close();
      // Only what this run created, computed against the listing taken before
      // it started. A real Exawatt device of the operator's can never match.
      await removeDevicesCreatedDuringRun(alias, context.devicesBefore);
      if (context.userDataDir) {
        fs.rmSync(context.userDataDir, { recursive: true, force: true });
      }
    }, 120_000);

    it('observes the source and places its configured coworkers', async () => {
      const launch = launchOf(context);
      const connected = await launch.runtime.connect(context.sourceId);
      expect(connected.ok, JSON.stringify(connected)).toBe(true);
      if (!connected.ok) return;
      expect(connected.agents.length).toBeGreaterThan(0);

      const mapped = mapDiscovered(context, 'first attach', connected.agents);
      const views = launch.runtime.agents();
      expect(views).toHaveLength(mapped);
      recordRoster(context, 'first observation', views);
      context.baseline = views;

      const status = statusOf(context);
      expect(status.connection.state).toBe('live');
      expect(status.identityDrift).toBe(false);
      expect(status.snapshotRevision).toBe(1);

      // One device, read-only, and the source's own record is the witness.
      const created = [...(await pairedDeviceIds(alias))].filter(
        id => !context.devicesBefore.has(id)
      );
      expect(created).toHaveLength(1);
      expect(await pairedDeviceScopes(alias, created[0])).toEqual([
        'operator.read',
      ]);
    }, 180_000);

    it('returns the same coworkers after a quit and a relaunch', async () => {
      const before = context.baseline;
      expect(before.length).toBeGreaterThan(0);

      // Quit. Sessions close; nothing remote is paused, stopped, or scheduled.
      await closeLaunch(context);

      // Reopen: a new store, a new plan store, a new runtime, the same
      // userData. This is the only thing a relaunch actually is.
      const launch = openLaunch(context);
      context.lastGatewayError = null;
      await launch.runtime.observeSavedSources();
      const views = launch.runtime.agents();
      recordRoster(context, 'after relaunch', views);

      // Observation resumes from the credential the operator already
      // approved, without asking them for anything.
      const status = statusOf(context);
      expect(
        status.connection.state,
        `the relaunch did not resume observation with the saved device credential (phase "${status.phase}", the source said "${context.lastGatewayError ?? 'nothing'}")`
      ).toBe('live');

      // Same coworkers, same Exawatt ids, same Projects, nothing duplicated.
      expect(views).toHaveLength(before.length);
      expect(rosterIdentity(views)).toEqual(rosterIdentity(before));

      // Resnapshotted authoritatively rather than replayed from a cache: the
      // content carries a newer observation than the launch that ended.
      expect(newestObservation(views)).toBeGreaterThan(
        newestObservation(before)
      );
      expect(statusOf(context).snapshotRevision).toBe(1);

      // And it reused the device credential it already had, so a relaunch
      // never accumulates devices on the operator's server.
      const created = [...(await pairedDeviceIds(alias))].filter(
        id => !context.devicesBefore.has(id)
      );
      expect(created).toHaveLength(1);
    }, 180_000);

    it('reads as reconnecting and keeps last-known content when its own tunnel drops', async () => {
      const launch = await ensureObserving(context, 'before outage');
      const lastKnown = launch.runtime.agents();
      expect(lastKnown.length).toBeGreaterThan(0);
      context.lastKnown = lastKnown;

      // The outage is ours: Exawatt's own transport, closed by Exawatt's own
      // handle. Nothing on the server is stopped, restarted, or signalled.
      context.lastGatewayError = null;
      const tunnel = context.tunnels[context.tunnels.length - 1];
      expect(tunnel).toBeDefined();
      await tunnel.close();

      await waitFor(
        'the runtime to notice its transport is gone',
        () => statusOf(context).connection.state !== 'live'
      );

      const during = launch.runtime.agents();
      expect(rosterIdentity(during)).toEqual(rosterIdentity(lastKnown));
      // Last-known, and unmistakably not current.
      expect(during.map(view => view.observedAt)).toEqual(
        lastKnown.map(view => view.observedAt)
      );
      for (const view of during) {
        expect(['reconnecting', 'stale', 'unavailable']).toContain(
          view.connection.state
        );
        expect(view.connection.stalePresentation).toBe(true);
        expect(view.connection.label).not.toBe('Live');
      }

      // Nothing anywhere says the remote work stopped. Work state is observed
      // at `observedAt` and nowhere else, so losing observation cannot move
      // it; the freshness lens is what changed, and it is a separate field.
      expect(during.map(view => view.workState)).toEqual(
        lastKnown.map(view => view.workState)
      );
      // The connection vocabulary is closed, and every word in it is about
      // Exawatt's own observation. None of it may be read as the Agent having
      // stopped, paused, finished, or failed.
      for (const view of during) {
        const detail = view.connection.detail;
        const aboutObservation =
          detail.startsWith('Last seen') ||
          [
            'Reconnecting',
            'Server unreachable',
            'Gateway not responding',
            'Unavailable',
          ].includes(detail);
        expect(
          aboutObservation,
          `"${detail}" is not a sentence about Exawatt's own observation`
        ).toBe(true);
      }
    }, 180_000);

    it('recovers observation on its own after the outage', async () => {
      // The ladder is bounded, so this settles either way rather than waiting
      // out the clock: `live` is recovery, `unavailable` is a ladder that gave
      // up. Neither is a duration assertion; both are effects.
      await waitFor('the reconnect ladder to settle', () => {
        const state = statusOf(context).connection.state;
        return state === 'live' || state === 'unavailable';
      });

      if (statusOf(context).connection.state !== 'live') {
        // One direct attempt, so the failure carries the source's own answer
        // rather than only the shape of the wait that timed out.
        const retried = await launchOf(context).runtime.connect(
          context.sourceId
        );
        expect(
          retried.ok,
          `the reconnect was refused (the source said "${context.lastGatewayError ?? 'nothing'}"): ${JSON.stringify(retried)}`
        ).toBe(true);
      }
      expect(statusOf(context).connection.state).toBe('live');
    }, 180_000);

    it('replaces its snapshot on reconnect rather than merging into it', async () => {
      const lastKnown = context.lastKnown;
      expect(lastKnown.length).toBeGreaterThan(0);
      const launch = await ensureObserving(context, 'after outage');

      const recovered = launch.runtime.agents();
      recordRoster(context, 'after outage', recovered);
      expect(rosterIdentity(recovered)).toEqual(rosterIdentity(lastKnown));
      expect(newestObservation(recovered)).toBeGreaterThan(
        newestObservation(lastKnown)
      );

      // A replacement, not a merge: the snapshot the session holds has one
      // record per Agent and one per context, and every context belongs to an
      // Agent the source still lists. A merge would show duplicates or orphans.
      const session = context.sessions.get(context.sourceId);
      const snapshot = session?.snapshot;
      expect(snapshot).toBeDefined();
      if (!snapshot) return;
      const nativeIds = snapshot.agents.map(agent => agent.nativeAgentId);
      expect(new Set(nativeIds).size).toBe(nativeIds.length);
      const contextIds = snapshot.contexts.map(
        context_ => `${context_.nativeAgentId} ${context_.nativeContextId}`
      );
      expect(new Set(contextIds).size).toBe(contextIds.length);
      const known = new Set(nativeIds);
      for (const record of snapshot.contexts) {
        expect(known.has(record.nativeAgentId)).toBe(true);
      }
    }, 180_000);

    it('renames a coworker and moves its Project without touching the source', async () => {
      const launch = await ensureObserving(context, 'before rename');
      const before = launch.runtime.agents();
      expect(before.length).toBeGreaterThan(0);
      const target = before[0];
      const sourceBefore = await observeSource(alias);
      const session = context.sessions.get(context.sourceId);
      const sourceNamesBefore = session?.snapshot?.agents.map(agent =>
        [agent.nativeAgentId, agent.displayName, agent.discoveryState].join('|')
      );

      const renamed = 'Renamed in Exawatt';
      const moved = 'c3-project-moved';
      const result = launch.runtime.mapAgents(
        context.sourceId,
        before.map(view => ({
          nativeAgentId: view.nativeAgentId,
          projectId:
            view.nativeAgentId === target.nativeAgentId
              ? moved
              : view.projectId,
          projectLabel:
            view.nativeAgentId === target.nativeAgentId
              ? 'Moved by the C3 proof'
              : view.projectLabel,
          displayNameOverride:
            view.nativeAgentId === target.nativeAgentId ? renamed : null,
        }))
      );
      expect(result).toEqual({ ok: true, mapped: before.length });

      const after = launch.runtime.agents();
      const edited = after.find(
        view => view.nativeAgentId === target.nativeAgentId
      );
      expect(edited).toBeDefined();
      // The same coworker, under a new name in a new Project.
      expect(edited?.id).toBe(target.id);
      expect(edited?.displayName).toBe(renamed);
      expect(edited?.projectId).toBe(moved);
      expect(after.map(view => view.id).sort()).toEqual(
        before.map(view => view.id).sort()
      );

      // The SOURCE is untouched: its own configuration, byte for byte.
      const sourceAfter = await observeSource(alias);
      expect(sourceAfter.configuredAgents).toEqual(
        sourceBefore.configuredAgents
      );
      expect(sourceAfter.automations).toEqual(sourceBefore.automations);
      expect(
        lostSessionKeys(sourceBefore.sessionKeys, sourceAfter.sessionKeys)
      ).toEqual([]);

      // And the source still answers with its own names and its own ids when
      // asked again, so the rename lives in Exawatt and nowhere else.
      const resnapshot = await session?.resnapshot();
      expect(resnapshot?.ok, JSON.stringify(resnapshot)).toBe(true);
      const sourceNamesAfter = session?.snapshot?.agents.map(agent =>
        [agent.nativeAgentId, agent.displayName, agent.discoveryState].join('|')
      );
      expect(sourceNamesAfter).toEqual(sourceNamesBefore);
      expect(sourceNamesAfter?.join('\n')).not.toContain(renamed);
    }, 180_000);

    it('remembers the rename and the Project across a relaunch', async () => {
      const target = context.baseline[0];
      await closeLaunch(context);

      // The plan is durable state, so a fresh process reads it back as it was.
      const plan = new FileConnectedAgentProjectionPlanStore(
        context.userDataDir
      ).read();
      const mapping = plan.mappings.find(
        candidate => candidate.nativeAgentId === target.nativeAgentId
      );
      expect(mapping?.exawattAgentId).toBe(target.id);
      expect(mapping?.displayNameOverride).toBe('Renamed in Exawatt');
      expect(mapping?.projectId).toBe('c3-project-moved');

      const launch = await ensureObserving(context, 'after rename relaunch');
      const views = launch.runtime.agents();
      recordRoster(context, 'after rename relaunch', views);
      const edited = views.find(
        view => view.nativeAgentId === target.nativeAgentId
      );
      expect(edited?.id).toBe(target.id);
      expect(edited?.displayName).toBe('Renamed in Exawatt');
      expect(edited?.projectId).toBe('c3-project-moved');
      expect(launch.runtime.agents()).toHaveLength(context.baseline.length);
    }, 180_000);

    it('detaches without removing anything on the server', async () => {
      const launch = await ensureObserving(context, 'before detach');
      const beforeDetach = await observeSource(alias);
      const detachedId = context.sourceId;

      // Production detach, in the order the IPC handler performs it: the
      // runtime releases what this process holds while the record can still
      // describe it, then the store removes the record and the credential.
      await launch.runtime.detach(detachedId);
      expect(launch.store.remove(detachedId)).toBe(true);

      // Exawatt's record is gone, along with its stored credential.
      expect(launch.store.get(detachedId)).toBeNull();
      expect(
        launch.store.listViews().some(view => view.id === detachedId)
      ).toBe(false);
      expect(launch.store.readDeviceToken(detachedId)).toBeNull();

      // And so is the projection, in this launch and not only the next one.
      expect(launch.runtime.agents()).toEqual([]);
      expect(launch.runtime.status()).toEqual([]);

      // It does not come back either: a launch after the detach has no source
      // to observe and no coworker to place.
      await closeLaunch(context);
      const reopened = openLaunch(context);
      await reopened.runtime.observeSavedSources();
      expect(reopened.runtime.status()).toEqual([]);
      expect(reopened.runtime.agents()).toEqual([]);

      // The installation kept everything: its Agents, their retained
      // directories, their Sessions, and its automations.
      const afterDetach = await observeSource(alias);
      expect(afterDetach.configuredAgents).toEqual(
        beforeDetach.configuredAgents
      );
      expect(afterDetach.agentDirectories).toEqual(
        beforeDetach.agentDirectories
      );
      expect(afterDetach.automations).toEqual(beforeDetach.automations);
      expect(
        lostSessionKeys(beforeDetach.sessionKeys, afterDetach.sessionKeys)
      ).toEqual([]);
      // Including the device Exawatt paired: detach does not reach across and
      // revoke it, which is why the source's own tooling can.
      expect(afterDetach.pairedDevices.length).toBe(
        beforeDetach.pairedDevices.length
      );
    }, 180_000);

    it('reattaches to the same coworkers rather than duplicates', async () => {
      const launch = launchOf(context);
      const added = launch.store.add(context.sourceInput);
      expect(added.ok, JSON.stringify(added)).toBe(true);
      if (!added.ok) return;
      context.sourceId = added.record.id;

      const connected = await launch.runtime.connect(context.sourceId);
      expect(connected.ok, JSON.stringify(connected)).toBe(true);
      if (!connected.ok) return;

      // The same people the first attach found, offered as themselves.
      expect(connected.agents.map(agent => agent.nativeAgentId).sort()).toEqual(
        [...context.baseline.map(view => view.nativeAgentId)].sort()
      );
      // A detached source is forgotten, so nothing is silently remapped and
      // the operator is asked where these coworkers belong.
      expect(connected.agents.every(agent => agent.mapping === null)).toBe(
        true
      );

      mapDiscovered(context, 'reattach', connected.agents);
      const views = launch.runtime.agents();
      recordRoster(context, 'after reattach', views);

      // One roster entry per coworker, and the same coworkers the first attach
      // produced: same Exawatt ids, same Projects, nobody added, nobody
      // returning as a stranger.
      expect(views).toHaveLength(context.baseline.length);
      expect(new Set(views.map(view => view.id)).size).toBe(views.length);
      expect(rosterIdentity(views)).toEqual(rosterIdentity(context.baseline));
    }, 180_000);

    it('never admits a retired Agent into the roster', async () => {
      // The read has to be trustworthy before its absence means anything: every
      // configured Agent must appear among the retained directories.
      const configuredIds = (
        (context.before.configuredAgents as { id?: unknown }[] | null) ?? []
      )
        .map(agent => agent.id)
        .filter((id): id is string => typeof id === 'string');
      expect(configuredIds.length).toBeGreaterThan(0);
      for (const id of configuredIds) {
        expect(context.before.agentDirectories).toContain(id);
      }

      expect(context.rosters.length).toBeGreaterThan(1);
      const everSeen = new Set<string>();
      for (const roster of context.rosters) {
        for (const retired of context.retainedOnly) {
          expect(
            roster.nativeAgentIds,
            `${retired} surfaced as a coworker at "${roster.phase}"`
          ).not.toContain(retired);
        }
        // Nobody the source does not configure, at any point in the run.
        for (const nativeAgentId of roster.nativeAgentIds) {
          expect(
            configuredIds,
            `${nativeAgentId} surfaced as a coworker at "${roster.phase}"`
          ).toContain(nativeAgentId);
          everSeen.add(nativeAgentId);
        }
      }
      // And the check was not vacuous: every configured Agent did appear.
      expect([...everSeen].sort()).toEqual([...configuredIds].sort());

      // Retired means retained, not removed: the directories are still there.
      const now = await observeSource(alias);
      expect(now.agentDirectories).toEqual(context.before.agentDirectories);
    }, 120_000);

    it('never had to pair again to keep observing', () => {
      /*
       * `ensureObserving` falls back to pairing from the source's own shared
       * secret whenever a saved device credential does not carry a launch, so
       * that one credential defect cannot make every later criterion
       * unprovable. Every phase named here is a transition where the device
       * the operator already approved stopped working, which is both a worse
       * posture (the admin-capable secret gets read again) and a device the
       * operator did not ask for.
       */
      expect(context.credentialResets).toEqual([]);
    });

    it('left the source exactly as it found it', async () => {
      await closeLaunch(context);
      for (const tunnel of context.tunnels) await tunnel.close();
      await removeDevicesCreatedDuringRun(alias, context.devicesBefore);

      const after = await observeSource(alias);
      expect(after.configuredAgents).toEqual(context.before.configuredAgents);
      expect(after.agentDirectories).toEqual(context.before.agentDirectories);
      expect(after.automations).toEqual(context.before.automations);
      expect(after.pairedDevices).toEqual(context.before.pairedDevices);
      // No pairing request is left waiting for the operator, because none was
      // ever made: H1 asks for read scope and never asks to be raised.
      expect(context.before.pendingPairings).toEqual([]);
      expect(after.pendingPairings).toEqual([]);
      // Sessions grow while coworkers work. None may ever disappear.
      expect(
        lostSessionKeys(context.before.sessionKeys, after.sessionKeys)
      ).toEqual([]);
    }, 180_000);
  });
});

/* ==== ENG-010 C3 — identity is not guessed ================================ */

/**
 * Identity drift, proved against two real installations and nothing else
 * (ENG-010 C3, "Native identity drift" in the project doc's risks).
 *
 * The claim under test is that Exawatt binds a projection to an observed
 * source identity and refuses to guess when the identity changes. Proving it
 * needs a source that answers as a different installation than the one the
 * projection was bound to. Nothing on either server is changed to produce
 * that: the probe redirects ITS OWN tunnel and ITS OWN credential resolution
 * from the first Gateway to the second between one attempt and the next, which
 * is exactly what a moved alias, a rebuilt server, or a repointed port forward
 * would look like from Exawatt's side.
 *
 * Credentials are held in memory and thrown away, so each attempt pairs a
 * fresh read-only device; both are removed when the test finishes.
 */
describe.skipIf(ALIASES.length < 2)('live OpenClaw identity', () => {
  it('reports drift instead of rebinding when the source answers as another installation', async () => {
    const [firstAlias, secondAlias] = ALIASES;
    const ports = new Map<string, number>();
    const devicesBefore = new Map<string, Set<string>>();
    for (const alias of [firstAlias, secondAlias]) {
      const declared = await bootstrapGatewayCredentialOverSsh(
        sshTarget(alias),
        createSshRemoteExec()
      );
      expect(declared.ok, JSON.stringify(declared)).toBe(true);
      if (!declared.ok) return;
      ports.set(alias, declared.facts.gatewayPort);
      devicesBefore.set(alias, await pairedDeviceIds(alias));
    }

    let current = firstAlias;
    const tunnels: SshTunnel[] = [];
    /*
     * A credential holder that persists nothing. Every attempt therefore pairs
     * a fresh read-only device against whichever Gateway the probe is pointing
     * at, which is what lets one session observe two installations without
     * either one's credential ever being written to disk.
     */
    const session = new ConnectedGatewaySession(
      {
        id: 'c3-identity-probe',
        adapterId: 'openclaw',
        placement: 'customer-hosted',
        displayName: 'C3 identity probe',
        transport: {
          kind: 'ssh-alias',
          alias: firstAlias,
          remotePort: ports.get(firstAlias) ?? 0,
        },
        credentialOwner: 'source-owned-ssh',
        hasDeviceCredential: false,
        grantedAuthority: 'read',
        createdAt: Date.now(),
      },
      {
        store: {
          readDeviceToken: () => null,
          readDeviceKeypair: () => null,
          writeDeviceCredential: () => ({ ok: true as const }),
          clearDeviceToken: () => {},
          setGrantedAuthority: () => true,
        },
        openTunnel: async (target, deps) => {
          const opened = await openSshTunnel(
            {
              kind: 'ssh-alias',
              alias: current,
              remotePort: ports.get(current) ?? target.remotePort,
            },
            deps
          );
          if (opened.ok) tunnels.push(opened.tunnel);
          return opened;
        },
        resolveCredential: async (transport, deps) =>
          resolveGatewayCredential(
            transport.kind === 'ssh-alias'
              ? {
                  ...transport,
                  alias: current,
                  remotePort: ports.get(current) ?? transport.remotePort,
                }
              : transport,
            deps
          ),
        remoteExec: createSshRemoteExec(),
        createClient: (config: OCClientConfig) => new OCClient(config),
        now: Date.now,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: handle => clearTimeout(handle as NodeJS.Timeout),
      }
    );

    try {
      const connected = await session.connect();
      expect(connected.ok, JSON.stringify(connected)).toBe(true);
      if (!connected.ok) return;
      const boundTo = [...connected.identity.nativeAgentIds].sort();
      expect(boundTo.length).toBeGreaterThan(0);

      // The alias now resolves to the other installation. Nothing on either
      // server moved; Exawatt's own transport did.
      current = secondAlias;
      for (const tunnel of tunnels) await tunnel.close();

      await waitFor(
        'the session to observe a different installation',
        () => session.identityDrift !== null
      );
      const drift = session.identityDrift;
      expect(drift).not.toBeNull();
      if (!drift) return;

      expect([...drift.previous.nativeAgentIds].sort()).toEqual(boundTo);
      const observed = [...drift.observed.nativeAgentIds].sort();
      expect(observed.length).toBeGreaterThan(0);
      expect(observed).not.toEqual(boundTo);
      expect(observed.some(id => boundTo.includes(id))).toBe(false);

      // Reported, not resolved. The last-known snapshot is still the one the
      // projection was bound to, and the connection stops claiming to be live
      // even though the socket is healthy.
      expect(
        [...(session.snapshot?.agents ?? [])].map(a => a.nativeAgentId).sort()
      ).toEqual(boundTo);
      expect(session.status().state).not.toBe('live');
      expect(session.phase).toBe('failed');

      // And the kernel refuses to place the old coworkers on the new
      // installation, so no surface above it can guess by name either.
      const adapted = adaptOpenClawTopology({
        configuredSourceId: 'c3-identity-probe',
        gatewayId: 'c3-identity-probe',
        placement: 'customer-hosted',
        evidenceBasis: 'observed',
        observedAt: Date.now(),
        agentsList: await session.read('agents.list'),
        sessionLists: [],
      });
      expect(adapted.ok, JSON.stringify(adapted.issues?.slice(0, 3))).toBe(
        true
      );
      if (!adapted.ok) return;
      const projected = projectAgentTopology([adapted.snapshot], {
        projectionVersion: AGENT_PROJECTION_VERSION,
        mappings: boundTo.map(nativeAgentId => ({
          configuredSourceId: 'c3-identity-probe',
          nativeAgentId,
          exawattAgentId: deriveRemoteAgentId(
            'c3-identity-probe',
            nativeAgentId
          ),
          projectId: 'c3-project-1',
          displayNameOverride: null,
        })),
      });
      expect(projected.ok).toBe(false);
      expect(
        projected.issues.some(issue => issue.code === 'missing-mapped-agent')
      ).toBe(true);
    } finally {
      await session.disconnect();
      for (const tunnel of tunnels) await tunnel.close();
      for (const [alias, before] of devicesBefore) {
        await removeDevicesCreatedDuringRun(alias, before);
      }
    }
  }, 240_000);
});

/**
 * The live twin of the regression test in `connected-gateway.test.ts`.
 *
 * A saved source is supposed to reconnect on the credential it kept, without
 * re-reading the source's admin-capable Gateway secret. That promise was
 * broken for the whole of C1 and C2: the token was persisted but the device
 * identity it was issued to was not, so the next launch presented a different
 * device and the source refused it. No fixture could see it, because a fixture
 * builds one client and a relaunch is the second one.
 *
 * This is the assertion that would have caught it: pair once, keep what a
 * launch would have kept, and connect again with only that.
 */
describe.skipIf(ALIASES.length === 0)('live OpenClaw saved credential', () => {
  it.each(ALIASES)(
    'reconnects to %s on the credential it kept, with no Gateway secret',
    async alias => {
      const boot = await bootstrapGatewayCredentialOverSsh(
        sshTarget(alias),
        createSshRemoteExec()
      );
      expect(boot.ok).toBe(true);
      if (!boot.ok) return;
      const opened = await openSshTunnel({
        ...sshTarget(alias),
        remotePort: boot.facts.gatewayPort,
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;

      const before = await pairedDeviceIds(alias);
      try {
        // The first launch: the shared secret buys a device and a token.
        const first = await connectReadOnly(
          opened.tunnel.localPort,
          boot.facts.sharedToken
        );
        const keypair = first.deviceKeypair;
        const deviceToken = first.deviceToken;
        first.disconnect();
        expect(
          keypair,
          'the client exposes the identity it minted'
        ).toBeTruthy();
        expect(deviceToken, 'the source issued a device token').toBeTruthy();
        if (!keypair || !deviceToken) return;

        // The next launch: only what was persisted. No shared secret at all,
        // which is the half of the custody promise worth proving.
        const second = new OCClient({
          url: `ws://127.0.0.1:${opened.tunnel.localPort}`,
          scopes: ['operator.read'],
          deviceKeypair: keypair,
          ...describeExawattClient(process.platform, 'exawatt-live-probe'),
          requestTimeoutMs: 20_000,
        });
        second.deviceToken = deviceToken;
        await second.connect();

        // It is the same coworker roster, read by the same device.
        const agents = (await second.call('agents.list')) as {
          agents: { id: string }[];
        };
        expect(agents.agents.length).toBeGreaterThan(0);
        second.disconnect();

        // One device for both launches, not two.
        const after = await pairedDeviceIds(alias);
        const created = [...after].filter(id => !before.has(id));
        expect(created).toHaveLength(1);
      } finally {
        await removeDevicesCreatedDuringRun(alias, before);
        await opened.tunnel.close();
      }
    },
    120_000
  );
});

/* ==== ENG-010 C1 - the manually entered server ============================= */

/**
 * Live proof of the OTHER SSH transport (ENG-010 C1).
 *
 * `ssh-alias` names a host from the operator's own SSH configuration and has
 * been proved against real servers since C1 landed. `ssh-manual` carries host,
 * login, port, and an optional key file, and it is the shape an operator gets
 * when they have no config entry for their server, which is most people
 * connecting for the first time. Until this block it had never touched a real
 * server: it was implemented, unit-tested against a fake spawn, and taken on
 * faith. A transport whose whole job is reaching someone's server does not get
 * to be taken on faith.
 *
 * Connection details come from the environment so no operator's infrastructure
 * is named in this repository:
 *
 *   EXAWATT_LIVE_OPENCLAW_MANUAL_HOST=hostname-or-ipv4 \
 *   EXAWATT_LIVE_OPENCLAW_MANUAL_USER=login \
 *   EXAWATT_LIVE_OPENCLAW_MANUAL_PORT=22 \
 *   EXAWATT_LIVE_OPENCLAW_MANUAL_IDENTITY_FILE=/absolute/path/to/key \
 *   EXAWATT_LIVE_OPENCLAW_MANUAL_ALIAS=the-same-servers-alias \
 *     npx vitest run electron/main/connected-openclaw.live.test.ts
 *
 * HOST and USER are required; PORT defaults to 22 and the key file is
 * optional, matching what the manual transport itself treats as optional.
 * ALIAS is optional and names the SAME server through the operator's SSH
 * config: supplying it turns on the equivalence assertion, which is the only
 * one that can show the two transports reach one server rather than merely
 * both working.
 *
 * Every call here is read-scoped, exactly as the alias probes above are.
 */

const MANUAL_HOST = (
  process.env.EXAWATT_LIVE_OPENCLAW_MANUAL_HOST ?? ''
).trim();
const MANUAL_USER = (
  process.env.EXAWATT_LIVE_OPENCLAW_MANUAL_USER ?? ''
).trim();
const MANUAL_PORT = Number.parseInt(
  (process.env.EXAWATT_LIVE_OPENCLAW_MANUAL_PORT ?? '22').trim() || '22',
  10
);
const MANUAL_IDENTITY_FILE =
  (process.env.EXAWATT_LIVE_OPENCLAW_MANUAL_IDENTITY_FILE ?? '').trim() || null;
const MANUAL_ALIAS = (
  process.env.EXAWATT_LIVE_OPENCLAW_MANUAL_ALIAS ?? ''
).trim();

/**
 * A wrong login is a REFUSED LOGIN on the operator's real server, and a server
 * that runs fail2ban or an equivalent counts refused logins and bans the
 * source address. Every other probe in this block is either a name that never
 * resolves, a TCP connect nothing answers, or a refusal this machine makes
 * before it spawns anything, so none of them can be counted against the
 * operator. This one can, so it is opt-in and the operator decides.
 */
const MANUAL_AUTH_PROBE =
  process.env.EXAWATT_LIVE_OPENCLAW_MANUAL_AUTH_PROBE === '1';

const MANUAL_CONFIGURED =
  MANUAL_HOST.length > 0 &&
  MANUAL_USER.length > 0 &&
  Number.isInteger(MANUAL_PORT) &&
  MANUAL_PORT >= 1 &&
  MANUAL_PORT <= 65535;

type ManualDestination = Extract<SshDestination, { kind: 'ssh-manual' }>;

function manualDestination(
  overrides: Partial<Omit<ManualDestination, 'kind'>> = {}
): ManualDestination {
  return {
    kind: 'ssh-manual',
    host: MANUAL_HOST,
    user: MANUAL_USER,
    port: MANUAL_PORT,
    identityFile: MANUAL_IDENTITY_FILE,
    ...overrides,
  };
}

/**
 * The infrastructure identity this run was handed, as the strings a failure
 * message must never contain. The unit tests check redaction against invented
 * fixtures; only a live run can check it against the operator's real values.
 */
function realIdentityStrings(): string[] {
  return [MANUAL_HOST, MANUAL_USER, String(MANUAL_PORT), MANUAL_IDENTITY_FILE]
    .filter((value): value is string => typeof value === 'string')
    .filter(value => value.length > 2);
}

function expectNoInfrastructureIdentity(message: string): void {
  expect(message.length).toBeGreaterThan(0);
  expect(message.length).toBeLessThanOrEqual(200);
  // Repo copy rule: no em dashes in operator-facing strings.
  expect(message).not.toContain('—');
  for (const value of realIdentityStrings()) {
    expect(message.toLowerCase()).not.toContain(value.toLowerCase());
  }
}

/**
 * A spawn that records the exact argument vector and then really spawns.
 *
 * Asserting `buildSshArgs` would only prove the builder agrees with itself.
 * What has to be true is that THIS vector is what reached the real `ssh` that
 * carried the tunnel that the Gateway handshake then ran through.
 */
function recordingSpawn(): {
  spawn: typeof nodeSpawn;
  calls: { command: string; args: readonly string[] }[];
} {
  const calls: { command: string; args: readonly string[] }[] = [];
  const spawn = ((command: string, args: readonly string[], options: never) => {
    calls.push({ command, args: [...args] });
    return nodeSpawn(command, args as string[], options);
  }) as unknown as typeof nodeSpawn;
  return { spawn, calls };
}

/** Whether anything is still accepting on a loopback port. */
async function loopbackAccepts(port: number): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (accepted: boolean) => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** The sorted native agent ids one Gateway reports. */
async function nativeAgentIds(client: OCClient): Promise<string[]> {
  const listed = (await client.call('agents.list')) as {
    agents: { id: string }[];
  };
  return listed.agents.map(agent => agent.id).sort();
}

describe.skipIf(!MANUAL_CONFIGURED)('live OpenClaw manual transport', () => {
  it('reaches a manually entered server and reads its coworkers read-only', async () => {
    const destination = manualDestination();

    // 1. The credential bootstrap, over the manual destination.
    const bootstrap = await bootstrapGatewayCredentialOverSsh(
      destination,
      createSshRemoteExec()
    );
    expect(
      bootstrap.ok,
      bootstrap.ok ? '' : `${bootstrap.failure}: ${bootstrap.message}`
    ).toBe(true);
    if (!bootstrap.ok) return;
    expect(bootstrap.facts.gatewayPort).toBeGreaterThan(0);
    expect(bootstrap.facts.sharedToken.length).toBeGreaterThan(0);

    // 2. The tunnel, with the exact vector recorded on its way to `ssh`.
    const recorder = recordingSpawn();
    const opened = await openSshTunnel(
      { ...destination, remotePort: bootstrap.facts.gatewayPort },
      { spawn: recorder.spawn }
    );
    expect(
      opened.ok,
      opened.ok ? '' : `${opened.failure.class}: ${opened.failure.message}`
    ).toBe(true);
    if (!opened.ok) return;

    const devicesBefore = await pairedDeviceIdsOn(destination);
    try {
      expect(recorder.calls).toHaveLength(1);
      const sent = recorder.calls[0];
      expect(sent.command).toBe('ssh');
      // The builder and the wire agree, and the wire is what carried the
      // session that is about to complete a Gateway handshake.
      expect(sent.args).toEqual(
        buildSshArgs(
          { ...destination, remotePort: bootstrap.facts.gatewayPort },
          opened.tunnel.localPort
        )
      );

      // The manual shape's own options, proved present on a vector that worked.
      expect(sent.args).toContain('-p');
      expect(sent.args[sent.args.indexOf('-p') + 1]).toBe(String(MANUAL_PORT));
      if (MANUAL_IDENTITY_FILE === null) {
        expect(sent.args).not.toContain('-i');
        expect(sent.args).not.toContain('IdentitiesOnly=yes');
      } else {
        expect(sent.args).toContain('IdentitiesOnly=yes');
        expect(sent.args[sent.args.indexOf('-i') + 1]).toBe(
          MANUAL_IDENTITY_FILE
        );
        // The key is an option, so it belongs ahead of the end-of-options mark.
        expect(sent.args.indexOf('-i')).toBeLessThan(sent.args.indexOf('--'));
      }
      expect(sent.args[sent.args.length - 2]).toBe('--');
      expect(sent.args[sent.args.length - 1]).toBe(
        `${MANUAL_USER}@${MANUAL_HOST}`
      );
      // The multiplexing refusal, on a machine whose own SSH config turns
      // ControlMaster on. Without these two the operator's control master
      // would own this forward and close() would not close it.
      expect(sent.args).toContain('ControlMaster=no');
      expect(sent.args).toContain('ControlPath=none');

      // 3. The Gateway handshake, through that tunnel, with the production
      //    client and the production identity.
      const gateway = await connectReadOnly(
        opened.tunnel.localPort,
        bootstrap.facts.sharedToken
      );
      try {
        const agentIds = await nativeAgentIds(gateway);
        expect(agentIds.length).toBeGreaterThan(0);

        // 4. Discovery: real topology through the manual transport must adapt
        //    and project as cleanly as it does through an alias.
        const sessionLists = await Promise.all(
          agentIds.map(async id => ({
            nativeAgentId: id,
            payload: await gateway.call('sessions.list', {
              agentId: id,
              limit: 200,
            }),
          }))
        );
        const adapted = adaptOpenClawTopology({
          configuredSourceId: 'live-manual',
          gatewayId: 'live-gateway-manual',
          placement: 'customer-hosted',
          evidenceBasis: 'observed',
          observedAt: Date.now(),
          agentsList: { agents: agentIds.map(id => ({ id })) },
          sessionLists,
        });
        expect(adapted.ok, JSON.stringify(adapted.issues?.slice(0, 5))).toBe(
          true
        );
        if (!adapted.ok) return;
        expect(
          adapted.snapshot.agents.map(a => a.nativeAgentId).sort()
        ).toEqual(agentIds);

        // The device this run paired carries the one scope Exawatt asked for,
        // read back from the source's own record over the manual transport.
        const created = [...(await pairedDeviceIdsOn(destination))].filter(
          id => !devicesBefore.has(id)
        );
        expect(created).toHaveLength(1);
        expect(await pairedDeviceScopesOn(destination, created[0])).toEqual([
          'operator.read',
        ]);

        // Read scope is the source's enforcement, not Exawatt's restraint, and
        // the transport does not change who enforces it.
        await expect(
          gateway.call('chat.send', { key: 'agent:none:main', text: 'x' })
        ).rejects.toThrow();
        await expect(
          gateway.call('cron.add', { name: 'probe', schedule: '0 0 * * *' })
        ).rejects.toThrow();
      } finally {
        gateway.disconnect();
      }

      // 5. close() owns the forward. This is the assertion the ControlMaster
      //    refusal exists for: with a shared control master the port would
      //    still accept after Exawatt believed it had detached.
      const localPort = opened.tunnel.localPort;
      await opened.tunnel.close();
      expect(opened.tunnel.closed).toBe(true);
      expect(await loopbackAccepts(localPort)).toBe(false);
    } finally {
      if (!opened.tunnel.closed) await opened.tunnel.close();
      await removeDevicesCreatedOn(destination, devicesBefore);
    }

    // Nothing this run created is left behind, and nothing is left pending.
    const listing = await deviceListing(destination);
    expect(listing.pending).toEqual([]);
    expect([...(await pairedDeviceIdsOn(destination))].sort()).toEqual(
      [...devicesBefore].sort()
    );
  }, 180_000);

  /**
   * The assertion that makes the manual transport EQUIVALENT rather than
   * merely also functional.
   *
   * Two transports that both connect prove nothing on their own: they could be
   * reaching two servers, or the manual one could be reaching the right server
   * through a path that resolves differently. Requiring the same native agent
   * ids from the same declared Gateway port, with the same shared secret read
   * out of the same configuration, is what makes them one server seen two ways.
   */
  it.skipIf(MANUAL_ALIAS.length === 0)(
    'returns the same coworkers as the alias for the same server',
    async () => {
      const viaAlias = sshTarget(MANUAL_ALIAS);
      const viaManual = manualDestination();

      const aliasBoot = await bootstrapGatewayCredentialOverSsh(
        viaAlias,
        createSshRemoteExec()
      );
      const manualBoot = await bootstrapGatewayCredentialOverSsh(
        viaManual,
        createSshRemoteExec()
      );
      expect(aliasBoot.ok).toBe(true);
      expect(manualBoot.ok).toBe(true);
      if (!aliasBoot.ok || !manualBoot.ok) return;

      // Same declared Gateway port, and the same shared secret. Compared, never
      // reported: this value is admin-capable and does not belong in output.
      expect(manualBoot.facts.gatewayPort).toBe(aliasBoot.facts.gatewayPort);
      expect(manualBoot.facts.sharedToken === aliasBoot.facts.sharedToken).toBe(
        true
      );
      expect(manualBoot.facts.tokenSource).toBe(aliasBoot.facts.tokenSource);
      expect(manualBoot.facts.version).toBe(aliasBoot.facts.version);

      const before = await pairedDeviceIdsOn(viaAlias);
      const idsBy: Record<string, string[]> = {};
      try {
        for (const [label, destination, boot] of [
          ['alias', viaAlias, aliasBoot],
          ['manual', viaManual, manualBoot],
        ] as const) {
          const opened = await openSshTunnel({
            ...destination,
            remotePort: boot.facts.gatewayPort,
          });
          expect(
            opened.ok,
            opened.ok ? '' : `${label}: ${opened.failure.class}`
          ).toBe(true);
          if (!opened.ok) return;
          try {
            const client = await connectReadOnly(
              opened.tunnel.localPort,
              boot.facts.sharedToken
            );
            try {
              idsBy[label] = await nativeAgentIds(client);
            } finally {
              client.disconnect();
            }
          } finally {
            await opened.tunnel.close();
          }
        }

        expect(idsBy.manual.length).toBeGreaterThan(0);
        expect(idsBy.manual).toEqual(idsBy.alias);

        // Two connections, two devices, and both of them this run's. If the
        // manual transport had reached a different installation this listing
        // would only hold one of them.
        const created = [...(await pairedDeviceIdsOn(viaManual))].filter(
          id => !before.has(id)
        );
        expect(created).toHaveLength(2);
      } finally {
        await removeDevicesCreatedOn(viaAlias, before);
      }
    },
    240_000
  );
});

/**
 * What each wrong entry field tells the operator.
 *
 * The manual transport is four fields an operator types, so the question that
 * matters is not whether a bad one fails; it is whether the failure names the
 * field. Every case below is refused either by this machine before it spawns
 * anything, by DNS, or by a TCP connect nothing answers. None of them attempts
 * a login, so none of them can be counted against the operator by a server
 * that bans on refused logins. The one case that does attempt a login is
 * opt-in and lives in its own block.
 */
describe.skipIf(!MANUAL_CONFIGURED)(
  'live OpenClaw manual transport faults',
  () => {
    /**
     * Reserved, and nothing serves SSH there. A connect nothing answers is not
     * an authentication attempt, so this is safe against a real server.
     */
    const CLOSED_SSH_PORT = 1;

    it('names the address when the server address does not resolve', async () => {
      const opened = await openSshTunnel({
        ...manualDestination({
          // RFC 6761 reserves .invalid, so this can never resolve to anyone.
          host: 'exawatt-live-probe-no-such-host.invalid',
        }),
        remotePort: 4444,
      });
      expect(opened.ok).toBe(false);
      if (opened.ok) {
        await opened.tunnel.close();
        return;
      }
      expect(opened.failure.class).toBe('host-unreachable');
      expectNoInfrastructureIdentity(opened.failure.message);
      // The operator typed an address that does not exist. Telling them to check
      // that the server is online sends them to the wrong field.
      expect(opened.failure.message.toLowerCase()).toContain('address');
    }, 60_000);

    it('names the SSH port when nothing answers on it', async () => {
      const opened = await openSshTunnel({
        ...manualDestination({ port: CLOSED_SSH_PORT }),
        remotePort: 4444,
        connectTimeoutSeconds: 8,
      });
      expect(opened.ok).toBe(false);
      if (opened.ok) {
        await opened.tunnel.close();
        return;
      }
      expect(opened.failure.class).toBe('host-unreachable');
      expectNoInfrastructureIdentity(opened.failure.message);
      expect(opened.failure.message.toLowerCase()).toContain('port');
    }, 60_000);

    it('names the key file, and never opens a connection, when it cannot be read', async () => {
      const missing = path.join(
        os.tmpdir(),
        `exawatt-live-probe-absent-key-${Date.now()}`
      );
      expect(fs.existsSync(missing)).toBe(false);

      const recorder = recordingSpawn();
      const opened = await openSshTunnel(
        {
          ...manualDestination({ identityFile: missing }),
          remotePort: 4444,
        },
        { spawn: recorder.spawn }
      );
      expect(opened.ok).toBe(false);
      if (opened.ok) {
        await opened.tunnel.close();
        return;
      }
      // Refused here, so the operator's server never sees a login attempt for a
      // key this machine already knows it cannot offer.
      expect(recorder.calls).toEqual([]);
      expect(opened.failure.class).toBe('invalid-target');
      expectNoInfrastructureIdentity(opened.failure.message);
      expect(opened.failure.message.toLowerCase()).toContain('key file');
    }, 60_000);

    it('names the key file on the credential bootstrap too', async () => {
      const missing = path.join(
        os.tmpdir(),
        `exawatt-live-probe-absent-key-${Date.now()}`
      );
      const result = await resolveGatewayCredential(
        // The bootstrap runs commands rather than forwarding a port, so the
        // Gateway's own port is not part of this question.
        { ...manualDestination({ identityFile: missing }), remotePort: 0 },
        { exec: createSshRemoteExec() }
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expectNoInfrastructureIdentity(result.message);
      expect(result.message.toLowerCase()).toContain('key file');
    }, 60_000);
  }
);

/**
 * The one fault that costs the operator's server a refused login.
 *
 * Opt in with EXAWATT_LIVE_OPENCLAW_MANUAL_AUTH_PROBE=1, and only against a
 * server that does not ban on refused logins. fail2ban's shipped sshd jail
 * bans after five failures in ten minutes with no address exempted, which is
 * two or three runs of a suite that probes a wrong login.
 */
describe.skipIf(!MANUAL_CONFIGURED || !MANUAL_AUTH_PROBE)(
  'live OpenClaw manual transport refused login',
  () => {
    it('names the login when the server refuses it', async () => {
      const opened = await openSshTunnel({
        ...manualDestination({ user: 'exawatt-live-probe-nobody' }),
        remotePort: 4444,
      });
      expect(opened.ok).toBe(false);
      if (opened.ok) {
        await opened.tunnel.close();
        return;
      }
      expect(opened.failure.class).toBe('auth-rejected');
      expectNoInfrastructureIdentity(opened.failure.message);
      expect(opened.failure.message.toLowerCase()).toContain('login');
    }, 60_000);
  }
);
