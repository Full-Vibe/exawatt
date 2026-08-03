#!/usr/bin/env node

import { chromium } from 'playwright-core';
import { resolveQaBrowser } from './lib/qa-browser.mjs';

try {
  const selection = await resolveQaBrowser(chromium);
  const result = {
    status: 'ready',
    kind: selection.kind,
    name: selection.name,
    executablePath: selection.executablePath,
    mainIdentifier: selection.mainSignature?.identifier ?? null,
    networkHelperPath: selection.helperPath,
    networkHelperIdentifier: selection.helperSignature?.identifier ?? null,
    teamIdentifier:
      selection.helperSignature?.teamIdentifier ??
      selection.mainSignature?.teamIdentifier ??
      null,
    warning: selection.warning ?? null,
  };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `[qa-browser] ready: ${result.name} (${result.kind})\n` +
        `  executable: ${result.executablePath}` +
        (result.networkHelperIdentifier
          ? `\n  network helper: ${result.networkHelperIdentifier}`
          : '') +
        (result.teamIdentifier
          ? `\n  signer team: ${result.teamIdentifier}`
          : '') +
        (result.warning ? `\n  warning: ${result.warning}` : '')
    );
  }
} catch (error) {
  console.error(`[qa-browser] ${String(error?.message ?? error)}`);
  process.exitCode = 1;
}
