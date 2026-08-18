#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  openShellFromLauncher,
  startAgentFromLauncher,
} from './lib/electron-eval.mjs';
import { claudeProbeSh, codexProbeSh } from './lib/harness-probe-fixture.mjs';
import { packagedExecutable } from './lib/packaged-app.mjs';

// The packaged bundle is named by the distribution contract, not by a literal
// (BUG-043): the default community contract packages `Exawatt Community.app`.
const executable = await packagedExecutable();
const root = mkdtempSync(join(tmpdir(), 'exawatt-lifecycle-'));
const userData = join(root, 'userData');
const fakeHome = join(root, 'home');
const fakeBin = join(root, 'bin');
const pidDir = join(root, 'pids');
const projectDir = join(root, 'project');
const screenshots = resolve('.artifacts', 'eng-018');
for (const directory of [
  userData,
  fakeHome,
  fakeBin,
  pidDir,
  projectDir,
  screenshots,
]) {
  mkdirSync(directory, { recursive: true });
}

const fakeClaude = join(fakeBin, 'claude');
writeFileSync(
  fakeClaude,
  `#!/bin/sh
${claudeProbeSh()}
id="unknown"
prev=""
for arg in "$@"; do
  if [ "$prev" = "--session-id" ] || [ "$prev" = "--resume" ]; then id="$arg"; fi
  prev="$arg"
done
printf '%s\n' "$$" > "$EXAWATT_TEST_PID_DIR/claude-$id-$$.pid"
printf 'FAKE_CLAUDE:%s\n' "$*"
while IFS= read -r line; do printf '%s\n' "$line"; done
`
);
chmodSync(fakeClaude, 0o755);

const fakeCodex = join(fakeBin, 'codex');
writeFileSync(
  fakeCodex,
  `#!/bin/sh
${codexProbeSh()}
id="$(/usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]')"
fresh=1
previous=""
for arg in "$@"; do
  if [ "$previous" = "resume" ]; then id="$arg"; fresh=0; break; fi
  previous="$arg"
done
printf '%s\n' "$$" > "$EXAWATT_TEST_PID_DIR/codex-$id-$$.pid"
printf 'FAKE_CODEX:%s\n' "$*"
if [ "$fresh" = "1" ]; then
  dir="$HOME/.codex/sessions/fixture"
  /bin/mkdir -p "$dir"
  printf '{"type":"session_meta","payload":{"id":"%s","cwd":"%s"}}\n' "$id" "$PWD" > "$dir/rollout-$id.jsonl"
  fresh=0
fi
while IFS= read -r line; do
  printf '%s\n' "$line"
done
`
);
chmodSync(fakeCodex, 0o755);

function launch(responses = 'confirm') {
  return electron.launch({
    executablePath: executable,
    env: {
      ...process.env,
      HOME: fakeHome,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: userData,
      EXAWATT_TEST_PID_DIR: pidDir,
      EXAWATT_TEST_HARNESS_BIN: fakeBin,
      EXAWATT_TEST_QUIT_RESPONSES: responses,
    },
  });
}

async function pageFor(app) {
  const page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(25_000);
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
  await page
    .locator(
      '[data-agent-composer], [data-composer-toggle], button:has-text("Open Project")'
    )
    .first()
    .waitFor();
  return page;
}

async function sessions(page) {
  return await page.evaluate(
    async () => (await window.electron?.pty?.list()) ?? []
  );
}

async function waitForSessions(page, count) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const current = await sessions(page);
    if (current.length === count) return current;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${count} sessions`);
}

async function openProject(page, dir) {
  await page.evaluate(projectDir => {
    window.dispatchEvent(
      new CustomEvent('exawatt:open-project', { detail: projectDir })
    );
  }, dir);
  // empty projects render the inline composer; projects with restored tabs
  // render the collapsed summon button (D18)
  await page
    .locator('[data-agent-composer], [data-composer-toggle]')
    .first()
    .waitFor();
}

async function startAgent(page, engine) {
  await startAgentFromLauncher(page, { engine });
}

async function openShell(page) {
  await openShellFromLauncher(page);
}

async function waitForAgentIdentities(page, count) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const currentAgents = (await sessions(page)).filter(
      session => session.harness !== 'shell'
    );
    if (
      currentAgents.length === count &&
      currentAgents.every(session => Boolean(session.harnessSessionId))
    ) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${count} provider identities`);
}

