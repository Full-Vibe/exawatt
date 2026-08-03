import type {
  AgentHarness,
  AgentPermissionMode,
  AgentSourceAction,
  AgentSourceActionResult,
  AgentSourceAdapterId,
  AgentSourceCatalogEntry,
  AgentSourceFact,
  AgentSourceRegistryLoadResult,
  AgentSourceRegistryLoadStatus,
  AgentSourceRegistrySnapshot,
  AgentSourceSnapshot,
  AgentSourceState,
  PtyHarness,
} from '@exawatt/core';
import type { OperatorStatsPublishPayload } from '@exawatt/core';

export type {
  AgentHarness,
  AgentPermissionMode,
  AgentSourceAction,
  AgentSourceActionResult,
  AgentSourceAdapterId,
  AgentSourceCatalogEntry,
  AgentSourceFact,
  AgentSourceRegistryLoadResult,
  AgentSourceRegistryLoadStatus,
  AgentSourceRegistrySnapshot,
  AgentSourceSnapshot,
  AgentSourceState,
  PtyHarness,
} from '@exawatt/core';

export interface ElectronAgentSourcesApi {
  list: (
    scope?: 'all' | 'launch',
    refresh?: boolean
  ) => Promise<AgentSourceRegistrySnapshot>;
  act: (
    adapterId: AgentSourceAdapterId,
    action: AgentSourceAction
  ) => Promise<AgentSourceActionResult>;
}

export interface PtyCreateOptions {
  harness: PtyHarness;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
  /** Resume one exact provider conversation. */
  resumeSessionId?: string;
  /** Stable logical Exawatt Session identity. */
  durableSessionId?: string;
  /** Optional first task for a newly-created interactive agent. */
  initialPrompt?: string;
  /** Goal statement carried across a resume for context summaries (D21) —
   *  metadata only, never written to the process. */
  statedTask?: string;
  /** Persisted goal subtitle re-seeded into the summarizer on resume (D21). */
  restoredSubtitle?: string;
  /** Source-agnostic launch policy translated by the harness boundary. */
  permissionMode?: AgentPermissionMode;
  /** Model choice resolved by the Agent Source and pinned for this launch. */
  model?: string;
  /** Reasoning effort pinned for this launch; omitted for a harness default. */
  effort?: string;
}

export interface AgentEffortOption {
  id: string;
  label: string;
  description: string;
}

export interface AgentModelOption {
  id: string;
  label: string;
  description: string;
  defaultEffort: string | null;
  efforts: AgentEffortOption[];
}

export interface AgentModelCatalog {
  harness: Exclude<PtyHarness, 'shell'>;
  effectiveModel: string | null;
  effectiveModelLabel: string;
  effectiveModelSource:
    | 'config'
    | 'harness-recommended'
    | 'account-default'
    | 'unavailable';
  effectiveEffort: string | null;
  effectiveEffortLabel: string;
  effectiveEffortSource:
    | 'config'
    | 'model-default'
    | 'environment'
    | 'unavailable';
  /** An environment override outranks CLI flags, so the UI must not promise a
   * change that the harness would ignore. */
  effortLocked: boolean;
  models: AgentModelOption[];
  catalogMode:
    | 'live-catalog'
    | 'configured-values'
    | 'source-owned'
    | 'unavailable';
  catalogProvenance: string;
  observedAt: number;
  selectionAction: 'choose-in-source' | null;
}

/** `blocked` is a reported operator gate (ENG-023 D4) — a question, a
 *  permission decision, or an MCP elicitation. Like `bell` and unlike
 *  `turn-end`, it needs the operator. */
export type PtyAttentionKind = 'bell' | 'turn-end' | 'blocked';

/** "this session needs the operator" (ENG-015 S1) */
export interface PtyAttention {
  kind: PtyAttentionKind;
  since: number;
}

/** Quiet S4 catch-up generated only when returning after meaningful change. */
export interface PtyReentryRecap {
  id: string;
  text: string;
  awayMs: number;
  generatedAt: number;
}

/** Quiet visual identity for the accepted goal of one durable Session. */
export interface GoalVisual {
  identityKey: string;
  revision: number;
  state: 'fallback' | 'generating' | 'ready' | 'rejected';
  dataUrl?: string | null;
}

