import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import type { AgentHarness, AgentPermissionMode } from './harness-types';
import { harnessDescriptor } from './harness-registry';

const execFileAsync = promisify(execFile);

export type AgentSourceAdapterId = AgentHarness | 'openclaw' | 'demo';

export type AgentSourceState =
  | 'ready'
  | 'connecting'
  | 'action-required'
  | 'degraded'
  | 'unavailable'
  | 'not-installed'
  | 'incompatible'
  | 'unknown';

export type AgentSourceFactState =
  | 'ready'
  | 'action-required'
  | 'degraded'
  | 'unavailable'
  | 'not-installed'
  | 'incompatible'
  | 'unknown'
  | 'simulated';

export interface AgentSourceProvenance {
  kind: 'source-command' | 'source-config' | 'gateway-probe' | 'built-in';
  label: string;
  observedAt: number;
}

export interface AgentSourceFact {
  state: AgentSourceFactState;
  value: string;
  detail: string;
  provenance: AgentSourceProvenance;
}

export interface AgentSourceCapabilities {
  interactiveLaunch: boolean;
  initialTask: boolean;
  exactResume: boolean;
  modelSelection: 'live-catalog' | 'source-owned' | 'gateway' | 'scenario';
  effortSelection: 'live-catalog' | 'configured-value' | 'gateway' | 'scenario';
  permissionModes: readonly AgentPermissionMode[];
  delegationObservation: string;
  enforcementOwner: string;
}

export interface AgentSourceSnapshot {
  id: string;
  adapterId: AgentSourceAdapterId;
  harness: AgentHarness | null;
  label: string;
  connectionName: string;
  color: string;
  configured: boolean;
  launchable: boolean;
  state: AgentSourceState;
  stateLabel: string;
  summary: string;
  observedAt: number;
  facts: {
    installation: AgentSourceFact;
    reachability: AgentSourceFact;
    authentication: AgentSourceFact;
    identity: AgentSourceFact;
    compatibility: AgentSourceFact;
    modelDiscovery: AgentSourceFact;
  };
  capabilities: AgentSourceCapabilities;
  actions: {
    recheck: boolean;
    authenticate: boolean;
    chooseModel: boolean;
  };
}

export interface AgentSourceCatalogEntry {
  adapterId: AgentSourceAdapterId | 'hosted-openclaw' | 'custom';
  label: string;
  description: string;
  availability: 'configured' | 'not-installed' | 'configure' | 'coming-later';
}

export interface AgentSourceRegistrySnapshot {
  sources: AgentSourceSnapshot[];
  available: AgentSourceCatalogEntry[];
  comingLater: AgentSourceCatalogEntry[];
  observedAt: number;
}

export interface AgentSourceActionResult {
  ok: boolean;
  message: string;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function provenance(
  kind: AgentSourceProvenance['kind'],
  label: string,
  observedAt: number
): AgentSourceProvenance {
  return { kind, label, observedAt };
}

function fact(
  state: AgentSourceFactState,
  value: string,
  detail: string,
  source: AgentSourceProvenance
): AgentSourceFact {
  return { state, value, detail, provenance: source };
}

async function loginShellCommand(
  shell: string,
  command: string,
  timeout = 3_000
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(shell, ['-l', '-c', command], {
      cwd: os.homedir(),
      timeout,
      maxBuffer: 256 * 1024,
      encoding: 'utf8',
    });
    return {
      ok: true,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    const failed = error as {
      stdout?: string;
      stderr?: string;
    };
    return {
      ok: false,
      stdout: failed.stdout?.trim() ?? '',
      stderr: failed.stderr?.trim() ?? '',
    };
  }
}

async function resolveExecutable(
  shell: string,
  executable: string
): Promise<string | null> {
  const testExecutable =
    process.env.EXAWATT_TEST === '1' &&
    process.env.EXAWATT_TEST_HARNESS_BIN &&
    path.isAbsolute(process.env.EXAWATT_TEST_HARNESS_BIN)
      ? path.join(process.env.EXAWATT_TEST_HARNESS_BIN, executable)
      : null;
  if (testExecutable) {
    try {
      await fs.promises.access(testExecutable, fs.constants.X_OK);
      return testExecutable;
    } catch {
      return null;
    }
  }
  const result = await loginShellCommand(
    shell,
    `command -v ${shellQuote(executable)}`,
    2_000
  );
  if (!result.ok) return null;
  const resolved = result.stdout.split('\n')[0]?.trim();
  return resolved && path.isAbsolute(resolved) ? resolved : null;
}

function sourceCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args].map(shellQuote).join(' ');
}

