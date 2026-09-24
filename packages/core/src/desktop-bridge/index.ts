/**
 * The desktop bridge contract: every channel between Electron main and the
 * renderer, the values that cross each one, and the `window.electron` object
 * preload builds from them. Main types its handlers and pushes by it, preload
 * `satisfies` it, and the renderer's `window.electron` is declared as it.
 *
 * It lives in core because core is already the Electron-free module both
 * processes import by name: main through its CommonJS build, the renderer
 * through source. Nothing here may import Electron, Node, or `src`
 * (`boundary.test.ts`).
 */
export type * from './api';
export type * from './app';
export type * from './channels';
export type * from './connected-sources';
export type * from './pty';
export type * from './roadmap';
export type * from './settings';
