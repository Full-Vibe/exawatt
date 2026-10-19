import type {
  DistributionContractV2,
  DistributionIdentity,
} from '../distribution/contract';
import type { OperatorStatsPublicationCursor } from '../operator-stats/publication';
import type { AppearancePreferencesV1 } from './settings';

/**
 * The desktop app's own reads, reports, lifecycle handshakes and sign-in
 * hand-offs, as they cross the bridge.
 */

/**
 * BUG-016: the command engine's own state. `starting` while the local
 * services come up, `ready` once they are all registered, `paused` when
 * bootstrap threw. A surface needs it to tell "this machine has no desktop
 * bridge" from "the bridge is here and its engine is dead".
 */
export type CommandEnginePhase = 'starting' | 'ready' | 'paused';

/** What this process is: the build it came from, read once at the top of
 *  main before anything else can depend on a guess. */
export interface BuildInfo {
  sha: string;
  branch: string;
  builtAt: string;
  delivery: 'dogfood' | 'signed';
  distributionDigest: string;
  rendererCompositionDigest: string | null;
}

/** `app:get-build-info`: the build, its marketed version, and the
 *  distribution it was built for. */
export interface ExawattBuildInfo extends BuildInfo {
  /** `app.getVersion()`, the marketed version beside the exact sha
   *  (ENG-025: feedback rows stamp both). */
  version: string;
  distribution: {
    contract: DistributionContractV2;
    digest: string;
    identity: DistributionIdentity;
    capabilities: {
      updates: boolean;
      updateIpcChannels: readonly string[];
      protocolScheme: string | null;
    };
  };
}

export interface DiagnosticsLogTail {
  name: string;
  present: boolean;
  lines: unknown[];
  /** Set when the tail was shortened, so a reader never mistakes a
   *  truncated log for a complete one. */
  truncated?: boolean;
}

/** ENG-025 F5. The anonymized bundle a bug report can carry; the renderer
 *  renders it verbatim for review before anything is sent. */
export interface DiagnosticsReport {
  reportVersion: number;
  generatedAt: string;
  app: {
    version: string;
    sha: string;
    branch: string;
    delivery: string;
    packaged: boolean;
    installPath: string;
  };
  system: {
    platform: string;
    arch: string;
    osRelease: string;
    electron: string;
    node: string;
    locale: string;
  };
  update: Record<string, unknown> | null;
  session: { signedIn: boolean; liveSessions: number };
  logs: DiagnosticsLogTail[];
  /** Populated when the bundle had to be shortened to fit the byte ceiling. */
  notes?: string[];
}

export interface SavedDiagnosticsReport {
  ok: boolean;
  filePath: string | null;
}

/** A route's error boundary caught a render exception. */
export interface RenderErrorReport {
  message: string;
  stack?: string | null;
  digest?: string | null;
  pathname?: string | null;
  /** Where it was caught (BUG-129): a route error boundary (the default), the
   *  window's `error` event, or an `unhandledrejection` nothing awaited. */
  kind?: 'boundary' | 'error' | 'unhandled-rejection';
  /** `file:line:column` for a window error, when the browser names one. */
  source?: string | null;
}

type ProductUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type UpdaterDisabledReason =
  | 'unsigned-delivery'
  | 'not-packaged'
  | 'test-run'
  | 'no-feed-config';

export interface ProductUpdateStatus {
  phase: ProductUpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  liveSessions: number;
  error: string | null;
  /** False when this build has no update channel at all (unsigned local
   *  delivery, or a dev/test run). Only this field says so. */
  enabled: boolean;
  /** Why the channel is off, when it is. Null while updates are live. */
  disabledReason: UpdaterDisabledReason | null;
  /** Absolute path to the JSONL a user can send back after a failed update. */
  logPath: string | null;
}

/** The OS appearance as main reads it. */
export interface OsAppearanceSnapshot {
  dark: boolean;
  highContrast: boolean;
  invertedColors: boolean;
  /** The operator's OS highlight color, '#RRGGBB' (D32); null off macOS. */
  systemAccent: string | null;
  safeTheme: boolean;
}

/** Electron-authoritative first-paint state, captured by preload before any
 *  document script runs. */
