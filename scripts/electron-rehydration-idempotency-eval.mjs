#!/usr/bin/env node
/**
 * Rehydration idempotency eval (ENG-018 addendum, ENG-016 D18).
 *
 * The ENG-018 evals prove ONE quit → relaunch → resume pass. Dogfood asked
 * for the stronger property: freeze/reinflate must be REPEATABLE — quit,
 * reopen, resume, quit again, N times — without identity drift, tab
 * duplication, lifecycle corruption, or history loss.
 *
 * Each generation asserts:
 *   - confirmed quit leaves no orphan harness process
 *   - workspace.json stays v6 with the SAME tab set (same durable Session
 *     ids, exact provider ids, title ownership, no duplicates or strays)
 *   - relaunch spawns nothing; the resume banner counts only agents
 *   - workspace recovery resumes the exact same conversations as generation 0
 *   - a per-generation history marker written after resume is retained
 *     across the NEXT quit (journal/compaction stability over generations)
 *   - the stopped shell tab persists as a tab but is never auto-resumed
 *
 * Requires a packaged app (release/mac-arm64) like the other ENG-018 evals.
 */
import { _electron as electron } from 'playwright-core';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openShellFromLauncher } from './lib/electron-eval.mjs';

const GENERATIONS = Number(process.env.EXAWATT_IDEMPOTENCY_GENERATIONS || 3);

const executable = resolve(
  process.env.EXAWATT_APP_PATH ??
    'release/mac-arm64/Exawatt.app/Contents/MacOS/Exawatt'
);
const root = mkdtempSync(join(tmpdir(), 'exawatt-idem-'));
const userData = join(root, 'userData');
const fakeHome = join(root, 'home');
const fakeBin = join(root, 'bin');
const pidDir = join(root, 'pids');
const projectDir = join(root, 'project');
for (const dir of [userData, fakeHome, fakeBin, pidDir, projectDir]) {
  mkdirSync(dir, { recursive: true });
}