export interface PtySessionInfo {
  id: string;
  durableSessionId: string;
  harness: PtyHarness;
  title: string;
  cwd: string;
  /** directory-keyed Project/Project grouping (worktree-aware git root) */
  projectDir: string;
  projectName: string;
  cols: number;
  rows: number;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
  /** Last output timestamp; retained for recency sorting and legacy mocks. */
  lastDataAt: number;
  /** Durable provider conversation identity; null until explicitly captured. */
  harnessSessionId: string | null;
  /** auto-summarized micro-context (W0.4); null until first summary */
  contextSummary?: string | null;
  /** Goal-level work-world projection (ENG-015 S4.1). */
  goalVisual?: GoalVisual | null;
  /** needs-operator flag (ENG-015 S1); null when clear */
  attention?: PtyAttention | null;
  /** ever given work — task, resume, or human keystroke (D22); adopt-time
   *  seed for the started/unstarted glyph truth */
  engaged?: boolean;
  /** Main-owned activity truth (D29), including the self-resize redraw grace.
   *  Optional only for compatibility with older renderer mocks. */
  working?: boolean;
  /** Harness-reported delegated work (ENG-023). `null` or absent means the
   *  source does not report delegation — read as unknown, never as zero. */
  delegation?: SessionDelegation | null;
}

/** One live delegated child (ENG-023). */
export interface DelegatedChild {
  id: string;
  agentType: string | null;
  /** The operator-legible spawn label (ENG-023 D3a). Optional on the wire:
   *  a main process predating D3a omits it, and a failed correlation sends
   *  `null` — both read as "no label", never as an invented one. */
  description?: string | null;
  startedAt: number;
}

/** Which operator gate an Agent is sitting behind (ENG-023 D4). */
export type SessionBlockedReason = 'question' | 'permission' | 'elicitation';

/**
 * Harness-reported turn truth for one Session (ENG-023).
 *
 * Three facts, deliberately kept apart: `ownTurn` answers "is this Session
 * itself generating?", `children` answers "is its team still working?", and
 * `blockedOn` answers "is it waiting on a human?". A parent can be `available`
 * with children mid-flight — that is the common case, and collapsing it is
 * what made a delegating tab read as finished. An Agent can equally be
 * `generating` AND blocked: `AskUserQuestion` fires no `Stop`, so the turn is
 * open while the Agent is doing nothing but waiting for an answer.
 */
export interface SessionDelegation {
  ownTurn: 'generating' | 'available';
  /** Optional on the WIRE only. Main always sends it; a payload from a main
   *  process that predates D4 simply omits it, and absent must read as "no
   *  gate reported" rather than as a type error in the renderer. */
  blockedOn?: SessionBlockedReason | null;
  children: DelegatedChild[];
}

export type WorktreeResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

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

export type PtyCreateResult =
  | { ok: true; session: PtySessionInfo }
  | { ok: false; error: string };

/** a soft-closed Session in the Recently-closed ledger (D23) */
export interface ClosedSessionEntry {
  durableSessionId: string;
  title: string;
  titleKind?: 'default' | 'operator';
  goal: string | null;
  harness: PtyHarness;
  cwd: string;
  projectDir: string;
  projectName: string;
  harnessSessionId: string | null;
  initialTask: string | null;
  closedAt: number;
}

