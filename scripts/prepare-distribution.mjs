import process from 'node:process';
import {
  applyCompanyOverlayInPlace,
  resolveCompositionProfile,
} from './lib/company-composition.mjs';
import {
  prepareDistribution,
  resolveDistributionInput,
} from './lib/distribution-build.mjs';

// A build that declares itself official and cannot find its contract must fail
// here, before any build time is spent, rather than silently producing a
// community artifact (incident `0017`).
const { inputJson, source } = await resolveDistributionInput(process.env);

const prepared = await prepareDistribution({
  root: process.cwd(),
  inputJson,
});

console.log(
  `[distribution] prepared schema v${prepared.contract.schemaVersion} ${prepared.digest.slice(0, 12)} (${prepared.contract.brand?.productName ?? 'Exawatt Community'}) via ${source}`
);

// Then compose the tree this build is about to consume (ENG-030 WP3). The
// public checkout has no overlay and this is a no-op; the company checkout
// restores exactly the hosted implementations its profile declares, and fails
// loudly rather than producing an official deployment that quietly lost a
// capability (incident `0017`).
const profile = resolveCompositionProfile({
  env: process.env,
  distributionSource: source,
});
const composition = await applyCompanyOverlayInPlace({
  root: process.cwd(),
  profile,
});
console.log(
  composition.overlay === 'absent'
    ? `[composition] ${profile}: no company overlay in this checkout`
    : `[composition] ${profile}: ${composition.applied.length} overlay file(s) applied, ${composition.removed.length} withdrawn`
);
