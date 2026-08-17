#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMPANY_COMPOSITION_PROFILES,
  composeCompanyProfile,
  defaultCompanyOutput,
} from './lib/company-composition.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(args, name) {
  const equals = args.find(argument => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index !== -1) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`[company-compose] ${name} requires a value`);
    }
    return value;
  }
  return null;
}

function usage() {
  return [
    'Usage:',
    '  pnpm company:compose --profile official-web|official-desktop \\',
    '    [--ref <commit>] [--output <dir>]',
    '',
    'Composes the Gate A public tree at <ref> plus this profile’s declared',
    'company overlay entries into an output directory, and writes the',
    '.company-composition.json record naming every input.',
    '',
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('help')) {
    process.stdout.write(usage());
    return;
  }
  const profile = option(args, '--profile');
  if (!COMPANY_COMPOSITION_PROFILES.includes(profile)) {
    throw new Error(
      `[company-compose] --profile must be ${COMPANY_COMPOSITION_PROFILES.join(' or ')}`
    );
  }
  const result = await composeCompanyProfile({
    profile,
    repo: ROOT,
    ref: option(args, '--ref') ?? 'HEAD',
    outputDir: path.resolve(
      option(args, '--output') ?? defaultCompanyOutput(ROOT, profile)
    ),
    requireClean: !args.includes('--allow-dirty'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
