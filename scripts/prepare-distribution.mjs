import process from 'node:process';
import { prepareDistribution } from './lib/distribution-build.mjs';

const prepared = await prepareDistribution({
  root: process.cwd(),
  inputJson: process.env.EXAWATT_DISTRIBUTION_CONFIG_JSON,
});

console.log(
  `[distribution] prepared schema v${prepared.contract.schemaVersion} ${prepared.digest.slice(0, 12)} (${prepared.contract.brand?.productName ?? 'Exawatt Community'})`
);