export interface AppearanceBootstrapSnapshot<ThemeId extends string = string> {
  preferences: AppearancePreferencesV1<ThemeId>;
  dark: boolean;
  safeTheme: boolean;
}

/** `restart` is an operator-initiated relaunch that is not carrying an
 *  update: today the remedy for incident 0001, where macOS stops vending
 *  Exawatt's accessibility element and window managers can no longer move the
 *  window. It takes the same checkpoint-and-rehydrate path as quit and
 *  update. */
export type ShutdownIntent = 'quit' | 'update' | 'restart';

export interface CheckpointRequest {
  requestId: string;
  reason: ShutdownIntent;
  stage: 'pre-stop' | 'stopped';
}

export type ShutdownPhase =
  | 'idle'
  | 'confirming'
  /** An update restart hands the download to the installer before anything
   *  stops (BUG-286). */
  | 'preparing'
  | 'checkpointing'
  | 'stopping'
  | 'finalizing';

/**
 * What a shutdown phase is waiting on, named so a stall reads as a cause
 * rather than as "Closing…" (BUG-286). Every wait is bounded by the
 * lifecycle owner (`electron/main/shutdown-coordinator.ts`).
 */
export type ShutdownWait =
  /** The macOS installer fetching and verifying the update. */
  | 'update-staging'
  /** A Session that was starting when the shutdown began. */
  | 'agents-starting'
  /** The window saving its layout and the operator's place. */
  | 'window-saving'
  | 'processes-stopping'
  | 'services-closing'
  /** The installer replacing the app after everything closed. */
  | 'installer';

export interface ShutdownStatus {
  phase: ShutdownPhase;
  agents: number;
  shells: number;
  /** Null while idle. */
  intent: ShutdownIntent | null;
  /** Set once a wait has taken long enough to be worth naming. */
  waitingOn: ShutdownWait | null;
  /** True while cancelling still leaves every Session running. */
  cancellable: boolean;
}

/**
 * What the operator was holding when the app restarted, outside the layout
 * (BUG-260): where he was standing, and unsent text Exawatt owns. Keyed by
 * holder id; each holder validates its own value when it is restored. Saved
 * only for a restart or an update, and restored once by the next launch.
 */
export type HeldOperatorState = Record<string, unknown>;

export interface HeldStateRequest {
  requestId: string;
}

/**
 * Dismissed notices, by notice identity: the version that was dismissed.
 * A notice is shown again only when its version changes (BUG-285).
 */
export type NoticeDismissals = Record<string, string>;

/** A newer build is installed on disk than the one running. */
export interface UpdateReadyNotice {
  currentSha: string;
  installedSha: string;
}

export interface WorkspaceRecoveryState {
  previousRunInterrupted: boolean;
}

export interface WorkspaceStorageRecovery {
  required: boolean;
  recoveryFile?: string;
  originalFile?: string;
}

export type ProjectResolveResult =
  | { ok: true; projectDir: string; projectName: string }
  | { ok: false; error: string };

export interface ProjectImportCandidate {
  projectDir: string;
  projectName: string;
  suggested: boolean;
}

export type ProjectScanResult =
  | { ok: true; candidates: ProjectImportCandidate[] }
  | { ok: false; error: string };

/* ---- Harness project suggestions (ENG-046 O1) ---------------------------- */

/** The harnesses whose own project stores Exawatt reads for suggestions. */
export type ProjectSuggestionHarness = 'claude' | 'codex' | 'antigravity';

/**
 * Each store a suggestion can come from. Every one is read, never written
 * (docs/engineering/projects/first-run-on-ramp.md, "Fixed decisions").
 */
export type HarnessProjectStore =
  /** Claude Code's per-directory entries in its user config (`projects`). */
  | 'claude-code-config'
  /** Claude Code's transcript directories; the transcript's own `cwd`. */
  | 'claude-code-transcripts'
  /** Codex's `[projects."<path>"]` trust table in `config.toml`. */
  | 'codex-config'
  /** Codex's threads: the state database, or each rollout's first line. */
  | 'codex-sessions'
  /** Antigravity's project files (`folderUri`s). */
  | 'antigravity-projects'
  /** Antigravity's conversation index (workspace URIs and times). */
  | 'antigravity-conversations';

