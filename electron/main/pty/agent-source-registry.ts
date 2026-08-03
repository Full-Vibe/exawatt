import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  AgentHarness,
  AgentSourceActionResult,
  AgentSourceCapabilities,
  AgentSourceFact,
  AgentSourceFactState,
  AgentSourceProvenance,
  AgentSourceRegistrySnapshot,
  AgentSourceSnapshot,
  AgentSourceState,
} from '@exawatt/core';
import { harnessDescriptor } from './harness-registry';
import {
  agentSourceDeclaration,
  FUTURE_AGENT_SOURCE_CATALOG,
} from './generated-agent-source-declarations';

const execFileAsync = promisify(execFile);

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
  const basis =
    source.kind === 'adapter-declaration'
      ? 'declared'
      : source.kind === 'simulation'
        ? 'simulated'
        : 'observed';
  return { basis, state, value, detail, provenance: source };
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
  protocolReady: boolean;
}): AgentSourceState {
  if (!input.executable) return 'not-installed';
  if (!input.configured) return 'action-required';
  return input.protocolReady ? 'ready' : 'degraded';
}

async function inspectLocalHarness(
  harness: AgentHarness,
  shell: string
): Promise<AgentSourceSnapshot> {
  const observedAt = Date.now();
  const descriptor = harnessDescriptor(harness);
  const source = descriptor.source;
  const declaration = agentSourceDeclaration(harness);
  const executablePath = await resolveExecutable(shell, source.executable);
  const commandEvidence = provenance(
    'source-command',
    `${source.label} CLI`,
    observedAt
  );
  const unknownConfigEvidence = provenance(
    'adapter-declaration',
    'Built-in adapter declaration',
    0
  );

  if (!executablePath) {
    const state: AgentSourceState = 'not-installed';
    return {
      ...declaration,
      id: `${harness}-local`,
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
      actions: {
        recheck: true,
        authenticate: false,
        chooseModel: false,
        installGuide: true,
      },
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
  return {
    ...declaration,
    id: `${harness}-local`,
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
        versionResult.ok ? unknownConfigEvidence : commandEvidence
      ),
      modelDiscovery: fact(
        authenticated ? 'unknown' : authKnown ? 'action-required' : 'unknown',
        authenticated ? 'Project-scoped' : 'Not checked',
        authenticated
          ? 'Catalog truth is observed for the active Project in the Agent composer, not inferred from global authentication.'
          : 'Catalog discovery requires a source-owned sign-in and an active Project context.',
        unknownConfigEvidence
      ),
    },
    actions: {
      recheck: true,
      authenticate: !authenticated,
      chooseModel: harness === 'claude' && authenticated,
      installGuide: true,
    },
  };
}

interface OpenClawObservation {
  lastTouchedVersion: string | null;
  host: string;
  port: number;
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
    };
  } catch {
    return null;
  }
}

export interface OpenClawGatewayObservation {
  protocolReady: boolean;
  degraded: boolean;
  configValid: boolean | null;
  capability: string | null;
  identity: string | null;
  version: string | null;
}

/**
 * OpenClaw has shipped two JSON envelopes for `gateway status`. Parse only
 * bounded, non-secret fields from both. Command success is required: a JSON
 * error payload or an open TCP port is not an authenticated protocol result.
 */
export function parseOpenClawGatewayStatus(
  raw: string,
  commandSucceeded: boolean
): OpenClawGatewayObservation {
  try {
    const parsed = JSON.parse(raw) as {
      ok?: unknown;
      degraded?: unknown;
      capability?: unknown;
      cli?: { version?: unknown };
      config?: { cli?: { valid?: unknown } };
      gateway?: { version?: unknown };
      rpc?: {
        ok?: unknown;
        capability?: unknown;
        server?: { version?: unknown };
      };
      targets?: Array<{
        connect?: { ok?: unknown; rpcOk?: unknown };
        self?: { host?: unknown; version?: unknown } | null;
      }>;
    };
    const targets = Array.isArray(parsed.targets) ? parsed.targets : [];
    const connectedTarget = targets.find(
      target => target.connect?.rpcOk === true
    );
    const protocolReady =
      commandSucceeded &&
      (parsed.ok === true ||
        parsed.rpc?.ok === true ||
        connectedTarget !== undefined);
    const self = connectedTarget?.self;
    const identity =
      typeof self?.host === 'string' && self.host.trim()
        ? self.host.trim()
        : null;
    const targetVersion =
      typeof self?.version === 'string' && self.version.trim()
        ? self.version.trim()
        : null;
    const cliVersion =
      typeof parsed.cli?.version === 'string' && parsed.cli.version.trim()
        ? parsed.cli.version.trim()
        : null;
    const legacyServerVersion =
      typeof parsed.rpc?.server?.version === 'string' &&
      parsed.rpc.server.version.trim()
        ? parsed.rpc.server.version.trim()
        : null;
    const gatewayVersion =
      typeof parsed.gateway?.version === 'string' &&
      parsed.gateway.version.trim()
        ? parsed.gateway.version.trim()
        : null;
    const rawCapability = parsed.capability ?? parsed.rpc?.capability;
    return {
      protocolReady,
      degraded: parsed.degraded === true,
      configValid:
        typeof parsed.config?.cli?.valid === 'boolean'
          ? parsed.config.cli.valid
          : null,
      capability:
        typeof rawCapability === 'string' && rawCapability.trim()
          ? rawCapability.trim()
          : null,
      identity,
      version:
        targetVersion ?? legacyServerVersion ?? gatewayVersion ?? cliVersion,
    };
  } catch {
    return {
      protocolReady: false,
      degraded: false,
      configValid: null,
      capability: null,
      identity: null,
      version: null,
    };
  }
}

