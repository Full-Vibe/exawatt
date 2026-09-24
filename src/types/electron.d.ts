import type { DesktopBridge } from '@exawatt/core/desktop-bridge';

/**
 * `window.electron` is the desktop bridge preload exposes, declared by the
 * contract both sides are checked against (`@exawatt/core/desktop-bridge`).
 * It is absent in a web browser. Types that cross the bridge are imported
 * from the contract directly; this file declares only where the bridge lives.
 */
declare global {
  interface Window {
    electron?: DesktopBridge;
  }
}

export {};
