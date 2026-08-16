import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';
import {
  electronBuilderDistributionConfig,
  readPreparedDistribution,
} from './lib/distribution-build.mjs';

const root = process.cwd();
const profile = process.argv.includes('--release')
  ? 'release'
  : process.argv.includes('--dogfood')
    ? 'dogfood'
    : 'base';
const overlayPath =
  profile === 'release'
    ? path.join(root, 'electron-builder.release.yml')
    : profile === 'dogfood'
      ? path.join(root, 'electron-builder.dogfood.yml')
      : null;
const [prepared, base, overlay] = await Promise.all([
  readPreparedDistribution(root),
  readFile(path.join(root, 'electron-builder.yml'), 'utf8').then(parse),
  overlayPath
    ? readFile(overlayPath, 'utf8').then(parse)
    : Promise.resolve(undefined),
]);
const config = electronBuilderDistributionConfig(
  base,
  prepared.contract,
  overlay
);
const output = path.join(
  root,
  '.exawatt-build',
  `electron-builder.${profile}.json`
);
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(
  `[distribution] prepared ${profile} Electron identity ${config.productName} (${config.appId})`
);
