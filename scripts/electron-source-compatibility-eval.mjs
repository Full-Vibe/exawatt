#!/usr/bin/env node
// BUG-273: real saved-source recovery across Agent, Team, Fleet and close/reopen.
// Isolated local profile and fixture source; never points at the operator's data.
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  seedWorkspaceLayout,
  waitForWorkspaceReady,
  waitForPageCondition,
  withElectronApp,
} from './lib/electron-eval.mjs';
import { writeFakeHarness } from './lib/harness-probe-fixture.mjs';
const root = mkdtempSync(join(tmpdir(), 'exawatt-source-compatibility-'));
const profile = join(root, 'profile'),
  project = join(root, 'project'),
  fakeBin = join(root, 'bin'),
  fakeHome = join(root, 'home');
const output = '/tmp/exawatt-source-compatibility-proof';
for (const p of [
  profile,
  project,
  fakeBin,
  fakeHome,
  output,
  join(profile, 'sessions'),
])
  mkdirSync(p, { recursive: true });
writeFileSync(join(project, 'package.json'), '{}');
writeFakeHarness(fakeBin, 'claude', {
  launch:
    "printf 'EXACT_RESUME:'; printf '<%s>' \"$@\"; printf '\\n'; while IFS= read -r line; do printf '%s\\n' \"$line\"; done",
});
const record = (id, harness) => ({
  kind: 'session',
  id,
  durableSessionId: `durable-${id}`,
  harness,
  title: `Purpose ${id}`,
  cwd: project,
  sessionId: null,
  harnessSessionId: 'b10aed7b-6d91-4fe4-94f9-338c1b342357',
  lifecycle: 'stopped-clean',
  initialTask: `Keep ${id} task`,
  vendorContext: { thread: 'opaque' },
});
seedWorkspaceLayout(profile, {
  v: 5,
  activeDir: project,
  lastUsedDir: project,
  projects: [
    {
      dir: project,
      name: 'Compatibility',
      activeTabId: 'unsupported',
      tabs: [
        record('unsupported', 'future-source'),
        record('known', 'claude'),
        {
          ...record('draft', 'claude'),
          lifecycle: 'draft',
          draftSource: 'retired-source',
          draftTask: 'Unfinished original source task',
          draftTouched: false,
        },
      ],
    },
  ],
});
writeFileSync(
  join(profile, 'sessions', 'durable-unsupported.json'),
  JSON.stringify({
    v: 1,
    text: 'Retained original source transcript\r\n',
    cursor: 37,
    updatedAt: Date.now(),
  })
);
const launch = {
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBin}:${process.env.PATH}`,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_TEST_HARNESS_BIN: fakeBin,
    EXAWATT_USER_DATA: profile,
    EXAWATT_TEST_QUIT_RESPONSES: 'confirm',
    EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7011'}/workspace`,
  },
};
try {
  await withElectronApp(
    launch,
    async (app, page) => {
      page.setDefaultTimeout(25000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewportSize({ width: 1200, height: 850 });
      await waitForWorkspaceReady(page);
      const panel = page.locator('[data-session-restore="unsupported"]');
      await panel.waitFor();
      assert.match(await panel.innerText(), /future-source/);
      assert.equal(await panel.getByRole('button').count(), 0);
      await page.getByText('Keep unsupported task', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Show transcript' }).click();
      await page
        .getByText('Retained original source transcript', { exact: true })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.electron.pty.list())).length,
        0
      );
      await page.screenshot({ path: join(output, 'unsupported-agent.png') });
      console.log(
        'PASS unknown legacy source renders purpose/history without a runtime verb'
      );
      await page.keyboard.press('Meta+KeyW');
      await waitForPageCondition(
        page,
        async () =>
          (await window.electron.pty.closedSessions()).some(
            x => x.durableSessionId === 'durable-unsupported'
          ),
        undefined,
        { label: 'unsupported close archived' }
      );
      await page.keyboard.press('Meta+Shift+KeyT');
      await page
        .locator('[data-session-durable="durable-unsupported"]')
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.electron.pty.list())).length,
        0
      );
      const reopenedId = await page
        .locator('[data-session-durable="durable-unsupported"]')
        .getAttribute('data-session-restore');
      console.log(
        'PASS close/reopen restores unsupported saved view without a process'
      );
      await page.locator('[data-tab-id="draft"]').click();
      await page.locator('[data-session-restore="draft"]').waitFor();
      await page
        .getByText('Unfinished original source task', { exact: true })
        .waitFor();
      assert.equal(
        await page.locator('[data-agent-composer]:visible').count(),
        0
      );
      await page.screenshot({ path: join(output, 'unsupported-draft.png') });
      console.log(
        'PASS unsupported draft remains saved work without substitute composer'
      );
      await page.keyboard.press('Control+Meta+2');
      await page.locator('[data-expose]').waitFor();
      assert.equal(
        await page.locator(`[data-expose-tab="${reopenedId}"]`).count(),
        1
      );
      assert.equal(
        await page.locator(`[data-expose-resume="${reopenedId}"]`).count(),
        0
      );
      await page.screenshot({ path: join(output, 'unsupported-team.png') });
      console.log('PASS Team retains unsupported row without resume');
      await page.keyboard.press('Control+Meta+3');
      await page.waitForURL(url => url.pathname.endsWith('/fleet/spatial'));
      await waitForPageCondition(
        page,
        () =>
          document
            .querySelector('[data-agent-count]')
            ?.getAttribute('data-agent-count') === '3',
        undefined,
        { label: 'all three retained Fleet Sessions' }
      );
      await page.screenshot({ path: join(output, 'unsupported-fleet.png') });
      console.log(
        'PASS Fleet retains all three saved Sessions including both unsupported source choices'
      );
      await page.keyboard.press('Control+Meta+1');
      await page.locator('[data-tab-id="known"]').click();
      await page
        .locator('[data-session-restore="known"]')
        .getByRole('button', { name: /Resume/ })
        .click();
      await waitForPageCondition(
        page,
        async () => {
          const rows = await window.electron.pty.list();
          return rows.some(
            x => x.durableSessionId === 'durable-known' && !x.exited
          );
        },
        undefined,
        { label: 'known exact resume' }
      );
      const runtime = await page.evaluate(async () => {
        const rows = await window.electron.pty.list();
        return rows.find(x => x.durableSessionId === 'durable-known');
      });
      assert.equal(runtime.harness, 'claude');
      await waitForPageCondition(
        page,
        async id =>
          (await window.electron.pty.buffer(id)).includes(
            'b10aed7b-6d91-4fe4-94f9-338c1b342357'
          ),
        runtime.id,
        { label: 'exact provider invocation' }
      );
      console.log('PASS known source resumes exact saved provider identity');
      await page.evaluate(() =>
        window.dispatchEvent(new Event('beforeunload'))
      );
      await waitForPageCondition(
        page,
        async () => {
          const d = await window.electron.workspace.load();
          return (
            d.v === 7 &&
            d.projects[0].tabs.some(t => t.draftSource === 'retired-source')
          );
        },
        undefined,
        { label: 'normalized workspace saved' }
      );
      const disk = JSON.parse(
        readFileSync(join(profile, 'workspace.json'), 'utf8')
      );
      const unknown = disk.projects[0].tabs.find(
        t => t.durableSessionId === 'durable-unsupported'
      );
      assert.equal(unknown.harness, 'future-source');
      assert.deepEqual(unknown.vendorContext, { thread: 'opaque' });
      assert.equal(
        disk.projects[0].tabs.find(t => t.id === 'draft').draftSource,
        'retired-source'
      );
      assert.deepEqual(errors, []);
      console.log(
        'PASS normalized save preserves raw identity, opaque JSON and draft choice; no renderer errors'
      );
    },
    { maxMs: 150000, attempts: 1 }
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
