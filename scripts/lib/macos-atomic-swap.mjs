import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const source = fileURLToPath(
  new URL('../macos-atomic-swap.c', import.meta.url)
);

export async function atomicSwapPaths(left, right) {
  if (process.platform !== 'darwin') {
    throw new Error('Atomic application swapping requires macOS.');
  }
  const helperDirectory = await mkdtemp(
    path.join(tmpdir(), 'exawatt-atomic-swap-')
  );
  const helper = path.join(helperDirectory, 'atomic-swap');
  try {
    await execFileAsync('/usr/bin/xcrun', [
      'clang',
      '-Os',
      '-Wall',
      '-Wextra',
      source,
      '-o',
      helper,
    ]);
    await execFileAsync(helper, [left, right]);
  } catch (error) {
    const details = String(error?.stderr ?? '').trim();
    throw new Error(
      `Could not atomically swap ${left} and ${right}.${details ? ` ${details}` : ''}`,
      { cause: error }
    );
  } finally {
    await rm(helperDirectory, { recursive: true, force: true });
  }
}