export interface ElectronPtyApi {
  create: (options: PtyCreateOptions) => Promise<PtyCreateResult>;
  listAgentModels: (
    harness: Exclude<PtyHarness, 'shell'>,
    cwd: string
  ) => Promise<AgentModelCatalog>;
  /** Write terminal data; operatorEngaged is true only when a real key event
   * preceded it, allowing main to open the Agent turn before the PTY write. */
  write: (id: string, data: string, operatorEngaged?: boolean) => Promise<void>;
  /** Explicit operator keystroke; terminal protocol replies do not call it. */
  engage: (id: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  /** one-stroke close (D24): stop, await death, forget the runtime record.
   *  discard=true also sheds retained history (never-started sessions). */
  closeSession: (
    durableSessionId: string,
    discard?: boolean
  ) => Promise<boolean>;
  /** soft-close a STOPPED session into the Recently-closed ledger (D23);
   *  history survives until the ledger reaps (~14 days) */
  archiveSession: (
    entry: Omit<ClosedSessionEntry, 'closedAt'>
  ) => Promise<ClosedSessionEntry>;
  closedSessions: () => Promise<ClosedSessionEntry[]>;
  /** Main-owned ledger cardinality after archive, reopen, or retention reap. */
  onClosedSessionsChanged: (handler: (count: number) => void) => () => void;
  /** remove and return a ledger entry so the tab can resurrect whole */
  reopenSession: (
    durableSessionId: string
  ) => Promise<ClosedSessionEntry | null>;
  rename: (id: string, title: string) => Promise<void>;
  /** the operator is looking at this session (null = none focused) */
  focus: (id: string | null) => Promise<void>;
  /** Sync the current signed-in token to Electron main. Main never exposes it
   * back to the renderer and uses it only for hosted context-label requests. */
  setContextAuth?: (accessToken: string | null) => Promise<void>;
  /** Apply an explicit human correction before feedback upload completes. */
  correctContext?: (
    durableSessionId: string,
    label: string
  ) => Promise<string | null>;
  /** Revalidate a persisted goal through main before renderer hydration.
   *  Optional only for compatibility with older mocks. */
  restoreContext?: (
    durableSessionId: string,
    subtitle: string
  ) => Promise<string | null>;
  /** Re-seed a validated persisted visual into main on app restart. */
  restoreGoalVisual?: (
    durableSessionId: string,
    visual: GoalVisual
  ) => Promise<GoalVisual | null>;
  list: () => Promise<PtySessionInfo[]>;
  buffer: (id: string) => Promise<string>;
  bufferSnapshot: (id: string) => Promise<{ text: string; cursor: number }>;
  bufferSince: (
    id: string,
    cursor: number
  ) => Promise<{ text: string; cursor: number; truncated: boolean }>;
  retainedHistory: (durableSessionId: string) => Promise<{
    text: string;
    cursor: number;
    updatedAt: number;
    corrupt: boolean;
  }>;
  pasteClipboard: (
    id: string
  ) => Promise<{ kind: 'image' | 'text' | 'empty'; path?: string }>;
  /** composer image/text paste (D24): reads the clipboard without touching
   *  any PTY; images land as temp-file paths */
  clipboardRead: () => Promise<
    | { kind: 'image'; path: string | null }
    | { kind: 'text' | 'empty'; text?: string }
  >;
  copyText: (text: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  openPath: (
    filePath: string,
    cwd: string,
    /** contain: true for UNTRUSTED repo-derived paths (roadmap docs) —
     *  main rejects anything that escapes cwd */
    options?: { contain?: boolean }
  ) => Promise<void>;
  createWorktree: (repoDir: string, branch: string) => Promise<WorktreeResult>;
  listResumeCandidates: (
    harness: PtyHarness,
    cwd: string
  ) => Promise<HarnessResumeCandidate[]>;
  reconcileResumeIdentities: (
    hints: ResumeIdentityHint[]
  ) => Promise<ReconciledResumeIdentity[]>;
  /** Source-neutral local catalog. Enrichment is a separate authenticated,
   * non-blocking pass so this list never waits on a model. */
  listRecentConversations: (cwd: string) => Promise<RecentConversation[]>;
  enrichRecentConversations: (
    cwd: string,
    accessToken: string
  ) => Promise<RecentConversation[]>;
  onData: (
    handler: (payload: {
      id: string;
      durableSessionId: string;
      data: string;
      cursor: number;
    }) => void
  ) => () => void;
  onExit: (
    handler: (payload: {
      id: string;
      durableSessionId: string;
      exitCode: number;
    }) => void
  ) => () => void;
  onIdentity: (
    handler: (payload: {
      id: string;
      durableSessionId: string;
      harnessSessionId: string;
    }) => void
  ) => () => void;
  onContext: (
    handler: (payload: { durableSessionId: string; summary: string }) => void
  ) => () => void;
  onGoalVisual?: (
    handler: (payload: { durableSessionId: string; visual: GoalVisual }) => void
  ) => () => void;
  onRecap: (handler: (payload: PtyReentryRecap) => void) => () => void;
  onAttention: (
    handler: (payload: { id: string; attention: PtyAttention | null }) => void
  ) => () => void;
  onActivity: (
    handler: (payload: { id: string; working: boolean }) => void
  ) => () => void;
  /** fires once per session, on the first work it is given (D22) */
  onEngaged: (handler: (payload: { id: string }) => void) => () => void;
  /** Harness-reported delegation changes (ENG-023); absent on older preloads.
   *  `null` means the Session has nothing live to report and every surface
   *  should fall back to inference — main owns that decision. */
  onDelegation?: (
    handler: (payload: {
      id: string;
      delegation: SessionDelegation | null;
    }) => void
  ) => () => void;
  onNotificationClick: (
    handler: (payload: { id: string }) => void
  ) => () => void;
}

export interface HarnessResumeCandidate {
  id: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  label: string;
  description: string | null;
}

export interface ResumeIdentityHint {
  durableSessionId: string;
  harness: AgentHarness;
  cwd: string;
  initialTask: string | null;
  harnessSessionId: string | null;
}

export interface ReconciledResumeIdentity {
  durableSessionId: string;
  harness: AgentHarness;
  cwd: string;
  harnessSessionId: string;
  source: 'durable-index' | 'task-correlation';
}

export interface RecentConversation {
  id: string;
  harness: AgentHarness;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  title: string;
  description: string | null;
  titleSource: 'native' | 'generated' | 'fallback';
  needsSummary: boolean;
  /** Exact provider identity when known; null for retained-only Exawatt
   * Sessions that cannot safely auto-resume a harness conversation. */
  providerSessionId: string | null;
  /** Continue the provider identity directly, or restore Exawatt's richer
   * logical Session (including retained history) when the Project ledger owns
   * this conversation. */
  continuation:
    | { kind: 'provider' }
    | { kind: 'exawatt-session'; durableSessionId: string };
}

export interface ElectronWorkspaceApi {
  load: () => Promise<unknown | null>;
  save: (state: unknown) => Promise<void>;
  recovery: () => Promise<{ previousRunInterrupted: boolean }>;
  onChanged: (handler: (state: unknown) => void) => () => void;
}

/** Raw roadmap file read for the roadmap lens (ENG-017); parsing happens
 *  renderer-side in @exawatt/core per decision 0011. */
export type RoadmapReadResult =
  | { status: 'ok'; file: string; text: string; mtimeMs: number }
  | { status: 'none'; checked: string[] }
  | { status: 'error'; error: string };

/** Read-only git signals for session→item link inference. */
export interface RoadmapSessionEvidence {
  branch: string | null;
  worktreeDirname: string;
  commitSubjects: string[];
}

export interface RoadmapProjectChange {
  hash: string;
  subject: string;
  committedAt: number;
}

export type RoadmapWritableStatus = 'now' | 'next' | 'later' | 'parked';

export type RoadmapWriteAction =
  | { kind: 'set-status'; itemId: string; status: RoadmapWritableStatus }
  | { kind: 'move-item'; itemId: string; direction: 'up' | 'down' }
  | { kind: 'set-milestone'; itemId: string; line: number; done: boolean };

export interface RoadmapWriteRequest {
  projectDir: string;
  file: string;
  expectedContentHash: string;
  action: RoadmapWriteAction;
  confirmed?: boolean;
}

export type RoadmapWriteResult =
  | {
      status: 'applied';
      contentHash: string;
      undoToken: string;
      permission: 'roadmap-state-write';
    }
  | {
      status: 'permission-required' | 'refused' | 'failed';
      message: string;
      permission: 'roadmap-state-write';
    };

export type RoadmapUndoResult =
  | { status: 'applied'; contentHash: string }
  | { status: 'refused' | 'failed'; message: string };

export interface ElectronRoadmapApi {
  read: (projectDir: string) => Promise<RoadmapReadResult>;
  sessionEvidence: (cwd: string) => Promise<RoadmapSessionEvidence>;
  activity: (projectDir: string) => Promise<RoadmapProjectChange[]>;
  writeState: (request: RoadmapWriteRequest) => Promise<RoadmapWriteResult>;
  undoState: (token: string) => Promise<RoadmapUndoResult>;
  watch: (projectDir: string) => Promise<void>;
  unwatch: (projectDir: string) => Promise<void>;
  onFileChanged: (
    handler: (payload: { projectDir: string }) => void
  ) => () => void;
}

/** userData/settings.json — the personal-taste escape hatch (S3) */
export interface AppearancePreferencesV1 {
  schemaVersion: 1;
  selection:
    | { mode: 'manual'; themeId: string }
    | { mode: 'auto'; lightThemeId: string; darkThemeId: string };
  autoPair?: { lightThemeId: string; darkThemeId: string };
  accentSource: 'theme' | 'system';
  interfaceFont: 'theme' | 'system' | 'geist';
  interfaceScale: 90 | 100 | 110 | 120;
  contrast: 'system' | 'enhanced';
  transparency: 'system' | 'reduced';
}

export interface ExawattSettings {
  terminal?: {
    fontFamily?: string;
    fontSize?: number;
    /** 1.0 = the font's own metrics (Terminal.app behavior) */
    lineHeight?: number;
    /** xterm cell-spacing adjustment */
    letterSpacing?: number;
    /** Subpixel emboldening used to match native text rasterization. */
    fontStrokeWidth?: number;
  };
  notifications?: {
    attention: boolean;
    /** macOS dock badge count + bounce (D18) — default off */
    dockBadge?: boolean;
  };
  conversationSummaries?: {
    hosted: boolean;
  };
  goalVisuals?: {
    enabled: boolean;
  };
  agentSources?: {
    projectLastUsed: Record<string, string>;
    sourceRecency: Record<string, number>;
    projectPermissionModes: Record<string, Record<string, AgentPermissionMode>>;
  };
  appearance?: AppearancePreferencesV1;
}

export interface ElectronSettingsApi {
  get: () => Promise<ExawattSettings>;
  setAppearance: (
    appearance: AppearancePreferencesV1
  ) => Promise<ExawattSettings>;
  setAttentionNotifications: (enabled: boolean) => Promise<ExawattSettings>;
  setDockBadge: (enabled: boolean) => Promise<ExawattSettings>;
  setHostedConversationSummaries: (
    enabled: boolean
  ) => Promise<ExawattSettings>;
  setGoalVisualsEnabled: (enabled: boolean) => Promise<ExawattSettings>;
  recordAgentSourceUse: (
    projectDir: string,
    source: string,
    usedAt: number
  ) => Promise<ExawattSettings>;
  setAgentPermissionMode: (
    projectDir: string,
    source: string,
    permissionMode: AgentPermissionMode
  ) => Promise<ExawattSettings>;
  onChanged: (handler: (settings: ExawattSettings) => void) => () => void;
}

export interface ExawattBuildInfo {
  sha: string;
  branch: string;
  builtAt: string;
  delivery: 'dogfood' | 'signed';
  /** `app.getVersion()` — the marketed app version alongside the exact sha
   *  (ENG-025: feedback rows stamp both) */
  version: string;
}

export interface ProductUpdateStatus {
  phase:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  liveSessions: number;
  error: string | null;
}

export interface ElectronAppApi {
  /** Electron-authoritative first-paint state, captured by preload before any
   * document script runs. Web renderers do not expose this field. */
  bootstrapAppearance?: {
    preferences: AppearancePreferencesV1;
    safeTheme: boolean;
  } | null;
  getBuildInfo: () => Promise<ExawattBuildInfo>;
  /** the operator's OS highlight color, '#RRGGBB' (D32); null when
   *  unavailable (web, linux) — CSS falls back to the app accent */
  accentColor?: () => Promise<string | null>;
  appearance?: () => Promise<{
    dark: boolean;
    highContrast: boolean;
    invertedColors: boolean;
    systemAccent: string | null;
    safeTheme: boolean;
  }>;
  onAppearanceChanged?: (
    handler: (appearance: {
      dark: boolean;
      highContrast: boolean;
      invertedColors: boolean;
      systemAccent: string | null;
      safeTheme: boolean;
    }) => void
  ) => () => void;
  getUpdateStatus: () => Promise<ProductUpdateStatus>;
  checkForUpdates: () => Promise<ProductUpdateStatus>;
  restartUpdate: () => Promise<void>;
  setWorkspaceCheckpointOwner: (ownsWorkspaceState: boolean) => Promise<void>;
  completeCheckpoint: (requestId: string, ok: boolean) => Promise<void>;
  onCheckpointRequest: (
    handler: (request: {
      requestId: string;
      reason: 'quit' | 'update';
      stage: 'pre-stop' | 'stopped';
    }) => void
  ) => () => void;
  onShutdownStatus: (
    handler: (status: {
      phase:
        | 'idle'
        | 'confirming'
        | 'checkpointing'
        | 'stopping'
        | 'finalizing';
      agents: number;
      shells: number;
    }) => void
  ) => () => void;
  onUpdateReady: (
    handler: (update: { currentSha: string; installedSha: string }) => void
  ) => () => void;
  onUpdateStatus: (
    handler: (status: ProductUpdateStatus) => void
  ) => () => void;
}

declare global {
  interface Window {
    electron?: {
      isElectron: boolean;
      platform: string;
      agent?: {
        invoke: (method: string, ...args: unknown[]) => Promise<unknown>;
        on: (channel: string, handler: (...args: unknown[]) => void) => void;
        off: (channel: string, handler: (...args: unknown[]) => void) => void;
      };
      agentSources?: ElectronAgentSourcesApi;
      operatorStats?: {
        scan: (
          since: string,
          timezone: string
        ) => Promise<
          Pick<
            OperatorStatsPublishPayload,
            | 'schemaVersion'
            | 'consentVersion'
            | 'enabled'
            | 'timezone'
            | 'days'
            | 'runs'
          >
        >;
      };
      pty?: ElectronPtyApi;
      workspace?: ElectronWorkspaceApi;
      roadmap?: ElectronRoadmapApi;
      settings?: ElectronSettingsApi;
      app?: ElectronAppApi;
      auth?: {
        startGoogle: (config: {
          supabaseUrl: string;
          supabaseAnonKey: string;
          redirectTo: string;
        }) => Promise<void>;
        linkGithub: (config: {
          supabaseUrl: string;
          supabaseAnonKey: string;
          redirectTo: string;
        }) => Promise<void>;
        onComplete: (handler: () => void) => () => void;
        onError: (
          handler: (error: {
            name: string;
            message: string;
            status?: number;
            code?: string;
          }) => void
        ) => () => void;
        installTestSession?: (
          config: { supabaseUrl: string; supabaseAnonKey: string },
          tokens: { accessToken: string; refreshToken: string }
        ) => Promise<void>;
      };
      dialog?: {
        /** native folder picker; resolves to the chosen path or null if cancelled */
        openDirectory: (title?: string) => Promise<string | null>;
        /** does this path exist on the current machine? (S5 "locate" flow) */
        pathExists: (path: string) => Promise<boolean>;
      };
      projects?: {
        resolve: (path: string) => Promise<ProjectResolveResult>;
        scanDirectory: (path: string) => Promise<ProjectScanResult>;
      };
      menu?: {
        /** application-menu commands (ENG-016 D8): menu items mirror the
         *  app's verbs and send their command name here on click */
        onCommand: (handler: (command: string) => void) => () => void;
        /** sync effective registry bindings into the menus' display
         *  accelerators (D10) — '' clears a column (chord rebinds) */
        syncAccelerators?: (map: Record<string, string>) => Promise<void>;
        /** Keep native menu enablement aligned with the renderer's current
         *  Project, Session, recovery, split, and attention targets. */
        syncAvailability?: (map: Record<string, boolean>) => Promise<void>;
      };
      feedback?: {
        /** Keeps the native Help menu honest without exposing auth data. */
        setAuthenticated: (authenticated: boolean) => Promise<void>;
        /** Explicit user action only; returns a bounded JPEG data URL. */
        captureScreenshot: () => Promise<string>;
        /** Dev-evaluator capability marker; absent from production preload. */
        testMode?: true;
      };
      shortcuts?: {
        /** the machine's parsed com.apple.symbolichotkeys.plist as JSON
         *  (D19 amendment): {} = verified untouched prefs, null = could not
         *  read (renderer falls back to Apple defaults, unverified) */
        systemHotkeys?: () => Promise<unknown>;
      };
    };
  }
}
