export {};

export type PtyHarness = 'shell' | 'claude' | 'codex';

export interface PtyCreateOptions {
  harness: PtyHarness;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
  /** revive: harness resumes its last conversation in this directory */
  resume?: boolean;
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
  harness: PtyHarness;
  title: string;
  cwd: string;
  /** directory-keyed Project/Initiative grouping (worktree-aware git root) */
  projectDir: string;
  projectName: string;
  cols: number;
  rows: number;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
  /** last output timestamp (ENG-015 S2: live status in the switcher) */
  lastDataAt: number;
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
  rename: (id: string, title: string) => Promise<void>;
  /** the operator is looking at this session (null = none focused) */
  focus: (id: string | null) => Promise<void>;
  list: () => Promise<PtySessionInfo[]>;
  buffer: (id: string) => Promise<string>;
  createWorktree: (repoDir: string, branch: string) => Promise<WorktreeResult>;
  onData: (handler: (payload: { id: string; data: string }) => void) => () => void;
  onExit: (handler: (payload: { id: string; exitCode: number }) => void) => () => void;
  onContext: (handler: (payload: { id: string; summary: string }) => void) => () => void;
  onRecap: (handler: (payload: PtyReentryRecap) => void) => () => void;
  onAttention: (
    handler: (payload: { id: string; attention: PtyAttention | null }) => void
  ) => () => void;
}

export interface ElectronWorkspaceApi {
  load: () => Promise<unknown | null>;
  save: (state: unknown) => Promise<void>;
}

/** userData/settings.json — the personal-taste escape hatch (S3) */
export interface ExawattSettings {
  terminal?: {
    fontFamily?: string;
    fontSize?: number;
    /** 1.0 = the font's own metrics (Terminal.app behavior) */
    lineHeight?: number;
  };
}

export interface ElectronSettingsApi {
  get: () => Promise<ExawattSettings>;
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
      settings?: ElectronSettingsApi;
      auth?: {
        openExternal: (url: string) => Promise<void>;
        onDeepLinkCode: (handler: (code: string) => void) => () => void;
      };
    };
  }
}
