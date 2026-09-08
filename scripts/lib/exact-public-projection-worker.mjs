#!/usr/bin/env node

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { readProjectionEpoch } from './public-projection-epoch.mjs';

import { projectPublicHistory } from './public-projection.mjs';

const [sourceRepo, sourceSha, destination, publicAnchor] =
  process.argv.slice(2);
if (!sourceRepo || !sourceSha || !destination) {
  throw new Error(
    '[exact-public] projection worker requires source repository, source commit, and destination'
  );
}

const epoch = await readProjectionEpoch(sourceRepo);
let fastForwardFrom = null;
if (epoch?.mode === 'published-snapshot') {
  if (!publicAnchor) {
    throw new Error(
      '[exact-public] published-snapshot epoch requires --public-anchor <localrepo>; capture the public repository separately before offline certification'
    );
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/|^[^/]+@[^:]+:/iu.test(publicAnchor)) {
    throw new Error(
      '[exact-public] public anchor must be a local repository, not a URL'
    );
  }
  const repository = path.resolve(publicAnchor);
  if (!(await stat(repository).catch(() => null))?.isDirectory()) {
    throw new Error(
      '[exact-public] public anchor must name an existing local repository directory'
    );
  }
  fastForwardFrom = { repository, ref: 'master' };
}

const result = await projectPublicHistory({
  sourceRepo,
  sourceSha,
  destination,
  fastForwardFrom,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