function stateLabel(state: AgentSourceState): string {
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'connecting':
      return 'Connecting';
    case 'action-required':
      return 'Action required';
    case 'degraded':
      return 'Degraded';
    case 'unavailable':
      return 'Unavailable';
    case 'not-installed':
      return 'Not installed';
    case 'incompatible':
      return 'Incompatible';
    default:
      return 'Unknown';
  }
}

function localCapabilities(harness: AgentHarness): AgentSourceCapabilities {
  const descriptor = harnessDescriptor(harness);
  return {
    interactiveLaunch: true,
    initialTask: true,
    exactResume: true,
    modelSelection:
      descriptor.source.modelDiscovery === 'live-catalog'
        ? 'live-catalog'
        : 'source-owned',
    effortSelection:
      descriptor.source.modelDiscovery === 'live-catalog'
        ? 'live-catalog'
        : 'configured-value',
    permissionModes: ['prompt', 'auto', 'unrestricted'],
    delegationObservation: descriptor.delegation.observable
      ? 'Source-reported lifecycle events'
      : descriptor.delegation.reason,
    enforcementOwner: descriptor.source.label,
  };
}

export function parseClaudeAuthStatus(raw: string): {
  authenticated: boolean;
  identity: string;
  detail: string;
} | null {
  try {
    const parsed = JSON.parse(raw) as {
      loggedIn?: unknown;
      email?: unknown;
      subscriptionType?: unknown;
      authMethod?: unknown;
    };
    if (parsed.loggedIn !== true) {
      return {
        authenticated: false,
        identity: 'Not signed in',
        detail: 'Claude Code reports no active account.',
      };
    }
    const identity =
      typeof parsed.email === 'string' && parsed.email.trim()
        ? parsed.email.trim()
        : 'Claude account';
    const subscription =
      typeof parsed.subscriptionType === 'string' &&
      parsed.subscriptionType.trim()
        ? parsed.subscriptionType.trim()
        : null;
    return {
      authenticated: true,
      identity,
      detail: subscription
        ? `Signed in through Claude Code · ${subscription} plan`
        : 'Signed in through Claude Code.',
    };
  } catch {
    return null;
  }
}

export function parseCodexAuthStatus(
  raw: string,
  commandSucceeded: boolean
): { authenticated: boolean; identity: string } | null {
  if (
    /not logged in|not authenticated|login required|sign[- ]?in required/i.test(
      raw
    )
  ) {
    return { authenticated: false, identity: 'Not signed in' };
  }
  if (/logged in(?:\s+using)?/i.test(raw)) {
    return {
      authenticated: true,
      identity:
        raw.replace(/^.*?logged in(?:\s+using)?\s*/i, '').trim() ||
        'Codex account',
    };
  }
  // A successful status command with no recognized account detail still
  // proves that Codex considers its local auth state usable.
  return commandSucceeded
    ? { authenticated: true, identity: 'Codex account' }
    : null;
}

export function localSourceState(input: {
  executable: boolean;
  versionResponded: boolean;
  authKnown: boolean;
  authenticated: boolean;
}): AgentSourceState {
  if (!input.executable) return 'not-installed';
  if (!input.versionResponded) return 'degraded';
  if (!input.authKnown) return 'unknown';
  return input.authenticated ? 'ready' : 'action-required';
}

