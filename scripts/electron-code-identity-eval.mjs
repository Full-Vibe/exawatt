#!/usr/bin/env node
// Generated for the public repository by the "public-dogfood-tooling" recipe.

import {
  EXPECTED_DOGFOOD_IDENTIFIER,
  EXPECTED_DOGFOOD_TEAM_IDENTIFIER,
  evaluateAppCodeIdentity,
} from './lib/macos-code-signing.mjs';
import { packagedAppBundle } from './lib/packaged-app.mjs';

// The bundle is named by the distribution contract, not by a literal (BUG-043).
// The signing identity it must carry is NOT: `EXPECTED_DOGFOOD_*` is the
// operator's Developer ID custody, which only the official distribution claims.
// A distributor with its own signing identity overrides it explicitly.
const appPath =
  process.argv[2] ??
  process.env.EXAWATT_APP_PATH ??
  (await packagedAppBundle({ appPathOverride: undefined }));

const result = await evaluateAppCodeIdentity(appPath, {
  expectedIdentifier:
    process.env.EXAWATT_EXPECTED_APP_IDENTIFIER ?? EXPECTED_DOGFOOD_IDENTIFIER,
  expectedTeamIdentifier:
    process.env.EXAWATT_EXPECTED_TEAM_IDENTIFIER ??
    EXPECTED_DOGFOOD_TEAM_IDENTIFIER,
});

console.log(
  `[electron-code-identity] verified ${result.identifier}, Team ${result.teamIdentifier}, ${result.nestedCodeCount} nested code objects, and ${result.archivedNativeCodeCount} archived native code objects`
);