async function waitForBuffer(page, id, text) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const buffer = await page.evaluate(
      async sessionId => window.electron?.pty?.buffer(sessionId),
      id
    );
    if (buffer?.includes(text)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for retained output in ${id}`);
}

function pids() {
  return readdirSync(pidDir)
    .filter(name => name.endsWith('.pid'))
    .map(name => Number(readFileSync(join(pidDir, name), 'utf8').trim()))
    .filter(Number.isFinite);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function requestQuit(app) {
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
}

function waitForClose(app) {
  return new Promise(resolve => app.once('close', resolve));
}

let app = null;
try {
  console.log('[eng-018] launch fixture');
  app = await launch('cancel,confirm');
  let page = await pageFor(app);
  console.log('[eng-018] workspace ready');
  await openProject(page, projectDir);
  for (let i = 0; i < 2; i++) {
    await startAgent(page, 'Claude Code');
    await waitForSessions(page, i + 1);
  }
  for (let i = 0; i < 2; i++) {
    await startAgent(page, 'Codex');
    await waitForSessions(page, i + 3);
  }
  await openShell(page);
  await waitForSessions(page, 5);
  await waitForAgentIdentities(page, 4);
  let original = await sessions(page);
  console.log('[eng-018] five sessions launched');

  for (const [index, session] of original.entries()) {
    const marker = `ENG018_HISTORY_${index + 1}`;
    await page.evaluate(
      async ({ id, text }) =>
        window.electron?.pty?.write(id, `printf '${text}\\n'\n`),
      { id: session.id, text: marker }
    );
    await waitForBuffer(page, session.id, marker);
  }
  original = await sessions(page);
  const agents = original.filter(session => session.harness !== 'shell');
  if (agents.some(session => !session.harnessSessionId)) {
    throw new Error(`Provider identity missing: ${JSON.stringify(agents)}`);
  }
  const shell = original.find(session => session.harness === 'shell');
  await page.evaluate(
    async ({ id, file }) =>
      window.electron?.pty?.write(id, `printf '%s' $$ > '${file}'\n`),
    { id: shell.id, file: join(pidDir, 'shell.pid') }
  );
  await page.waitForTimeout(500);

  await requestQuit(app);
  await page.waitForTimeout(500);
  console.log('[eng-018] cancel verified');
  if ((await sessions(page)).length !== 5 || pids().some(pid => !alive(pid))) {
    throw new Error('Cancel did not leave all five processes running');
  }

  const closed = waitForClose(app);
  await requestQuit(app);
  await closed;
  app = null;
  console.log('[eng-018] confirmed quit completed');

  const persisted = JSON.parse(
    readFileSync(join(userData, 'workspace.json'), 'utf8')
  );
  const tabs = persisted.projects.flatMap(project => project.tabs);
  // v7 (ENG-033 H2) is the layout that distinguishes a local Session tab from a
  // connected coworker. Every tab this eval starts is a Session, so the shape
  // it checks below is unchanged; only the version it must see moved.
  if (persisted.v !== 7 || tabs.length !== 5)
    throw new Error('Workspace v7 checkpoint missing');
  if (tabs.some(tab => tab.kind !== 'session'))
    throw new Error(
      `Every tab this eval starts is a local Session: ${JSON.stringify(tabs.map(t => t.kind))}`
    );
  if (
    tabs.some(
      tab => tab.lifecycle !== 'stopped-clean' || tab.sessionId !== null
    )
  ) {
    throw new Error(
      `Clean lifecycle checkpoint mismatch: ${JSON.stringify(tabs)}`
    );
  }
  const exactIds = tabs
    .filter(tab => tab.harness !== 'shell')
    .map(tab => tab.harnessSessionId);
  if (
    exactIds.length !== 4 ||
    exactIds.some(id => !id) ||
    new Set(exactIds).size !== 4
  ) {
    throw new Error(`Expected four exact provider IDs: ${exactIds.join(',')}`);
  }
  if (pids().some(alive))
    throw new Error('Confirmed quit left an agent or shell alive');
  const histories = readdirSync(join(userData, 'sessions')).filter(name =>
    name.endsWith('.json')
  );
  if (histories.length !== 5)
    throw new Error(`Expected five histories; got ${histories.length}`);
  const durableHistoryFiles = readdirSync(join(userData, 'sessions')).filter(
    name => name.endsWith('.json') || name.endsWith('.journal')
  );
  for (let i = 1; i <= 5; i++) {
    if (
      !durableHistoryFiles.some(name =>
        readFileSync(join(userData, 'sessions', name), 'utf8').includes(
          `ENG018_HISTORY_${i}`
        )
      )
    ) {
      throw new Error(`Retained history ${i} missing`);
    }
  }
  const savedShell = tabs.find(tab => tab.harness === 'shell');
  if (!savedShell) throw new Error('Saved shell Session missing');
  writeFileSync(
    join(userData, 'sessions', `${savedShell.durableSessionId}.json`),
    '{corrupt'
  );

  app = await launch();
  page = await pageFor(app);
  console.log('[eng-018] clean restore ready');
  if ((await sessions(page)).length !== 0)
    throw new Error('Relaunch spawned work silently');
  const ready = page.getByRole('region', { name: 'Saved Agent recovery' });
  await ready.waitFor();
  await page.getByText('Shell', { exact: true }).last().click();
  // A paused Session shows a RECORD, not a replayed terminal (BUG-013,
  // incident 0008), and an unreadable transcript SAYS so rather than swapping
  // in an empty pane. The pre-record pane's 'Retained history unavailable'
  // line has not existed in the product since; this eval was still waiting
  // 25s for it.
  const transcriptButton = page.locator('[data-show-transcript]');
  await transcriptButton.waitFor();
  await transcriptButton.click();
  await page
    .getByText('Saved history could not be read.', { exact: true })
    .waitFor();
  await page.screenshot({ path: join(screenshots, 'restored-1400x900.png') });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: join(screenshots, 'restored-800x600.png') });
  await page.getByRole('button', { name: 'Start New Shell' }).click();
  await waitForSessions(page, 1);
  await ready.getByRole('button', { name: /Resume 4 agents in /i }).click();
  await waitForSessions(page, 5);
  console.log('[eng-018] workspace Agent recovery completed');
  const resumed = await sessions(page);
  const resumedAgents = resumed.filter(session => session.harness !== 'shell');
  if (resumed.filter(session => session.harness === 'shell').length !== 1) {
    throw new Error(
      'The explicit shell action did not start exactly one shell'
    );
  }
  if (
    JSON.stringify(resumedAgents.map(item => item.harnessSessionId).sort()) !==
    JSON.stringify([...exactIds].sort())
  ) {
    throw new Error(
      `Workspace recovery identity mismatch: expected ${JSON.stringify(exactIds)}, got ${JSON.stringify(resumedAgents.map(item => item.harnessSessionId))}`
    );
  }
  const cleanClose = waitForClose(app);
  await requestQuit(app);
  await cleanClose;
  app = null;
  console.log('[eng-018] resumed sessions stopped cleanly');

  app = await launch('confirm');
  page = await pageFor(app);
  console.log('[eng-018] crash fixture ready');
  await openProject(page, projectDir);
  await openShell(page);
  const withCrashShell = await waitForSessions(page, 1);
  await page.evaluate(
    async id =>
      window.electron?.pty?.write(id, "printf 'ENG018_CRASH_HISTORY\\n'\n"),
    withCrashShell[0].id
  );
  await page.waitForTimeout(700);
  const crashed = waitForClose(app);
  app.process().kill('SIGKILL');
  await crashed;
  app = null;

  app = await launch();
  page = await pageFor(app);
  console.log('[eng-018] interrupted restore ready');
  await page.getByText('Interrupted', { exact: true }).last().waitFor();
  await page.screenshot({
    path: join(screenshots, 'interrupted-1400x900.png'),
  });
  await page.locator('[data-command-altitude-level="spatial"]').click();
  await page.waitForURL(/\/fleet\/spatial/);
  const finalClose = waitForClose(app);
  await requestQuit(app);
  await Promise.race([
    finalClose,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Non-workspace quit waited for a native modal')),
        2_500
      )
    ),
  ]);
  app = null;
  console.log('[eng-018] non-workspace quit completed without a native modal');

  console.log(
    'PASS session lifecycle: 2 Claude + 2 Codex + shell, cancel/quit/corrupt-history/restore/resume/crash/non-workspace-quit'
  );
  console.log(`[eng-018] screenshots: ${screenshots}`);
} finally {
  if (app) {
    const forced = waitForClose(app);
    app.process().kill('SIGKILL');
    await Promise.race([
      forced,
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ]);
  }
  if (!process.env.EXAWATT_KEEP_EVAL) {
    rmSync(root, { recursive: true, force: true });
  } else if (existsSync(root)) {
    console.log(`[eng-018] retained fixture: ${root}`);
  }
}
