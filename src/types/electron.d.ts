export {};

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
      auth?: {
        openExternal: (url: string) => Promise<void>;
        onDeepLinkCode: (handler: (code: string) => void) => () => void;
      };
    };
  }
}
