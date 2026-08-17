#!/usr/bin/env node

import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMPANY_COMPOSITION_PROFILES,
  composeCompanyProfile,
  proveCompanyComposition,
  readCompanyOverlayManifestAt,
  resolveCompositionSource,
} from './lib/company-composition.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(args, name) {
  const equals = args.find(argument => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index !== -1) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`[company-proof] ${name} requires a value`);
    }
    return value;
  }
  return null;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The composition proof (ENG-030 WP3).
 *
 * Two properties, both stated against real composed trees rather than against
 * the manifest that describes them:
 *
 *   1. DETERMINISM — composing a profile twice from the same commit yields the
 *      same output-tree and composition digests.
 *   2. THE BOUNDARY HOLDS — every hosted-web target is ABSENT from the public
 *      tree and from `official-desktop`, and PRESENT in `official-web`. That is
 *      the property incident `0017` costs eighteen hours of empty leaderboard
 *      when it is merely assumed.
 */
async function main() {
  const args = process.argv.slice(2);
  const ref = option(args, '--ref') ?? 'HEAD';
  const proof = await proveCompanyComposition({ repo: ROOT, ref });

  const source = await resolveCompositionSource(ROOT, ref);
  const { manifest } = await readCompanyOverlayManifestAt(source);
  const targetsByProfile = new Map(
    COMPANY_COMPOSITION_PROFILES.map(profile => [
      profile,
      manifest.entries
        .filter(entry => entry.profile === profile)
        .map(entry => entry.target)
        .sort(),
    ])
  );

  const publicPaths = new Set(source.basePaths);
  const leaked = manifest.entries
    .map(entry => entry.target)
    .filter(target => publicPaths.has(target));
  if (leaked.length > 0) {
    throw new Error(
      `[company-proof] the public tree already contains overlay targets: ${leaked.join(', ')}`
    );
  }

  const boundary = [];
  const staging = path.join(ROOT, '.company-build', 'proof');
  for (const profile of COMPANY_COMPOSITION_PROFILES) {
    const composed = await composeCompanyProfile({
      profile,
      repo: ROOT,
      ref,
      outputDir: path.join(staging, profile),
    });
    for (const [owner, targets] of targetsByProfile) {
      for (const target of targets) {
        const present = await exists(
          path.join(composed.output, ...target.split('/'))
        );
        const expected = owner === profile;
        if (present !== expected) {
          throw new Error(
            `[company-proof] ${profile} ${present ? 'contains' : 'is missing'} ${target}; expected ${expected ? 'present' : 'absent'}`
          );
        }
      }
    }
    boundary.push({
      profile,
      output: composed.output,
      present: targetsByProfile.get(profile),
      absent: COMPANY_COMPOSITION_PROFILES.filter(other => other !== profile)
        .flatMap(other => targetsByProfile.get(other))
        .sort(),
    });
  }

  process.stdout.write(
    `${JSON.stringify({ ...proof, boundary }, null, 2)}\n`
  );
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
