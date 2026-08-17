import process from 'node:process';
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
