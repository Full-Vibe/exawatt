#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = resolve(
  process.env.EXAWATT_APP_PATH ??
    'release/mac-arm64/Exawatt.app/Contents/MacOS/Exawatt'
);
const root = mkdtempSync(join(tmpdir(), 'exawatt-exact-resume-'));
const userData = join(root, 'userData');
const fakeBin = join(root, 'bin');
const projectDir = join(root, 'project');
mkdirSync(userData, { recursive: true });
mkdirSync(fakeBin, { recursive: true });
mkdirSync(projectDir, { recursive: true });

const fakeClaude = join(fakeBin, 'claude');
writeFileSync(
  fakeClaude,
  `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "-p" ]; then
    printf 'fake context'
    exit 0
  fi
done
printf 'FAKE_CLAUDE_ARGS:%s\\n' "$*"
while IFS= read -r line; do printf '%s\\n' "$line"; done
`
);
chmodSync(fakeClaude, 0o755);

async function launch() {
  return electron.launch({
    executablePath: executable,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: userData,
    },
  });
}

async function waitForSessionCount(page, expected) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const sessions = await page.evaluate(
      async () => (await window.electron?.pty?.list()) ?? []
    );
    if (sessions.length === expected) return sessions;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${expected} PTY sessions`);
}

async function summonComposer(page) {
  if ((await page.locator('[data-agent-composer]').count()) > 0) return;
  const toggle = page.locator('[data-composer-toggle][aria-expanded="false"]');
  if ((await toggle.count()) > 0) await toggle.click();
  else await page.getByRole('button', { name: 'New Agent' }).click();
  await page.locator('[data-agent-composer]').waitFor();
}

let app = null;
try {
  app = await launch();
  let page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(20_000);
  await page.locator('[data-command-altitude]').waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Loading…')
  );
  if (!new URL(page.url()).pathname.startsWith('/workspace')) {
    await page.locator('[data-command-altitude-level="terminal"]').click();
    await page.waitForURL('**/workspace*');
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading…')
    );
  }
  await page.getByRole('button', { name: 'Open Project' }).first().waitFor();
  await page.evaluate(dir => {
    window.dispatchEvent(
      new CustomEvent('exawatt:open-project', { detail: dir })
    );
  }, projectDir);
  await page.locator('[data-agent-composer]').waitFor();

  for (let count = 1; count <= 4; count++) {
    // D24 uses a new-Agent tab once a Project already has Sessions; older
    // layouts expose an inline toggle. Exercise either supported summon path.
    await summonComposer(page);
    await page.getByRole('button', { name: 'Start' }).click();
    const snapshot = await waitForSessionCount(page, count);
    console.log(
      `[exact-resume] launch ${count}: ${snapshot?.map(session => `${session.id}:${session.harnessSessionId}`).join(', ')}`
    );
  }
  await page.waitForTimeout(500);
  const originalIds = await page.evaluate(async () => {
    const sessions = await window.electron?.pty?.list();
    return sessions?.map(session => session.harnessSessionId) ?? [];
  });
  if (originalIds.length !== 4 || new Set(originalIds).size !== 4) {
    throw new Error(
      `Expected four distinct Claude IDs; got ${originalIds.join(', ')}`
    );
  }
  await page.waitForTimeout(700);
  await app.close();
  app = null;

  const persisted = JSON.parse(
    readFileSync(join(userData, 'workspace.json'), 'utf8')
  );
  const persistedIds = persisted.projects[0].tabs.map(
    tab => tab.harnessSessionId
  );
  if (JSON.stringify(persistedIds) !== JSON.stringify(originalIds)) {
    throw new Error(
      'Workspace did not persist the four exact Claude identities'
    );
  }

  app = await launch();
  page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(20_000);
  const resumeBanner = page.getByRole('region', {
    name: 'Saved Agent recovery',
  });
  await resumeBanner.waitFor();
  const before = await page.evaluate(
    async () => (await window.electron?.pty?.list())?.length
  );
  if (before !== 0)
    throw new Error(`Relaunch silently spawned ${before} sessions`);
  await resumeBanner.getByRole('button', { name: 'Resume 4 Agents' }).click();
  await waitForSessionCount(page, 4);

  const resumed = await page.evaluate(async () => {
    const pty = window.electron?.pty;
    const sessions = (await pty?.list()) ?? [];
    return await Promise.all(
      sessions.map(async session => ({
        id: session.harnessSessionId,
        buffer: (await pty?.buffer(session.id)) ?? '',
      }))
    );
  });
  const resumedIds = resumed.map(item => item.id);
  if (JSON.stringify(resumedIds) !== JSON.stringify(originalIds)) {
    throw new Error(`Resume identity mismatch: ${resumedIds.join(', ')}`);
  }
  for (const item of resumed) {
    if (
      !item.id ||
      !item.buffer.includes(`resuming exact claude conversation ${item.id}`)
    ) {
      throw new Error(`Resume lifecycle did not name exact ID ${item.id}`);
    }
  }
  await app.close();
  app = null;
  console.log(
    'PASS exact resume: four tabs -> four saved IDs -> four exact resumes'
  );
} finally {
  await app?.close().catch(() => undefined);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(root, { recursive: true, force: true });
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
