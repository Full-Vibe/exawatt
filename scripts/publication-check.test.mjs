import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runPublicationChecks,
  stdinPathList,
} from './publication-check.mjs';

function recorder(calls) {
  return async (command, args, options) => {
    calls.push({
      command,
      args,
      cwd: options.cwd,
      ...(options.input === undefined ? {} : { input: options.input }),
    });
  };
}

test('publication gate composes every owned checker over the tracked tree', async () => {
  const calls = [];
  await runPublicationChecks({
    root: '/repo',
    trackedPaths: async () => ['plain.ts', 'path with spaces.md'],
    run: recorder(calls),
    log() {},
  });

  assert.deepEqual(calls, [
    { command: 'pnpm', args: ['open-source:paths:check'], cwd: '/repo' },
    {
      command: 'pnpm',
      args: ['content:scan', '--', '--stdin0'],
      cwd: '/repo',
      input: 'plain.ts\0path with spaces.md\0',
    },
    { command: 'pnpm', args: ['security:audit:prod'], cwd: '/repo' },
    { command: 'pnpm', args: ['licenses:check'], cwd: '/repo' },
    { command: 'pnpm', args: ['assets:check'], cwd: '/repo' },
    { command: 'pnpm', args: ['community:check'], cwd: '/repo' },
    { command: 'pnpm', args: ['test:publication'], cwd: '/repo' },
  ]);
});

// Incident `0022`. The tracked path list is 67 KB; echoed on a command line
// it was one log line longer than `gh run view --log` can read, and the CLI
// dropped everything after it. No path may ever be a command-line argument
// of this gate, however many there are.
test('the tracked path list travels on stdin, never on a command line', async () => {
  const tracked = Array.from({ length: 2_000 }, (_, index) => `dir/file-${index}.ts`);
  const calls = [];
  await runPublicationChecks({
    trackedPaths: async () => tracked,
    run: recorder(calls),
    log() {},
  });

  for (const call of calls) {
    assert.ok(call.args.length <= 3, `${call.args[0]} carries ${call.args.length} arguments`);
    assert.ok(
      !call.args.some(argument => tracked.includes(argument)),
      `${call.args[0]} received a tracked path as an argument`
    );
  }
  const scan = calls.find(call => call.args[0] === 'content:scan');
  assert.deepEqual(scan.input.split('\0').filter(Boolean), tracked);
  assert.equal(stdinPathList(['a', 'b c']), 'a\0b c\0');
});

test('publication gate stops at the first failed checker and names the gate', async () => {
  const scripts = [];
  const lines = [];

  await assert.rejects(
    runPublicationChecks({
      trackedPaths: async () => ['tracked.ts'],
      run: async (_command, [script]) => {
        scripts.push(script);
        if (script === 'licenses:check') throw new Error('license mismatch');
      },
      log: line => lines.push(line),
    }),
    /^Error: gate licenses:check failed: license mismatch$/u
  );

  assert.deepEqual(scripts, [
    'open-source:paths:check',
    'content:scan',
    'security:audit:prod',
    'licenses:check',
  ]);
  // Every gate says it started and how it ended; the last word is the failure.
  assert.deepEqual(lines, [
    '[publication] open-source:paths:check',
    '[publication] open-source:paths:check passed',
    '[publication] content:scan',
    '[publication] content:scan passed',
    '[publication] security:audit:prod',
    '[publication] security:audit:prod passed',
    '[publication] licenses:check',
    '[publication] licenses:check FAILED',
  ]);
});
