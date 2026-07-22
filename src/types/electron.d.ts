export {};

export type PtyHarness = 'shell' | 'claude' | 'codex';
export type AgentPermissionMode = 'prompt' | 'auto' | 'unrestricted';

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
}

export type PtyAttentionKind = 'bell' | 'turn-end';

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
  /** needs-operator flag (ENG-015 S1); null when clear */
  attention?: PtyAttention | null;
  /** ever given work — task, resume, or human keystroke (D22); adopt-time
   *  seed for the started/unstarted glyph truth */
  engaged?: boolean;
  /** Main-owned activity truth (D29), including the self-resize redraw grace.
   *  Optional only for compatibility with older renderer mocks. */
  working?: boolean;
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
  write: (id: string, data: string) => Promise<void>;
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
  /** remove and return a ledger entry so the tab can resurrect whole */
  reopenSession: (
    durableSessionId: string
  ) => Promise<ClosedSessionEntry | null>;
  rename: (id: string, title: string) => Promise<void>;
  /** the operator is looking at this session (null = none focused) */
  focus: (id: string | null) => Promise<void>;
  /** Revalidate a persisted goal through main before renderer hydration.
   *  Optional only for compatibility with older mocks. */
  restoreContext?: (
    durableSessionId: string,
    subtitle: string
  ) => Promise<string | null>;
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
  onRecap: (handler: (payload: PtyReentryRecap) => void) => () => void;
  onAttention: (
    handler: (payload: { id: string; attention: PtyAttention | null }) => void
  ) => () => void;
  onActivity: (
    handler: (payload: { id: string; working: boolean }) => void
  ) => () => void;
  /** fires once per session, on the first work it is given (D22) */
  onEngaged: (handler: (payload: { id: string }) => void) => () => void;
  onNotificationClick: (
    handler: (payload: { id: string }) => void
  ) => () => void;
}

export interface HarnessResumeCandidate {
  id: string;
  cwd: string;
  updatedAt: number;
  label: string;
}

export interface RecentConversation {
  id: string;
  harness: Exclude<PtyHarness, 'shell'>;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  title: string;
  description: string | null;
  titleSource: 'native' | 'generated' | 'fallback';
  needsSummary: boolean;
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

export interface ElectronRoadmapApi {
  read: (projectDir: string) => Promise<RoadmapReadResult>;
  sessionEvidence: (cwd: string) => Promise<RoadmapSessionEvidence>;
  watch: (projectDir: string) => Promise<void>;
  unwatch: (projectDir: string) => Promise<void>;
  onFileChanged: (
    handler: (payload: { projectDir: string }) => void
  ) => () => void;
}

/** userData/settings.json — the personal-taste escape hatch (S3) */
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
  agentSources?: {
    projectLastUsed: Record<string, string>;
    sourceRecency: Record<string, number>;
    projectPermissionModes: Record<string, Record<string, AgentPermissionMode>>;
  };
}

export interface ElectronSettingsApi {
  get: () => Promise<ExawattSettings>;
  setAttentionNotifications: (enabled: boolean) => Promise<ExawattSettings>;
  setDockBadge: (enabled: boolean) => Promise<ExawattSettings>;
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
  getBuildInfo: () => Promise<ExawattBuildInfo>;
  /** the operator's OS highlight color, '#RRGGBB' (D32); null when
   *  unavailable (web, linux) — CSS falls back to the app accent */
  accentColor?: () => Promise<string | null>;
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
