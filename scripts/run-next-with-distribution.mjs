import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {
  nextDistributionEnvironment,
  readPreparedDistribution,
} from './lib/distribution-build.mjs';

const root = process.cwd();
const [command, ...args] = process.argv.slice(2);
if (!command)
  throw new Error('Usage: run-next-with-distribution.mjs <command>');

const prepared = await readPreparedDistribution(root);
const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, command, ...args], {
  cwd: root,
  env: nextDistributionEnvironment(prepared),
  stdio: 'inherit',
});

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
if (exitCode !== 0) process.exit(exitCode);

if (command === 'build') {
  await mkdir(path.join(root, '.next'), { recursive: true });
  await writeFile(
    path.join(root, '.next', 'exawatt-distribution.sha256'),
    `${prepared.digest}\n`,
    'utf8'
  );
}