const fakeClaude = join(fakeBin, 'claude');
writeFileSync(
  fakeClaude,
  `#!/bin/sh
if [ "$1" = "-p" ]; then printf 'fixture context'; exit 0; fi
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
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then exit 0; fi
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

function launch() {
  return electron.launch({
    executablePath: executable,
    timeout: 45_000,
    env: {
      ...process.env,
      HOME: fakeHome,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: userData,
      EXAWATT_TEST_PID_DIR: pidDir,
      EXAWATT_TEST_HARNESS_BIN: fakeBin,
      EXAWATT_TEST_QUIT_RESPONSES: 'confirm',
    },
  });
}

async function pageFor(app) {
  const page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(25_000);
  await page.locator('[data-command-altitude]').waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Loading…'),
    undefined,
    { timeout: 25_000 }
  );
  if (!new URL(page.url()).pathname.startsWith('/workspace')) {
    await page.locator('[data-command-altitude-level="terminal"]').click();
    await page.waitForURL('**/workspace*');
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading…'),
      undefined,
      { timeout: 25_000 }
    );
  }
  return page;
}

const sessions = page =>
  page.evaluate(async () => (await window.electron?.pty?.list()) ?? []);

async function waitFor(page, predicate, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await page.waitForTimeout(120);
  }
  throw new Error(`Timed out: ${label}`);
}

async function summonComposer(page) {
  if ((await page.locator('[data-agent-composer]').count()) > 0) return;
  const toggle = page.locator('[data-composer-toggle][aria-expanded="false"]');
  if ((await toggle.count()) > 0) await toggle.click();
  else await page.getByRole('button', { name: 'New Agent' }).click();
  await page.locator('[data-agent-composer]').waitFor();
}

async function startAgent(page, source, task = '') {
  await summonComposer(page);
  await page.getByLabel('Agent Source').click();
  await page.getByRole('option', { name: source }).click();
  if (task) await page.getByLabel('Initial task for the new Agent').fill(task);
  await page.getByRole('button', { name: 'Start' }).click();
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

function readWorkspace() {
  return JSON.parse(readFileSync(join(userData, 'workspace.json'), 'utf8'));
}

function tabFingerprint(workspace) {
  return workspace.projects.flatMap(project =>
    project.tabs.map(tab => ({
      durableSessionId: tab.durableSessionId,
      harness: tab.harness,
      harnessSessionId: tab.harnessSessionId,
      title: tab.title,
      titleKind: tab.titleKind,
    }))
  );
}

async function quitAndWaitClosed(app, page) {
  const closed = new Promise(resolveClose => app.once('close', resolveClose));
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  // the shutdown coordinator shows the native confirm (auto-answered by
  // EXAWATT_TEST_QUIT_RESPONSES), checkpoints, stops processes, commits
  await closed;
  void page;
  const survivors = pids().filter(alive);
  if (survivors.length > 0) {
    throw new Error(`Orphan harness processes after quit: ${survivors}`);
  }
}

let app = null;
try {
  console.log(`[idem] generation 0: build the fixture workspace`);
  app = await launch();
  let page = await pageFor(app);
  await page.getByRole('button', { name: 'Open Project' }).first().waitFor();
  await page.evaluate(dir => {
    window.dispatchEvent(
      new CustomEvent('exawatt:open-project', { detail: dir })
    );
  }, projectDir);
  await page
    .locator(
      '[data-agent-composer], [data-composer-toggle], button:has-text("New Agent")'
    )
    .first()
    .waitFor();

  await startAgent(page, 'Claude Code');
  await waitFor(
    page,
    async () => (await sessions(page)).length === 1,
    'first agent'
  );
  await startAgent(page, 'Claude Code');
  await waitFor(
    page,
    async () => (await sessions(page)).length === 2,
    'second agent'
  );
  await startAgent(
    page,
    'Codex',
    'Verify launch-time identity survives repeated relaunches'
  );
  await waitFor(
    page,
    async () => (await sessions(page)).length === 3,
    'third agent'
  );
  await summonComposer(page);
  await openShellFromLauncher(page);
  await waitFor(page, async () => (await sessions(page)).length === 4, 'shell');

  // The Codex task was submitted through the composer/CLI argument. Identity
  // must exist before any later terminal write; this is the production path
  // that used to persist a convincing history pane with no resumable identity.
  try {
    await waitFor(
      page,
      async () =>
        (await sessions(page))
          .filter(session => session.harness !== 'shell')
          .every(session => Boolean(session.harnessSessionId)),
      'launch-time provider identities'
    );
  } catch (error) {
    console.error(
      '[idem] identity capture debug',
      JSON.stringify(
        {
          sessions: await sessions(page),
          candidates: await page.evaluate(
            async cwd =>
              window.electron?.pty?.listResumeCandidates('codex', cwd),
            projectDir
          ),
        },
        null,
        2
      )
    );
    throw error;
  }

  const initial = await sessions(page);
  for (const [index, session] of initial.entries()) {
    const marker = `IDEM_G0_${index + 1}`;
    await page.evaluate(
      async ({ id, text }) =>
        window.electron?.pty?.write(id, `printf '${text}\\n'\n`),
      { id: session.id, text: marker }
    );
    await waitFor(
      page,
      async () =>
        (
          await page.evaluate(
            async id => window.electron?.pty?.buffer(id),
            session.id
          )
        )?.includes(marker),
      `marker ${marker}`
    );
  }
  await page.waitForTimeout(700);

  const baselineAgents = (await sessions(page))
    .filter(session => session.harness !== 'shell')
    .map(session => session.harnessSessionId)
    .sort();
  if (baselineAgents.length !== 3 || new Set(baselineAgents).size !== 3) {
    throw new Error(`Expected 3 distinct agent ids: ${baselineAgents}`);
  }

  await quitAndWaitClosed(app, page);
  app = null;
  const baselineWorkspace = readWorkspace();
  if (baselineWorkspace.v !== 6) {
    throw new Error(`Workspace is not v6: ${baselineWorkspace.v}`);
  }
  const baselineTabs = tabFingerprint(baselineWorkspace);
  if (baselineTabs.length !== 4) {
    throw new Error(
      `Expected 4 persisted tabs: ${JSON.stringify(baselineTabs)}`
    );
  }
  console.log('[idem] baseline persisted:', JSON.stringify(baselineTabs));

  for (let generation = 1; generation <= GENERATIONS; generation++) {
    console.log(`[idem] generation ${generation}: relaunch`);
    app = await launch();
    page = await pageFor(app);

    const spawned = await sessions(page);
    if (spawned.length !== 0) {
      throw new Error(
        `g${generation}: relaunch spawned ${spawned.length} sessions`
      );
    }
    const banner = page.getByRole('region', { name: 'Saved Agent recovery' });
    await banner.waitFor();
    await banner.getByRole('button', { name: /Resume 3 agents in /i }).click();
    await waitFor(
      page,
      async () => (await sessions(page)).length === 3,
      `g${generation} resume`
    );

    const resumed = await sessions(page);
    const resumedIds = resumed.map(session => session.harnessSessionId).sort();
    if (JSON.stringify(resumedIds) !== JSON.stringify(baselineAgents)) {
      throw new Error(
        `g${generation}: resumed ids drifted: ${resumedIds} != ${baselineAgents}`
      );
    }
    if (resumed.some(session => session.harness === 'shell')) {
      throw new Error(`g${generation}: workspace recovery started a shell`);
    }

    // prior generations' history must have survived the round trip, and this
    // generation adds its own marker to the first agent
    const target = resumed[0];
    const buffer = await page.evaluate(
      async id => window.electron?.pty?.buffer(id),
      target.id
    );
    if (!buffer?.includes('resuming exact')) {
      throw new Error(`g${generation}: no exact-resume marker in buffer`);
    }
    const marker = `IDEM_G${generation}`;
    await page.evaluate(
      async ({ id, text }) =>
        window.electron?.pty?.write(id, `printf '${text}\\n'\n`),
      { id: target.id, text: marker }
    );
    await waitFor(
      page,
      async () =>
        (
          await page.evaluate(
            async id => window.electron?.pty?.buffer(id),
            target.id
          )
        )?.includes(marker),
      `g${generation} marker`
    );
    await page.waitForTimeout(600);

    await quitAndWaitClosed(app, page);
    app = null;

    const workspace = readWorkspace();
    if (workspace.v !== 6) {
      throw new Error(`g${generation}: workspace version drifted`);
    }
    const tabs = tabFingerprint(workspace);
    const key = tab =>
      `${tab.durableSessionId}:${tab.harness}:${tab.harnessSessionId}:${tab.titleKind}:${tab.title}`;
    const baselineKeys = baselineTabs.map(key).sort();
    const currentKeys = tabs.map(key).sort();
    if (JSON.stringify(currentKeys) !== JSON.stringify(baselineKeys)) {
      throw new Error(
        `g${generation}: tab set drifted\n  was: ${baselineKeys}\n  now: ${currentKeys}`
      );
    }
    const lifecycles = workspace.projects.flatMap(project =>
      project.tabs.map(tab => tab.lifecycle)
    );
    if (lifecycles.some(state => state !== 'stopped-clean')) {
      throw new Error(
        `g${generation}: unexpected lifecycle after clean quit: ${lifecycles}`
      );
    }
    console.log(
      `[idem] generation ${generation}: identical tab set, clean stop`
    );
  }

  // final relaunch: cumulative history markers from every generation are
  // retained for the first agent's durable Session
  app = await launch();
  page = await pageFor(app);
  const finalWorkspace = readWorkspace();
  const firstAgentTab = finalWorkspace.projects
    .flatMap(project => project.tabs)
    .find(tab => tab.harness !== 'shell');
  const retained = await page.evaluate(
    async durableId =>
      (await window.electron?.pty?.retainedHistory(durableId))?.text ?? '',
    firstAgentTab.durableSessionId
  );
  for (let generation = 1; generation <= GENERATIONS; generation++) {
    if (!retained.includes(`IDEM_G${generation}`)) {
      throw new Error(
        `Retained history lost generation ${generation}'s marker`
      );
    }
  }
  await quitAndWaitClosed(app, page);
  app = null;

  console.log(`\nREHYDRATION IDEMPOTENCY PASSED (${GENERATIONS} generations)`);
} finally {
  if (app) {
    try {
      const pid = app.process().pid;
      await Promise.race([
        app.close().catch(() => {}),
        new Promise(resolveClose => setTimeout(resolveClose, 8000)),
      ]);
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* torn down */
    }
  }
  rmSync(root, { recursive: true, force: true });
}
