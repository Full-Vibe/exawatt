export {};

export type PtyHarness = 'shell' | 'claude' | 'codex';

export interface PtyCreateOptions {
  harness: PtyHarness;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
  initiative?: string;
}

export interface PtySessionInfo {
  id: string;
  harness: PtyHarness;
  title: string;
  initiative: string | null;
  cwd: string;
  cols: number;
  rows: number;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
}

export interface ElectronPtyApi {
  create: (options: PtyCreateOptions) => Promise<PtySessionInfo>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  list: () => Promise<PtySessionInfo[]>;
  buffer: (id: string) => Promise<string>;
  onData: (handler: (payload: { id: string; data: string }) => void) => () => void;
  onExit: (handler: (payload: { id: string; exitCode: number }) => void) => () => void;
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
      auth?: {
        openExternal: (url: string) => Promise<void>;
        onDeepLinkCode: (handler: (code: string) => void) => () => void;
      };
    };
  }
}
