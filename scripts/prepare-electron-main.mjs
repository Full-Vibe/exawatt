import { cp, mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = await realpath(path.join(root, 'node_modules', 'node-pty'));
const dependencyRoot = path.join(root, 'dist-electron', 'node_modules');
const target = path.join(dependencyRoot, 'node-pty');

await rm(dependencyRoot, { recursive: true, force: true });
await mkdir(dependencyRoot, { recursive: true });
await cp(source, target, { recursive: true, dereference: true });

console.log('[electron-main] staged node-pty runtime');
