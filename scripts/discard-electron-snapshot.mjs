// Tail of `electron:compile`. Compiling rebuilds `@exawatt/core` and the
// Electron main, which invalidates any packaging snapshot of them — so the
// snapshot goes away and development resolves the workspace package directly
// (BUG-016). Packaging flows stage a fresh one right before electron-builder.
import { discardRuntimeDependencies } from './lib/electron-runtime-deps.mjs';

await discardRuntimeDependencies(process.cwd());
