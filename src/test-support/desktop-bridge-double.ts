import type {
  DesktopBridge,
  PtySessionInfo,
  PtySessionRecord,
} from '@exawatt/core/desktop-bridge';

/**
 * The one test double for `window.electron`, built from the desktop bridge
 * contract that preload's real object `satisfies`.
 *
 * A double may be less capable than the bridge (a test states only the
 * members it exercises) but never more: every member it names must exist on
 * `DesktopBridge` with a compatible signature, checked at compile time even
 * when the spec is built in a variable, and the contract itself refuses a
 * request or push that could carry a function. A double therefore cannot
 * honour a callback, a method, or a namespace the real bridge cannot carry.
 *
 * `installBridgeDouble` and `removeBridgeDouble` are the only code allowed to
 * write `window.electron` (see `eslint.config.mjs`).
 */

type Namespace = {
  [K in keyof DesktopBridge]: NonNullable<DesktopBridge[K]> extends object
    ? K
    : never;
}[keyof DesktopBridge];

/** The namespaces a double may carry, in the order the contract lists them. */
const NAMESPACES = [
  'agentSources',
  'connectedSources',
  'operatorStats',
  'commandEngine',
  'consumption',
  'pty',
  'workspace',
  'roadmap',
  'settings',
  'app',
  'auth',
  'dialog',
  'projects',
  'menu',
  'feedback',
  'shortcuts',
  'analytics',
] as const satisfies readonly Namespace[];

/** Compile-time proof that the list above is every namespace, no more. */
type Unlisted = Exclude<Namespace, (typeof NAMESPACES)[number]>;
const everyNamespaceListed: [Unlisted] extends [never] ? true : Unlisted = true;
void everyNamespaceListed;

/** What a test states: any subset of any namespace, and the platform. */
type BridgeDoubleSpec = {
  [K in Namespace]?: Partial<DesktopBridge[K]>;
} & { platform?: string };

/** Refuses, member by member, anything the contract does not declare. */
type OnlyContractMembers<Spec> = {
  [K in keyof Spec]: K extends Namespace
    ? {
        [M in keyof Spec[K]]: M extends keyof DesktopBridge[K]
          ? Spec[K][M]
          : never;
      }
    : K extends 'platform'
      ? Spec[K]
      : never;
};

/**
 * Builds a double from a spec. Absent namespaces are absent, exactly as they
 * would be for a test that never looks at them; a real preload has them all.
 */
export function createBridgeDouble<Spec extends BridgeDoubleSpec>(
  spec: Spec & OnlyContractMembers<Spec> = {} as Spec &
    OnlyContractMembers<Spec>
): DesktopBridge {
  const known = new Set<string>([...NAMESPACES, 'platform']);
  const unknown = Object.keys(spec).filter(key => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Not part of the desktop bridge contract: ${unknown.join(', ')}`
    );
  }
  const { platform = 'darwin', ...namespaces } = spec as BridgeDoubleSpec;
  // The one place a partial bridge is presented as the whole: a double is
  // allowed to be less capable than preload, and only here.
  return {
    isElectron: true,
    platform,
    ...namespaces,
  } as unknown as DesktopBridge;
}

/** Installs a double as `window.electron` and returns it. */
export function installBridgeDouble<Spec extends BridgeDoubleSpec>(
  spec: Spec & OnlyContractMembers<Spec> = {} as Spec &
    OnlyContractMembers<Spec>
): DesktopBridge {
  const bridge = createBridgeDouble<Spec>(spec);
  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: bridge,
  });
  return bridge;
}

/** Removes `window.electron`: the renderer as a web browser sees it. */
export function removeBridgeDouble(): void {
  Reflect.deleteProperty(window, 'electron');
}

/**
 * What main answers a create or a model change with: the process record,
 * every field present. Defaults describe a fresh Claude Code Session.
 */
export function ptySessionRecord(
  overrides: Partial<PtySessionRecord> = {}
): PtySessionRecord {
  return {
    id: 'pty-1',
    durableSessionId: 'session-1',
    harness: 'claude',
    title: 'Claude Code',
    cwd: '/workspace/project',
    projectDir: '/workspace/project',
    projectName: 'project',
    cols: 80,
    rows: 24,
    startedAt: 0,
    exited: false,
    exitCode: null,
    exitSignal: null,
    lastDataAt: 0,
    harnessSessionId: null,
    ...overrides,
  };
}

/**
 * One `pty:list` row as main builds it: the record plus main's live
 * observations, every field present. The defaults observe a quiet, unstarted
 * Session; a test overrides what it is about.
 */
export function ptySessionInfo(
  overrides: Partial<PtySessionInfo> = {}
): PtySessionInfo {
  return {
    ...ptySessionRecord(),
    contextSummary: null,
    goalVisual: null,
    attention: null,
    engaged: false,
    working: false,
    delegation: null,
    ...overrides,
  };
}
