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
//
// Every gate announces itself before it runs and reports after it finishes,
// pass or fail, and a failure names the gate. Incident `0022`: this wrapper's
// only visible line for a whole CI step was the content scanner starting,
// because the 1,558-path command line it echoed was one 67 KB log line, and
// `gh run view --log` drops a log from the first line longer than 64 KiB
// onward. The scanner had passed; `security:audit:prod` had failed; nothing a
// reader could see said either. So the path list now travels on stdin,
// NUL-delimited, and no log ever carries it.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function commandLabel(command, args) {
  const shown = args.slice(0, 5).join(' ');
  const remainder = args.length > 5 ? ` … (${args.length} arguments)` : '';
  return `${command} ${shown}${remainder}`.trim();
}

function exitError(command, args, code, signal) {
  return new Error(
    signal
      ? `${commandLabel(command, args)} exited on ${signal}`
      : `${commandLabel(command, args)} exited with ${code}`
  );
}

// Production command execution writes straight to the terminal. `input`, when
// given, is written to the child's stdin and closed, which is how the tracked
// path list reaches the content scanner without appearing on any command line.
function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: [
        options.input === undefined ? 'inherit' : 'pipe',
        options.stdout ?? 'inherit',
        'inherit',
      ],
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(exitError(command, args, code, signal));
    });
  });
}

// The capture helper keeps `trackedPaths` injectable in tests without shell
// quoting, and the NUL delimiter is what lets a path containing a space
// survive the hop.
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
      reject(exitError(command, args, code, signal));
    });
  });
}

export async function trackedPaths(root = ROOT, run = capture) {
  const output = await run('git', ['ls-files', '-z'], { cwd: root });
  return output.toString('utf8').split('\0').filter(Boolean);
}

/** The stdin payload the content scanner reads: `git ls-files -z` shape. */
export function stdinPathList(paths) {
  return paths.map(entry => `${entry}\0`).join('');
}

export async function runPublicationChecks(options = {}) {
  const root = options.root ?? ROOT;
  const run = options.run ?? execute;
  const log = options.log ?? (line => process.stdout.write(`${line}\n`));
  const paths = await (options.trackedPaths ?? trackedPaths)(root);
  const checks = [
    ['open-source:paths:check', []],
    ['content:scan', ['--', '--stdin0'], { input: stdinPathList(paths) }],
    ['security:audit:prod', []],
    ['licenses:check', []],
    ['assets:check', []],
    ['community:check', []],
    ['test:publication', []],
  ];

  for (const [script, args, extra = {}] of checks) {
    log(`[publication] ${script}`);
    try {
      await run('pnpm', [script, ...args], { cwd: root, ...extra });
    } catch (error) {
      log(`[publication] ${script} FAILED`);
      throw new Error(`gate ${script} failed: ${error.message}`, {
        cause: error,
      });
    }
    log(`[publication] ${script} passed`);
  }

  log(
    `[publication] passed ${checks.length} gates across ${paths.length} tracked files`
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  // A non-zero exit that printed nothing is the shape incident `0022` was
  // mistaken for. Every failure above is reported before the exit; this guard
  // exists so a path that is not can never read as a gate that vanished.
  let reported = false;
  process.on('exit', code => {
    if (code !== 0 && !reported) {
      process.stderr.write(
        `[publication] exiting ${code} without a report; that is a wrapper defect, not a verdict on the tree\n`
      );
    }
  });
  runPublicationChecks().catch(error => {
    reported = true;
    process.stderr.write(`[publication] FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
