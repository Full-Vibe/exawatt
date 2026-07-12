export {};

export type PtyHarness = 'shell' | 'claude' | 'codex';

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
  /** last output timestamp (ENG-015 S2: live status in the switcher) */
  lastDataAt: number;
  /** Durable provider conversation identity; null until explicitly captured. */
  harnessSessionId: string | null;
  /** auto-summarized micro-context (W0.4); null until first summary */
  contextSummary?: string | null;
  /** needs-operator flag (ENG-015 S1); null when clear */
  attention?: PtyAttention | null;
}

export type WorktreeResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export type PtyCreateResult =
  | { ok: true; session: PtySessionInfo }
  | { ok: false; error: string };

export interface ElectronPtyApi {
  create: (options: PtyCreateOptions) => Promise<PtyCreateResult>;
  write: (id: string, data: string) => Promise<void>;
  /** Explicit operator keystroke; terminal protocol replies do not call it. */
  engage: (id: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  deleteSession: (durableSessionId: string) => Promise<boolean>;
  rename: (id: string, title: string) => Promise<void>;
  /** the operator is looking at this session (null = none focused) */
  focus: (id: string | null) => Promise<void>;
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
    handler: (payload: { id: string; summary: string }) => void
  ) => () => void;
  onRecap: (handler: (payload: PtyReentryRecap) => void) => () => void;
  onAttention: (
    handler: (payload: { id: string; attention: PtyAttention | null }) => void
  ) => () => void;
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

export interface ElectronWorkspaceApi {
  load: () => Promise<unknown | null>;
  save: (state: unknown) => Promise<void>;
  recovery: () => Promise<{ previousRunInterrupted: boolean }>;
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
  };
}

export interface ElectronSettingsApi {
  get: () => Promise<ExawattSettings>;
  setAttentionNotifications: (enabled: boolean) => Promise<ExawattSettings>;
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
  getUpdateStatus: () => Promise<ProductUpdateStatus>;
  checkForUpdates: () => Promise<ProductUpdateStatus>;
  restartUpdate: () => Promise<void>;
  completeCheckpoint: (requestId: string, ok: boolean) => Promise<void>;
  onCheckpointRequest: (
    handler: (request: { requestId: string; reason: 'quit' | 'update' }) => void
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
        openExternal: (url: string) => Promise<void>;
        onDeepLinkCode: (handler: (code: string) => void) => () => void;
      };
      dialog?: {
        /** native folder picker; resolves to the chosen path or null if cancelled */
        openDirectory: () => Promise<string | null>;
        /** does this path exist on the current machine? (S5 "locate" flow) */
        pathExists: (path: string) => Promise<boolean>;
      };
      menu?: {
        /** application-menu commands (ENG-016 D8): menu items mirror the
         *  app's verbs and send their command name here on click */
        onCommand: (handler: (command: string) => void) => () => void;
        /** sync effective registry bindings into the menus' display
         *  accelerators (D10) — '' clears a column (chord rebinds) */
        syncAccelerators?: (map: Record<string, string>) => Promise<void>;
      };
    };
  }
}
