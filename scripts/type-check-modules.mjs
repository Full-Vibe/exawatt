#!/usr/bin/env node

// ENG-039: the type-check a change inside declared modules owes.
//
// `pnpm type-check` compiles the whole program. A change that stays inside
// declared modules and leaves their public surface alone (the landing only
// routes such a change here) can break the types of three things: the files
// of the modules it touches, the integration tests that name them, and the
// files outside them that import a public file whose module-internal import
// closure reaches the change (an inferred exported type can move with an
// internal edit). This compiles exactly that program, with the root
// configuration and the ambient declarations the whole program carries.
// Electron main is not in the root program: its modules are compiled by
// `electron:compile`, which every Electron change already runs, and their
// tests by `type-check:electron-tests`, which runs here.
//
// Usage: pnpm type-check:modules -- <changed paths...>

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  moduleOwner,
  workingTreeTopology,
} from './lib/module-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPED = /\.(?:ts|tsx|mts|cts)$/u;
const AMBIENT = [
  'next-env.d.ts',
  'vitest.setup.ts',
  'vitest.setup.app-node.ts',
];

/** Where a file is type-checked: the root program, Electron's, or nowhere. */
export function programOf(file) {
  if (file.startsWith('electron/')) return 'electron';
  if (/^(?:scripts|\.githooks)\//u.test(file) || !TYPED.test(file)) return null;
  return 'root';
}

/**
 * The root-program files a change to `changed` owes: every typed file of the
 * modules it touches, the integration tests naming them, and the outside
 * importers of each public file whose in-module closure reaches a change.
 */
export function rootProgramFiles(changed, { manifest, edges, files, surface }) {
  const owner = moduleOwner(manifest);
  const modules = new Set(changed.map(file => owner(file)?.id).filter(Boolean));
  const program = new Set(
    [...files].filter(
      file => modules.has(owner(file)?.id) && programOf(file) === 'root'
    )
  );
  for (const entry of manifest.integrationTests) {
    if (entry.modules.some(id => modules.has(id)) && programOf(entry.test) === 'root')
      program.add(entry.test);
  }
  const importers = new Map();
  for (const edge of edges) {
    if (!importers.has(edge.to)) importers.set(edge.to, []);
    importers.get(edge.to).push(edge.from);
  }
  for (const id of modules) {
    const inModule = file => owner(file)?.id === id;
    // Files inside the module that reach a change, then the public ones.
    const reached = new Set(changed.filter(inModule));
    const pending = [...reached];
    while (pending.length > 0) {
      for (const importer of importers.get(pending.pop()) ?? []) {
        if (inModule(importer) && !reached.has(importer)) {
          reached.add(importer);
          pending.push(importer);
        }
      }
    }
    for (const file of reached) {
      if (!surface.get(id)?.has(file)) continue;
      for (const importer of importers.get(file) ?? []) {
        if (!inModule(importer) && programOf(importer) === 'root')
          program.add(importer);
      }
    }
  }
  return [...program].sort();
}

function generatedDeclarations(root) {
  const found = [];
  for (const directory of ['.next/types', '.next/dev/types']) {
    const absolute = path.join(root, directory);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute, { recursive: true })) {
      if (/\.ts$/u.test(String(entry)))
        found.push(path.join(directory, String(entry)));
    }
  }
  return found;
}

function run(command, args) {
  console.log(`[type-check:modules] ${command} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    );
  });
}

async function main() {
  const changed = process.argv.slice(2).filter(argument => argument !== '--');
  const topology = workingTreeTopology(ROOT);
  if (!topology) throw new Error('modules.json is missing; run pnpm type-check.');
  // The core runtime and the resolved distribution the program reads, built
  // from this tree exactly as `pnpm type-check` builds them.
  await run('pnpm', ['distribution:prepare']);
  const owner = moduleOwner(topology.manifest);
  const owned = changed.filter(file => owner(file));
  const rootFiles = rootProgramFiles(owned, topology);
  if (rootFiles.length > 0) {
    await run('node', ['scripts/run-next-with-distribution.mjs', 'typegen']);
    const directory = await mkdtemp(path.join(tmpdir(), 'exawatt-type-check-modules-'));
    try {
      const ambient = [
        ...AMBIENT,
        ...[...topology.files].filter(file => /^src\/types\/.+\.d\.ts$/u.test(file)),
        ...generatedDeclarations(ROOT),
      ].filter(file => existsSync(path.join(ROOT, file)));
      const config = path.join(directory, 'tsconfig.json');
      await writeFile(
        config,
        `${JSON.stringify(
          {
            extends: path.join(ROOT, 'tsconfig.json'),
            compilerOptions: { noEmit: true, incremental: false },
            include: [],
            files: [...new Set([...rootFiles, ...ambient])].map(file =>
              path.join(ROOT, file)
            ),
          },
          null,
          2
        )}\n`
      );
      console.log(
        `[type-check:modules] root program: ${rootFiles.length} files of the touched modules, their integration tests and the importers of what the change reaches`
      );
      await run('pnpm', ['exec', 'tsc', '-p', config, '--noEmit']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (owned.some(file => programOf(file) === 'electron')) {
    await run('pnpm', ['run', 'type-check:electron-tests']);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(error => {
    console.error(`[type-check:modules] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
