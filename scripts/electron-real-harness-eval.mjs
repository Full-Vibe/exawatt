#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { startAgentFromLauncher } from './lib/electron-eval.mjs';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = resolve(
  process.env.EXAWATT_APP_PATH ??
    'release/mac-arm64/Exawatt.app/Contents/MacOS/Exawatt'
);
const root = mkdtempSync(join(tmpdir(), 'exawatt-real-harness-'));
const userData = join(root, 'userData');
const projectDir = join(root, 'project');
mkdirSync(userData, { recursive: true });
mkdirSync(projectDir, { recursive: true });

async function sessions(page) {
  return (await page.evaluate(async () => (await window.electron?.pty?.list()) ?? []));
}

async function waitFor(page, predicate, label, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const current = await sessions(page);
    const match = await predicate(current);
    if (match) return match;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function buffer(page, id) {
  return (
    (await page.evaluate(
      async sessionId => window.electron?.pty?.buffer(sessionId),
      id
    )) ?? ''
  );
}

async function acceptFixtureDirectoryTrust(page, session) {
  await waitFor(
    page,
    async () => {
      const output = (await buffer(page, session.id)).toLowerCase();
      return (
        output.includes('trust') &&
        (output.includes('confirm') || output.includes('continue'))
      );
    },
    `${session.harness} directory trust prompt`,
    30_000
  );
  await page.evaluate(
    async id => window.electron?.pty?.write(id, '\r'),
    session.id
  );
}

async function typeIntoPty(page, id, text) {
  for (const character of text) {
    await page.evaluate(
      async ({ sessionId, data }) => window.electron?.pty?.write(sessionId, data),
      { sessionId: id, data: character }
    );
    await page.waitForTimeout(8);
  }
  await page.evaluate(
    async sessionId => window.electron?.pty?.write(sessionId, '\r'),
    id
  );
}

let app = null;
try {
  app = await electron.launch({
    executablePath: executable,
    env: {
      ...process.env,
      HOME: homedir(),
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: userData,
      EXAWATT_TEST_QUIT_RESPONSE: 'confirm',
    },
  });
  const page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(30_000);
  await page.locator('[data-command-altitude]').waitFor();
  await page.evaluate(dir => {
    window.dispatchEvent(
      new CustomEvent('exawatt:open-project', { detail: dir })
    );
  }, projectDir);
  await page.locator('[data-agent-composer]').waitFor();

  await page.getByRole('button', { name: 'Start' }).click();
  const claude = await waitFor(
    page,
    current => current.find(session => session.harness === 'claude'),
    'real Claude session'
  );
  console.log(`[real-harness] Claude launched as ${claude.harnessSessionId}`);
  await acceptFixtureDirectoryTrust(page, claude);
  console.log('[real-harness] Claude directory trusted');
  await startAgentFromLauncher(page, { engine: 'Codex' });
  const startingCodex = await waitFor(
    page,
    current => current.find(session => session.harness === 'codex'),
    'real Codex session'
  );
  await acceptFixtureDirectoryTrust(page, startingCodex);
  console.log('[real-harness] Codex directory trusted');
  for (const session of [claude, startingCodex]) {
    await waitFor(
      page,
      async () => {
        const output = await buffer(page, session.id);
        return session.harness === 'claude'
          ? output.includes('Claude') && output.includes('Welcome')
          : output.includes('OpenAI Codex');
      },
      `${session.harness} interactive prompt`
    );
  }
  console.log('[real-harness] both interactive prompts ready');
  await page.waitForTimeout(10_000);
  const marker = 'EXAWATT_REAL_PROVIDER_OK';
  for (const session of [claude, startingCodex]) {
    await typeIntoPty(
      page,
      session.id,
      `Reply with exactly ${marker}. Do not use tools or modify files.`
    );
    console.log(`[real-harness] prompt submitted to ${session.harness}`);
  }
  const codex = await waitFor(
    page,
    current =>
      current.find(
        session => session.harness === 'codex' && session.harnessSessionId
      ),
    'real Codex provider identity'
  );
  console.log(`[real-harness] Codex identity captured as ${codex.harnessSessionId}`);
  if (!claude.harnessSessionId || !codex.harnessSessionId) {
    throw new Error('A real provider identity was not captured');
  }
  await waitFor(
    page,
    async () => {
      const outputs = await Promise.all([
        buffer(page, claude.id),
        buffer(page, codex.id),
      ]);
      return outputs.every(output => output.split(marker).length >= 3);
    },
    'real Claude and Codex replies',
    180_000
  );

  const closed = new Promise(resolveClose => app.once('close', resolveClose));
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  await closed;
  app = null;
  console.log(
    `PASS real harnesses: Claude ${claude.harnessSessionId} + Codex ${codex.harnessSessionId}`
  );
} finally {
  if (app) {
    const closed = new Promise(resolveClose => app.once('close', resolveClose));
    app.process().kill('SIGKILL');
    await Promise.race([closed, new Promise(resolveWait => setTimeout(resolveWait, 2_000))]);
  }
  if (!process.env.EXAWATT_KEEP_EVAL) {
    rmSync(root, { recursive: true, force: true });
  } else {
    console.log(`[real-harness] retained fixture: ${root}`);
  }
}
