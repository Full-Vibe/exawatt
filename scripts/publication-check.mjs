#!/usr/bin/env node

// ENG-030 WP5a. The landing floor runs Gate B over CHANGED paths so an agent
// hears about a leak in seconds. That is the right latency and the wrong
// coverage: a file nobody touched is never re-read, and the classifier itself
// can change under files that were clean when they landed. This composite is
// the whole-tree half — every publication gate, over every tracked path, on
// the exact tree CI is holding.
//
// It deliberately does not compile Electron or run the Next build. `ci.yml`
// owns both as first-class named steps so a failure says which one broke.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function commandLabel(command, args) {
  const shown = args.slice(0, 5).join(' ');
  const remainder = args.length > 5 ? ` … (${args.length} arguments)` : '';
  return `${command} ${shown}${remainder}`.trim();
}

function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${commandLabel(command, args)} exited on ${signal}`
            : `${commandLabel(command, args)} exited with ${code}`
        )
      );
    });
  });
}

// Production command execution writes straight to the terminal. This capture
// helper keeps `trackedPaths` injectable in tests without shell quoting, and
// the NUL delimiter is what lets a path containing a space survive the hop.
function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(
        new Error(
          signal
            ? `${commandLabel(command, args)} exited on ${signal}`
            : `${commandLabel(command, args)} exited with ${code}`
        )
      );
    });
  });
}

export async function trackedPaths(root = ROOT, run = capture) {
  const output = await run('git', ['ls-files', '-z'], { cwd: root });
  return output.toString('utf8').split('\0').filter(Boolean);
}

export async function runPublicationChecks(options = {}) {
  const root = options.root ?? ROOT;
  const run = options.run ?? execute;
  const paths = await (options.trackedPaths ?? trackedPaths)(root);
  const checks = [
    ['open-source:paths:check', []],
    ['content:scan', ['--', ...paths]],
    ['security:audit:prod', []],
    ['licenses:check', []],
    ['assets:check', []],
    ['community:check', []],
    ['test:publication', []],
  ];

  for (const [script, args] of checks) {
    process.stdout.write(`[publication] ${script}\n`);
    await run('pnpm', [script, ...args], { cwd: root });
  }

  process.stdout.write(
    `[publication] passed ${checks.length} gates across ${paths.length} tracked files\n`
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  runPublicationChecks().catch(error => {
    process.stderr.write(`[publication] ${error.message}\n`);
    process.exitCode = 1;
  });
}
