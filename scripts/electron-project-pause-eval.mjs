#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';
import {
  createHarnessFixture,
  fixtureLaunch,
  openFixtureSession,
} from './lib/harness-event-fixture.mjs';

const fixture = createHarnessFixture('exawatt-project-pause');
const argsFile = join(fixture.root, 'launch-args.jsonl');
const cli = join(fixture.root, 'bin', 'claude');
writeFileSync(
  cli,
  readFileSync(cli, 'utf8').replace(
    'const settingsPath =',
    `fs.appendFileSync(${JSON.stringify(argsFile)}, JSON.stringify(argv) + '\\n');\nconst settingsPath =`
  )
);
try {
  await withElectronApp(fixtureLaunch(fixture), async (_app, page) => {
    const { claude, send, until, sessions } = await openFixtureSession(
      page,
      fixture
    );
    const storedTab = () =>
      JSON.parse(readFileSync(join(fixture.userData, 'workspace.json'), 'utf8'))
        .projects.flatMap(project => project.tabs)
        .find(tab => tab.durableSessionId === claude.durableSessionId);
    const before = await until(storedTab, 'persisted Session');
    const projectMenu = async action => {
      await page
        .locator('[data-ribbon-key^="project:"]')
        .first()
        .click({ button: 'right' });
      await page.getByRole('menuitem', { name: action, exact: true }).click();
    };
    await send('turn');
    await until(
      async () =>
        (await sessions()).find(s => s.id === claude.id)?.delegation
          ?.ownTurn === 'generating',
      'active turn'
    );
    await projectMenu('Pause Agents');
    const dialog = page.locator('[data-project-pause-confirm]');
    await dialog.waitFor();
    await page.screenshot({ path: '/tmp/exawatt-project-pause.png' });
    assert.equal(
      await dialog
        .getByRole('button', { name: /Cancel/ })
        .evaluate(el => el === document.activeElement),
      true
    );
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      (await sessions()).find(s => s.id === claude.id)?.exited,
      false
    );
    await projectMenu('Pause Agents');
    await dialog.waitFor();
    await page.keyboard.press('Tab');
    assert.equal(
      await dialog
        .getByRole('button', { name: 'Pause now', exact: true })
        .evaluate(el => el === document.activeElement),
      true
    );
    await page.keyboard.press('Enter');
    await until(
      async () => (await sessions()).find(s => s.id === claude.id)?.exited,
      'confirmed stop'
    );
    await page.locator(`[data-tab-id="${before.id}"]`).waitFor();
    await projectMenu('Resume Agents');
    const resumed = await until(
      async () =>
        (await sessions()).find(
          s =>
            !s.exited &&
            s.id !== claude.id &&
            s.durableSessionId === claude.durableSessionId
        ),
      'exact Session resume'
    );
    assert.equal(resumed.harnessSessionId, claude.harnessSessionId);
    await until(
      async () =>
        (
          await page.evaluate(id => window.electron.pty.buffer(id), resumed.id)
        ).includes('FAKE_CLAUDE_SUBSCRIBED'),
      'resumed harness'
    );
    await page.evaluate(
      id => window.electron.pty.write(id, 'stop\r'),
      resumed.id
    );
    await until(
      async () => !(await sessions()).find(s => s.id === resumed.id)?.working,
      'quiet boundary'
    );
    await projectMenu('Pause Agents');
    await until(
      async () => (await sessions()).find(s => s.id === resumed.id)?.exited,
      'quiet pause without confirmation'
    );
    assert.equal(await dialog.count(), 0);
    const after = await until(() => {
      const tab = storedTab();
      return tab?.sessionId === null ? tab : null;
    }, 'persisted stopped Session');
    assert.equal(after.id, before.id);
    assert.equal(after.initialTask, before.initialTask);
    assert.equal(after.harnessSessionId, claude.harnessSessionId);
    const launches = readFileSync(argsFile, 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(launches.length, 2);
    assert.equal(
      launches[1][launches[1].indexOf('--resume') + 1],
      claude.harnessSessionId
    );
    assert.equal(launches[1].includes('--continue'), false);
    console.log(
      'PASS Project pause: active cancellation and interruption; quiet direct pause; exact Session identity and retained tab/task on resume'
    );
  });
} finally {
  rmSync(fixture.root, { recursive: true, force: true });
}
