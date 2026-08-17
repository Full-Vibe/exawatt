#!/usr/bin/env node
// Generated for the public repository by the "public-dogfood-tooling" recipe.

import { evaluateAppCodeIdentity } from './lib/macos-code-signing.mjs';
import { resolvePackagedApp } from './lib/packaged-app.mjs';

// The bundle is named by the distribution contract, not by a literal (BUG-043).
// The contract decides app identity. Team custody belongs to the distributor
// and must be supplied explicitly when the caller needs to pin it.
const packaged = await resolvePackagedApp({
  appPathOverride: process.argv[2] ?? process.env.EXAWATT_APP_PATH,
});
const appPath = packaged.appPath;

const result = await evaluateAppCodeIdentity(appPath, {
  expectedIdentifier:
    process.env.EXAWATT_EXPECTED_APP_IDENTIFIER ?? packaged.identity.appId,
  expectedTeamIdentifier: process.env.EXAWATT_EXPECTED_TEAM_IDENTIFIER,
});

console.log(
  `[electron-code-identity] verified ${result.identifier}, Team ${result.teamIdentifier}, ${result.nestedCodeCount} nested code objects, and ${result.archivedNativeCodeCount} archived native code objects`
);
