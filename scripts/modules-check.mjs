#!/usr/bin/env node

// ENG-039: every import keeps the module boundaries `modules.json` declares.
//
// Refused: an import from one declared module into another that its
// importer does not depend on, or that reaches past the target's
// entrypoints; a declared dependency cycle; a dependency across
// incompatible environments; a manifest entry that names nothing. Warned,
// never refused: a path no module declares that imports a module's
// internals. Those files join the module's public surface until the
// importer is declared, so a change to them keeps the whole checks.
//
// `pnpm modules:check` reads the checkout as saved (tracked and untracked
// files), so it runs before a commit; the landing runs it on the committed
// tree it checks.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkModuleBoundaries,
  MODULE_MANIFEST,
  ownershipCoverage,
  workingTreeTopology,
} from './lib/module-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WARNING_EXAMPLES = 3;

export function formatModuleReport({ manifest, files, errors, warnings }) {
  const lines = [];
  for (const error of errors) lines.push(`[modules:check] refused: ${error.message}`);
  const byModule = new Map();
  for (const warning of warnings) {
    if (!byModule.has(warning.module)) byModule.set(warning.module, []);
    byModule.get(warning.module).push(warning);
  }
  for (const [module, list] of [...byModule].sort()) {
    lines.push(
      `[modules:check] warning: ${list.length} import(s) from undeclared paths reach past ${module}'s entrypoints; those files count as its public surface:`
    );
    for (const warning of list.slice(0, WARNING_EXAMPLES))
      lines.push(`    ${warning.from} -> ${warning.to}`);
    if (list.length > WARNING_EXAMPLES)
      lines.push(`    ... and ${list.length - WARNING_EXAMPLES} more`);
  }
  const coverage = ownershipCoverage(manifest, files);
  lines.push(
    `[modules:check] ${manifest.modules.length} modules own ${coverage.owned} of ${coverage.production} production source files; ${errors.length} refused, ${warnings.length} warned.`
  );
  if (errors.length > 0)
    lines.push(
      `[modules:check] Import through the target's entrypoints, or declare the dependency or entrypoint in ${MODULE_MANIFEST} on purpose. A test that must cross modules is an integrationTests entry.`
    );
  return lines.join('\n');
}

async function main() {
  const topology = workingTreeTopology(ROOT);
  if (!topology) {
    console.log(`[modules:check] no ${MODULE_MANIFEST}; nothing to check.`);
    return;
  }
  const { errors, warnings } = checkModuleBoundaries(topology.manifest, topology);
  console.log(formatModuleReport({ ...topology, errors, warnings }));
  if (errors.length > 0) process.exitCode = 1;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(error => {
    console.error(`[modules:check] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