export function openClawSourceState(input: {
  executable: boolean;
  configured: boolean;
  credentialPresent: boolean;
  reachable: boolean;
}): AgentSourceState {
  if (!input.executable) return 'not-installed';
  if (!input.configured || !input.credentialPresent) return 'action-required';
  return input.reachable ? 'ready' : 'degraded';
}

export function openClawCredentialPresent(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0;
  // Recent OpenClaw configs can store a credential reference object rather
  // than the secret itself. Presence is all this registry needs or retains.
  return value !== null && typeof value === 'object';
}

async function inspectLocalHarness(
  harness: AgentHarness,
  shell: string
): Promise<AgentSourceSnapshot> {
  const observedAt = Date.now();
  const descriptor = harnessDescriptor(harness);
  const source = descriptor.source;
  const executablePath = await resolveExecutable(shell, source.executable);
  const commandEvidence = provenance(
    'source-command',
    `${source.label} CLI`,
    observedAt
  );
  const unknownConfigEvidence = provenance(
    'source-config',
    `${source.label} configuration`,
    observedAt
  );

  if (!executablePath) {
    const state: AgentSourceState = 'not-installed';
    return {
      id: `${harness}-local`,
      adapterId: harness,
      harness,
      label: source.label,
      connectionName: source.connectionName,
      color: source.color,
      configured: true,
      launchable: false,
      state,
      stateLabel: stateLabel(state),
      summary: `${source.label} is supported here, but its CLI is not installed.`,
      observedAt,
      facts: {
        installation: fact(
          'not-installed',
          'Not installed',
          `${source.executable} was not found in the login-shell PATH.`,
          commandEvidence
        ),
        reachability: fact(
          'unavailable',
          'Unavailable',
          'Local reachability requires the installed CLI.',
          commandEvidence
        ),
        authentication: fact(
          'unknown',
          'Unknown',
          `Authentication remains owned by ${source.authOwner}.`,
          commandEvidence
        ),
        identity: fact(
          'unknown',
          'Unknown',
          'No source identity was queried.',
          commandEvidence
        ),
        compatibility: fact(
          'unknown',
          'Unknown',
          'No installed version is available to evaluate.',
          commandEvidence
        ),
        modelDiscovery: fact(
          'unavailable',
          'Unavailable',
          'Model discovery requires the installed source.',
          unknownConfigEvidence
        ),
      },
      capabilities: localCapabilities(harness),
      actions: { recheck: true, authenticate: false, chooseModel: false },
    };
  }

  const [versionResult, authResult] = await Promise.all([
    loginShellCommand(
      shell,
      sourceCommand(executablePath, source.versionArgs),
      3_000
    ),
    loginShellCommand(
      shell,
      sourceCommand(executablePath, source.authStatusArgs),
      4_000
    ),
  ]);
  const version = versionResult.stdout || 'Installed';
  const claudeIdentity =
    harness === 'claude' ? parseClaudeAuthStatus(authResult.stdout) : null;
  const codexIdentity =
    harness === 'codex'
      ? parseCodexAuthStatus(
          `${authResult.stdout}\n${authResult.stderr}`.trim(),
          authResult.ok
        )
      : null;
  const authenticated =
    harness === 'claude'
      ? claudeIdentity?.authenticated === true
      : codexIdentity?.authenticated === true;
  const authKnown =
    harness === 'claude' ? claudeIdentity !== null : codexIdentity !== null;
  const identity =
    harness === 'claude'
      ? (claudeIdentity?.identity ?? 'Unknown')
      : authenticated
        ? (codexIdentity?.identity ?? 'Codex account')
        : 'Not signed in';
  const state = localSourceState({
    executable: true,
    versionResponded: versionResult.ok,
    authKnown,
    authenticated,
  });
  const modelDiscovery = source.modelDiscovery;

  return {
    id: `${harness}-local`,
    adapterId: harness,
    harness,
    label: source.label,
    connectionName: source.connectionName,
    color: source.color,
    configured: true,
    launchable: executablePath !== null && authenticated,
    state,
    stateLabel: stateLabel(state),
    summary:
      state === 'ready'
        ? `Exawatt can start and resume local ${source.label} Agents. Sign-in and execution remain with ${source.label}.`
        : state === 'action-required'
          ? `${source.label} is installed, but its source-owned sign-in needs attention.`
          : `${source.label} is installed, but Exawatt could not verify every launch prerequisite.`,
    observedAt,
    facts: {
      installation: fact(
        'ready',
        version,
        `Detected at ${executablePath}.`,
        commandEvidence
      ),
      reachability: fact(
        versionResult.ok ? 'ready' : 'degraded',
        versionResult.ok ? 'Local CLI responds' : 'Version check failed',
        versionResult.ok
          ? 'Observed through the source version command.'
          : 'The executable exists, but its version command did not complete.',
        commandEvidence
      ),
      authentication: fact(
        authKnown ? (authenticated ? 'ready' : 'action-required') : 'unknown',
        authenticated
          ? `Managed by ${source.authOwner}`
          : authKnown
            ? 'Sign-in required'
            : 'Unknown',
        authenticated
          ? harness === 'claude'
            ? (claudeIdentity?.detail ?? 'Signed in through Claude Code.')
            : 'Codex reports an active source-owned login.'
          : `Exawatt does not receive or store the ${source.authOwner} credential.`,
        commandEvidence
      ),
      identity: fact(
        authKnown ? (authenticated ? 'ready' : 'action-required') : 'unknown',
        identity,
        authenticated
          ? `Minimum identity exposed by ${source.label}.`
          : 'No authenticated source identity is available.',
        commandEvidence
      ),
      compatibility: fact(
        versionResult.ok ? 'unknown' : 'degraded',
        versionResult.ok ? 'No minimum pinned' : 'Unknown',
        versionResult.ok
          ? 'Exawatt has not declared a minimum compatible version for this source.'
          : 'Compatibility cannot be evaluated without a version response.',
        commandEvidence
      ),
      modelDiscovery: fact(
        authenticated ? 'ready' : authKnown ? 'action-required' : 'unknown',
        modelDiscovery === 'live-catalog'
          ? 'Live source catalog'
          : 'Configured value only',
        modelDiscovery === 'live-catalog'
          ? 'The installed CLI exposes a supported machine-readable catalog.'
          : `The CLI does not expose its account-aware catalog. Exawatt reads exact configuration and leaves catalog selection with ${source.label}.`,
        modelDiscovery === 'live-catalog'
          ? commandEvidence
          : unknownConfigEvidence
      ),
    },
    capabilities: localCapabilities(harness),
    actions: {
      recheck: true,
      authenticate: !authenticated,
      chooseModel: harness === 'claude' && authenticated,
    },
  };
}

