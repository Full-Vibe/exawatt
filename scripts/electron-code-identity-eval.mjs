#!/usr/bin/env node
// Generated for the public repository by the "public-dogfood-tooling" recipe.

import path from 'node:path';
import { evaluateAppCodeIdentity } from './lib/macos-code-signing.mjs';

const appPath =
  process.argv[2] ??
  process.env.EXAWATT_APP_PATH ??
  path.join(process.cwd(), 'release', 'mac-arm64', 'Exawatt.app');

const result = await evaluateAppCodeIdentity(appPath, {
  expectedIdentifier:
    process.env.EXAWATT_EXPECTED_APP_IDENTIFIER ?? 'com.exawatt.app',
  expectedTeamIdentifier: process.env.EXAWATT_EXPECTED_TEAM_IDENTIFIER,
});

console.log(
  `[electron-code-identity] verified ${result.identifier}, Team ${result.teamIdentifier}, ${result.nestedCodeCount} nested code objects, and ${result.archivedNativeCodeCount} archived native code objects`
);