/** One store's evidence that a harness knows a directory. */
export interface HarnessProjectEvidence {
  harness: ProjectSuggestionHarness;
  store: HarnessProjectStore;
  /** The directory exactly as the store recorded it, before folding. */
  directory: string;
  /** When the store last saw activity there; null when it records none. */
  observedAt: number | null;
  /** The store's own display name, when it has one. Never renames a
   *  Project; shown only as evidence. */
  label: string | null;
}

/**
 * One folder a harness already works in, offered before it is a Project.
 * Opening it goes through the same path Browse does, so `path` is exactly
 * the folder `projects:resolve` returns for it.
 */
export interface HarnessProjectSuggestion {
  path: string;
  /** The git common directory, or null for a folder outside git. */
  commonDir: string | null;
  /** The folder's basename; a suggestion has no Project name yet. */
  name: string;
  /** Every harness whose store knows the folder, most recent first: the
   *  first is the suggesting harness the composer recommends. */
  harnesses: ProjectSuggestionHarness[];
  /** Newest activity across every store; null when none records a time. */
  lastActivityAt: number | null;
  /** Inside the recent window (30 days). Older rows sit behind "Show
   *  older", ranked the same way. */
  recent: boolean;
  evidence: HarnessProjectEvidence[];
}

/**
 * What one store answered. `missing` is a fact (the harness never wrote
 * it); `unreadable` is the absence of one, carried with a named reason and
 * never folded into an empty list.
 */
export interface HarnessStoreRead {
  harness: ProjectSuggestionHarness;
  store: HarnessProjectStore;
  status: 'read' | 'missing' | 'unreadable';
  /** Directory entries the store yielded before the filter. */
  entries: number;
  /** For `unreadable`: what went wrong, in a few words. Never file text. */
  reason?: string;
}

export type ProjectSuggestionsResult =
  | {
      ok: true;
      suggestions: HarnessProjectSuggestion[];
      stores: HarnessStoreRead[];
      readAt: number;
    }
  | { ok: false; error: string };

export interface ProjectSuggestionsRequest {
  /** Re-read every store now instead of answering from the last read. */
  refresh?: boolean;
}

/** What `operator-stats:plan` derives publications from (BUG-164). */
export interface OperatorStatsPlanRequest {
  /** The immutable first-consent instant. */
  since: string;
  timezone: string;
  cursor: OperatorStatsPublicationCursor | null;
}

/* ---- Sign-in hand-offs -------------------------------------------------- */

export interface ElectronAuthStartConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  redirectTo: string;
}

/** The renderer's live session, handed across IPC. Credentials: never
 *  logged. */
export interface ElectronAuthSessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ElectronAuthLinkConfig extends ElectronAuthStartConfig {
  /** `linkIdentity` needs a live session, and the renderer is where one
   *  exists: main creates its own client per flow and holds none. */
  session?: ElectronAuthSessionTokens;
}

/** An auth failure, already reduced by main to what is safe to show. */
export interface ElectronAuthError {
  name: string;
  message: string;
  status?: number;
  code?: string;
}

/** Observed facts about this Electron host, never a Session lifecycle command.
 * A dark display is not observable through these events and is not inferred. */
export interface HostPowerSnapshot {
  /** Monotonic within one main-process lifetime; orders reads against pushes. */
  revision: number;
  powerSource: 'ac' | 'battery' | 'unknown';
  screenLock: 'locked' | 'unlocked' | 'unknown';
  systemSleep: 'awake' | 'suspended';
}

/** Device-local intent for Exawatt-owned system-sleep prevention. */
export type DeviceKeepAwakePolicy = 'never' | 'ac-only' | 'ac-and-battery';

/** This reports only Exawatt's assertion, never a global promise of sleep. */
export interface DevicePowerStatus {
  revision: number;
  policy: DeviceKeepAwakePolicy;
  powerSource: HostPowerSnapshot['powerSource'];
  assertion: 'inactive' | 'active' | 'error';
  supportedWorkingSessions: number;
  /** Active local sources without an opt-out applied to this process. */
  independentSources: string[];
  error: string | null;
}