interface OpenClawObservation {
  lastTouchedVersion: string | null;
  host: string;
  port: number;
  credentialPresent: boolean;
}

async function readOpenClawConfig(): Promise<OpenClawObservation | null> {
  try {
    const raw = await fs.promises.readFile(
      path.join(os.homedir(), '.openclaw', 'openclaw.json'),
      'utf8'
    );
    const parsed = JSON.parse(raw) as {
      meta?: { lastTouchedVersion?: unknown };
      gateway?: {
        host?: unknown;
        port?: unknown;
        auth?: { token?: unknown };
      };
    };
    const rawHost = parsed.gateway?.host;
    const host =
      typeof rawHost === 'string' && rawHost && rawHost !== 'loopback'
        ? rawHost
        : '127.0.0.1';
    const rawPort = parsed.gateway?.port;
    const port =
      typeof rawPort === 'number' && Number.isInteger(rawPort) && rawPort > 0
        ? rawPort
        : 18789;
    return {
      lastTouchedVersion:
        typeof parsed.meta?.lastTouchedVersion === 'string'
          ? parsed.meta.lastTouchedVersion
          : null,
      host,
      port,
      credentialPresent: openClawCredentialPresent(parsed.gateway?.auth?.token),
    };
  } catch {
    return null;
  }
}

