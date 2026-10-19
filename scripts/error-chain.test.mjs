import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

import { describeErrorChain } from './lib/error-chain.mjs';

const execFileAsync = promisify(execFile);

test('prints every cause with the failed command stderr', async () => {
  let commandError;
  try {
    await execFileAsync(process.execPath, [
      '-e',
      'process.stderr.write("a sealed resource is missing or invalid\\n"); process.exit(3)',
    ]);
  } catch (error) {
    commandError = error;
  }
  const wrapped = new Error(
    '[artifacts] Exawatt.zip does not contain a valid signed Exawatt.app',
    {
      cause: new Error('[artifacts] Exawatt.app is not a valid signed app', {
        cause: commandError,
      }),
    }
  );

  const lines = describeErrorChain(wrapped).split('\n');

  assert.equal(lines[0], wrapped.message);
  assert.equal(lines[1], `caused by: ${wrapped.cause.message}`);
  assert.match(lines[2], /^caused by: Command failed/u);
  assert.ok(
    lines.includes('  stderr: a sealed resource is missing or invalid'),
    lines.join('\n')
  );
});

test('prints the failed command stdout, where some tools give their verdict', async () => {
  let commandError;
  try {
    await execFileAsync(process.execPath, [
      '-e',
      'process.stdout.write("Exawatt.app does not have a ticket stapled to it.\\n"); process.exit(65)',
    ]);
  } catch (error) {
    commandError = error;
  }
  const wrapped = new Error(
    '[artifacts] Exawatt.app failed stapled notarization ticket validation',
    {
      cause: commandError,
    }
  );

  assert.ok(
    describeErrorChain(wrapped)
      .split('\n')
      .includes('  stdout: Exawatt.app does not have a ticket stapled to it.'),
    describeErrorChain(wrapped)
  );
});

test('a plain error is its own message', () => {
  assert.equal(describeErrorChain(new Error('no feed')), 'no feed');
  assert.equal(describeErrorChain('thrown string'), 'thrown string');
});
