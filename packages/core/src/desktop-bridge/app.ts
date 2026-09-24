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

export interface CheckpointRequest {
  requestId: string;
  reason: 'quit' | 'update';
  stage: 'pre-stop' | 'stopped';
}

export type ShutdownPhase =
  | 'idle'
  | 'confirming'
  | 'checkpointing'
  | 'stopping'
  | 'finalizing';

export interface ShutdownStatus {
  phase: ShutdownPhase;
  agents: number;
  shells: number;
}

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