function gatewayReachable(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const finish = (reachable: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function inspectOpenClaw(shell: string): Promise<AgentSourceSnapshot> {
  const observedAt = Date.now();
  const commandEvidence = provenance(
    'source-command',
    'OpenClaw CLI',
    observedAt
  );
  const configEvidence = provenance(
    'source-config',
    '~/.openclaw/openclaw.json',
    observedAt
  );
  const executable = await resolveExecutable(shell, 'openclaw');
  const [versionResult, config] = await Promise.all([
    executable
      ? loginShellCommand(shell, sourceCommand(executable, ['--version']))
      : Promise.resolve({ ok: false, stdout: '', stderr: '' }),
    readOpenClawConfig(),
  ]);
  const host = config?.host ?? '127.0.0.1';
  const port = config?.port ?? 18789;
  const hasConnectionCredential = config?.credentialPresent ?? false;
  const reachable = config ? await gatewayReachable(host, port) : false;
  const state = openClawSourceState({
    executable: Boolean(executable),
    configured: Boolean(config),
    credentialPresent: hasConnectionCredential,
    reachable,
  });
  const gatewayEvidence = provenance(
    'gateway-probe',
    `${host}:${port}`,
    observedAt
  );
  const version =
    versionResult.stdout || config?.lastTouchedVersion || 'Unknown';

  return {
    id: 'openclaw-local',
    adapterId: 'openclaw',
    harness: null,
    label: 'OpenClaw',
    connectionName: 'Local gateway',
    color: '#8BB9ED',
    configured: Boolean(config),
    launchable: false,
    state,
    stateLabel: stateLabel(state),
    summary:
      state === 'ready'
        ? 'The local gateway is reachable. Fleet control remains behind the OpenClaw adapter, separate from the Terminal composer.'
        : state === 'degraded'
          ? 'OpenClaw is configured, but its local gateway is not currently reachable.'
          : state === 'not-installed'
            ? 'OpenClaw is supported, but its local CLI is not installed.'
            : 'OpenClaw needs a local gateway configuration before Exawatt can connect.',
    observedAt,
    facts: {
      installation: fact(
        executable ? 'ready' : 'not-installed',
        executable ? version : 'Not installed',
        executable
          ? `Detected at ${executable}.`
          : 'openclaw was not found in the login-shell PATH.',
        commandEvidence
      ),
      reachability: fact(
        !config ? 'unknown' : reachable ? 'ready' : 'degraded',
        !config
          ? 'Not configured'
          : reachable
            ? 'Gateway responds'
            : 'Unreachable',
        config
          ? `Probed ${host}:${port}; no connection secret crossed into the renderer.`
          : 'No gateway endpoint is configured.',
        gatewayEvidence
      ),
      authentication: fact(
        !config
          ? 'unknown'
          : hasConnectionCredential
            ? 'ready'
            : 'action-required',
        hasConnectionCredential
          ? 'Connection credential present'
          : 'Configure gateway',
        'The gateway credential remains in the OpenClaw configuration and is never returned to the renderer.',
        configEvidence
      ),
      identity: fact(
        config ? 'ready' : 'unknown',
        config ? `${host}:${port}` : 'Unknown',
        'Local gateway endpoint; this is not an Agent identity.',
        configEvidence
      ),
      compatibility: fact(
        versionResult.ok ? 'unknown' : 'unknown',
        versionResult.ok ? 'No minimum pinned' : 'Unknown',
        'Exawatt has not declared a minimum compatible OpenClaw version.',
        commandEvidence
      ),
      modelDiscovery: fact(
        reachable ? 'ready' : config ? 'degraded' : 'unknown',
        reachable ? 'Gateway-advertised' : 'Unavailable',
        'Model truth belongs to the connected gateway capability snapshot.',
        gatewayEvidence
      ),
    },
    capabilities: {
      interactiveLaunch: false,
      initialTask: true,
      exactResume: true,
      modelSelection: 'gateway',
      effortSelection: 'gateway',
      permissionModes: [],
      delegationObservation: 'Gateway protocol events',
      enforcementOwner: 'OpenClaw gateway',
    },
    actions: { recheck: true, authenticate: false, chooseModel: false },
  };
}

function demoSource(): AgentSourceSnapshot {
  const observedAt = Date.now();
  const evidence = provenance(
    'built-in',
    'Exawatt Demo Scenario Source',
    observedAt
  );
  return {
    id: 'demo-built-in',
    adapterId: 'demo',
    harness: null,
    label: 'Demo Mode',
    connectionName: 'Scenario source',
    color: '#E7BD6A',
    configured: true,
    launchable: false,
    state: 'ready',
    stateLabel: 'Ready',
    summary:
      'Demo Mode exercises the same source-facing fleet concepts without a live harness. Every fact is explicitly simulated.',
    observedAt,
    facts: {
      installation: fact(
        'simulated',
        'Built in',
        'Ships with Exawatt.',
        evidence
      ),
      reachability: fact(
        'simulated',
        'Available',
        'No network connection is used.',
        evidence
      ),
      authentication: fact(
        'simulated',
        'No credential',
        'Scenario data does not authenticate.',
        evidence
      ),
      identity: fact(
        'simulated',
        'Built-in scenario',
        'Simulated source identity.',
        evidence
      ),
      compatibility: fact(
        'simulated',
        'App version',
        'Versioned with Exawatt.',
        evidence
      ),
      modelDiscovery: fact(
        'simulated',
        'Scenario-defined',
        'Fixture catalog with simulated provenance.',
        evidence
      ),
    },
    capabilities: {
      interactiveLaunch: false,
      initialTask: true,
      exactResume: true,
      modelSelection: 'scenario',
      effortSelection: 'scenario',
      permissionModes: [],
      delegationObservation: 'Simulated lifecycle events',
      enforcementOwner: 'No real enforcement (simulation)',
    },
    actions: { recheck: false, authenticate: false, chooseModel: false },
  };
}

async function discoverAgentSources(
  shell: string,
  scope: 'all' | 'launch' = 'all'
): Promise<AgentSourceRegistrySnapshot> {
  const observedAt = Date.now();
  const local = await Promise.all([
    inspectLocalHarness('claude', shell),
    inspectLocalHarness('codex', shell),
  ]);
  const sources =
    scope === 'launch'
      ? local
      : [...local, await inspectOpenClaw(shell), demoSource()];
  return {
    sources,
    available: sources.map(source => ({
      adapterId: source.adapterId,
      label: source.label,
      description:
        source.adapterId === 'demo'
          ? 'Built-in source with clearly simulated provenance.'
          : source.adapterId === 'openclaw'
            ? 'Connect a local OpenClaw gateway.'
            : `Use the locally installed ${source.label} CLI.`,
      availability:
        source.state === 'not-installed'
          ? 'not-installed'
          : source.configured
            ? 'configured'
            : 'configure',
    })),
    comingLater:
      scope === 'all'
        ? [
            {
              adapterId: 'hosted-openclaw',
              label: 'Hosted OpenClaw',
              description: 'Connect a remote or managed gateway.',
              availability: 'coming-later',
            },
            {
              adapterId: 'custom',
              label: 'Custom harness',
              description: 'Bring another compatible Agent Source adapter.',
              availability: 'coming-later',
            },
          ]
        : [],
    observedAt,
  };
}

const REGISTRY_CACHE_MS = 5_000;
const registryCache = new Map<
  'all' | 'launch',
  { snapshot: AgentSourceRegistrySnapshot; cachedAt: number }
>();
const registryInFlight = new Map<
  'all' | 'launch',
  Promise<AgentSourceRegistrySnapshot>
>();

function cacheRegistry(
  scope: 'all' | 'launch',
  snapshot: AgentSourceRegistrySnapshot,
  cachedAt: number
): void {
  const current = registryCache.get(scope);
  if (current && current.snapshot.observedAt > snapshot.observedAt) {
    return;
  }
  registryCache.set(scope, { snapshot, cachedAt });
}

function launchRegistryView(
  snapshot: AgentSourceRegistrySnapshot
): AgentSourceRegistrySnapshot {
  const sources = snapshot.sources.filter(source => source.harness !== null);
  return {
    sources,
    available: snapshot.available.filter(entry =>
      sources.some(source => source.adapterId === entry.adapterId)
    ),
    comingLater: [],
    observedAt: snapshot.observedAt,
  };
}

/** Short-lived, coalesced observations keep a ribbon full of draft composers
 * from repeatedly spawning status CLIs. Explicit Settings rechecks bypass the
 * cache, preserving operator control and accurate freshness. */
export async function inspectAgentSources(
  shell: string,
  scope: 'all' | 'launch' = 'all',
  refresh = false
): Promise<AgentSourceRegistrySnapshot> {
  const cached = registryCache.get(scope);
  if (!refresh && cached && Date.now() - cached.cachedAt < REGISTRY_CACHE_MS) {
    return cached.snapshot;
  }
  const existing = registryInFlight.get(scope);
  if (!refresh && existing) return existing;
  const discovery = discoverAgentSources(shell, scope).then(snapshot => {
    const cachedAt = Date.now();
    cacheRegistry(scope, snapshot, cachedAt);
    if (scope === 'all') {
      cacheRegistry('launch', launchRegistryView(snapshot), cachedAt);
    }
    return snapshot;
  });
  registryInFlight.set(scope, discovery);
  try {
    return await discovery;
  } finally {
    if (registryInFlight.get(scope) === discovery) {
      registryInFlight.delete(scope);
    }
  }
}

export function sourceOwnedActionCommand(
  harness: AgentHarness,
  action: 'authenticate' | 'choose-model'
): string {
  const source = harnessDescriptor(harness).source;
  if (action === 'authenticate') {
    return sourceCommand(source.executable, source.authLoginArgs);
  }
  return sourceCommand(source.executable, []);
}

export async function launchSourceOwnedAction(
  harness: AgentHarness,
  action: 'authenticate' | 'choose-model'
): Promise<AgentSourceActionResult> {
  const descriptor = harnessDescriptor(harness).source;
  const command = sourceOwnedActionCommand(harness, action);
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      message:
        action === 'authenticate'
          ? `Open a terminal and run: ${command}`
          : `Open ${descriptor.label} and use its model selector.`,
    };
  }
  const intro =
    action === 'choose-model'
      ? `printf '\\nChoose a model with /model inside ${descriptor.label}.\\n\\n'; `
      : '';
  const script = [
    'tell application "Terminal"',
    'activate',
    `do script ${JSON.stringify(`${intro}${command}`)}`,
    'end tell',
  ].join('\n');
  try {
    await execFileAsync('/usr/bin/osascript', ['-e', script], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
    });
    return {
      ok: true,
      message:
        action === 'authenticate'
          ? `${descriptor.label} sign-in opened in Terminal.`
          : `${descriptor.label} opened in Terminal. Use /model there, then recheck Exawatt.`,
    };
  } catch {
    return {
      ok: false,
      message: `Could not open ${descriptor.label}. Run ${command} in Terminal.`,
    };
  }
}
