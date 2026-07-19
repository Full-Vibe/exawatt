#!/usr/bin/env node
// Generated for the public repository by the "public-dogfood-tooling" recipe.

import { spawn } from 'node:child_process';
import {
  teamIdentifierFromIdentityName,
  resolveDeveloperIdIdentity,
} from './lib/macos-code-signing.mjs';

const root = process.cwd();

async function run(command, args, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))
    );
  });
}

const identity = await resolveDeveloperIdIdentity();
const teamIdentifier = teamIdentifierFromIdentityName(identity.name);
console.log(
  `[dogfood-signing] using the Keychain Developer ID Application identity${teamIdentifier ? ` for Team ${teamIdentifier}` : ''}`
);

await run('pnpm', ['build']);
await run('pnpm', ['electron:prepare-renderer']);
await run('pnpm', ['electron:compile']);
await run('pnpm', [
  'exec',
  'electron-builder',
  'install-app-deps',
  '--arch',
  'arm64',
]);
await run('pnpm', ['electron:prepare-main']);
await run(
  'pnpm',
  [
    'exec',
    'electron-builder',
    '--mac',
    'dir',
    '--arm64',
    '--config',
    'electron-builder.dogfood.yml',
    '--config.npmRebuild=false',
  ],
  {
    CSC_NAME: identity.fingerprint,
    EXAWATT_RENDERER_SIGN_IDENTITY: identity.fingerprint,
  }
);