async function inspectOpenClaw(shell: string): Promise<AgentSourceSnapshot> {
  const observedAt = Date.now();
  const declaration = agentSourceDeclaration('openclaw');
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
  const declarationEvidence = provenance(
    'adapter-declaration',
    'Built-in adapter declaration',
    0
  );
  const executable = await resolveExecutable(shell, 'openclaw');
  const [versionResult, statusResult, config] = await Promise.all([
    executable
      ? loginShellCommand(shell, sourceCommand(executable, ['--version']))
      : Promise.resolve({ ok: false, stdout: '', stderr: '' }),
    executable
      ? loginShellCommand(
          shell,
          sourceCommand(executable, [
            'gateway',
            'status',
            '--json',
            '--timeout',
            '1500',
          ]),
          4_500
        )
      : Promise.resolve({ ok: false, stdout: '', stderr: '' }),
    readOpenClawConfig(),
  ]);
  const gateway = parseOpenClawGatewayStatus(
    statusResult.stdout,
    statusResult.ok
  );
  const host = config?.host ?? '127.0.0.1';
  const port = config?.port ?? 18789;
  const configured = Boolean(config) || gateway.configValid === true;
  const state = openClawSourceState({
    executable: Boolean(executable),
    configured,
    protocolReady: gateway.protocolReady,
  });
  const protocolEvidence = provenance(
    'source-protocol',
    'OpenClaw gateway status',
    observedAt
  );
  const version =
    versionResult.stdout ||
    gateway.version ||
    config?.lastTouchedVersion ||
    'Unknown';

  return {
    ...declaration,
    id: 'openclaw-local',
    configured,
    launchable: false,
    state,
    stateLabel: stateLabel(state),
    summary:
      state === 'ready'
        ? 'OpenClaw accepted an authenticated protocol probe. Fleet control remains behind its adapter, separate from the Terminal composer.'
        : state === 'degraded'
          ? 'OpenClaw is configured, but its gateway protocol could not be verified.'
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
        !configured
          ? 'unknown'
          : gateway.protocolReady
            ? gateway.degraded
              ? 'degraded'
              : 'ready'
            : 'degraded',
        !configured
          ? 'Not configured'
          : gateway.protocolReady
            ? 'Protocol handshake accepted'
            : 'Protocol probe failed',
        configured
          ? `OpenClaw performed its WebSocket/RPC status probe for ${host}:${port}; no connection secret crossed into the renderer.`
          : 'No gateway endpoint is configured.',
        protocolEvidence
      ),
      authentication: fact(
        !configured ? 'unknown' : gateway.protocolReady ? 'ready' : 'unknown',
        gateway.protocolReady ? 'Connection accepted' : 'Not verified',
        gateway.protocolReady
          ? 'The source-owned gateway status command completed its authenticated protocol probe.'
          : 'Configuration presence does not prove that the gateway accepted its credential.',
        gateway.protocolReady ? protocolEvidence : configEvidence
      ),
      identity: fact(
        gateway.identity ? 'ready' : 'unknown',
        gateway.identity ?? 'Not exposed',
        gateway.identity
          ? 'Minimum gateway identity returned by the authenticated protocol probe.'
          : 'The endpoint is connection configuration, not source identity.',
        gateway.identity ? protocolEvidence : configEvidence
      ),
      compatibility: fact(
        'unknown',
        versionResult.ok ? 'No minimum pinned' : 'Unknown',
        'Exawatt has not declared a minimum compatible OpenClaw version.',
        versionResult.ok ? declarationEvidence : commandEvidence
      ),
      modelDiscovery: fact(
        'unknown',
        gateway.protocolReady ? 'Not queried here' : 'Unavailable',
        gateway.protocolReady
          ? 'Model truth belongs to a gateway capability snapshot; the global registry does not infer it from connectivity.'
          : 'A verified gateway capability snapshot is not available.',
        declarationEvidence
      ),
    },
    actions: {
      recheck: true,
      authenticate: false,
      chooseModel: false,
      installGuide: true,
    },
  };
}

function demoSource(): AgentSourceSnapshot {
  const observedAt = Date.now();
  const declaration = agentSourceDeclaration('demo');
  const evidence = provenance(
    'simulation',
    'Exawatt Demo Scenario Source',
    observedAt
  );
  return {
    ...declaration,
    id: 'demo-built-in',
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
    actions: {
      recheck: false,
      authenticate: false,
      chooseModel: false,
      installGuide: false,
    },
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
      description: source.description,
      availability:
        source.state === 'not-installed'
          ? 'not-installed'
          : source.configured
            ? 'configured'
            : 'configure',
    })),
    comingSoon: scope === 'all' ? [...FUTURE_AGENT_SOURCE_CATALOG] : [],
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
    comingSoon: [],
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

export function agentSourceLaunchError(
  snapshot: AgentSourceRegistrySnapshot,
  harness: AgentHarness
): string | null {
  const source = snapshot.sources.find(
    candidate => candidate.harness === harness
  );
  const label = source?.label ?? agentSourceDeclaration(harness).label;
  if (!source) {
    return `${label} status is unavailable. Recheck Settings → Agent Sources before launching.`;
  }
  if (source.launchable) return null;
  if (source.state === 'not-installed') {
    return `${label} is not installed. Open Settings → Agent Sources for the installation guide.`;
  }
  if (source.state === 'action-required') {
    return `${label} requires sign-in. Open Settings → Agent Sources to authenticate and recheck.`;
  }
  return `${label} launch readiness could not be verified (${source.stateLabel.toLowerCase()}). Recheck Settings → Agent Sources.`;
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
