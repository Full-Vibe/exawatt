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
import { FIXTURE_CLAUDE_MODEL_ID } from './lib/harness-probe-fixture.mjs';

const fixture = createHarnessFixture('exawatt-model-change');
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
    const change = choice =>
      page.evaluate(
        async ({ id, choice }) => window.electron.pty.changeModel(id, choice),
        { id: claude.id, choice }
      );
    const invalid = await change({ model: 'not-in-the-source-catalog' });
    assert.equal(invalid.ok, false);
    assert.equal(
      (await sessions()).find(s => s.id === claude.id)?.exited,
      false
    );
    await send('turn');
    await until(
      async () =>
        (await sessions()).find(s => s.id === claude.id)?.delegation
          ?.ownTurn === 'generating',
      'reported turn'
    );
    const busy = await change({ model: FIXTURE_CLAUDE_MODEL_ID });
    assert.equal(busy.ok, false);
    await send('stop');
    await until(
      async () => !(await sessions()).find(s => s.id === claude.id)?.working,
      'idle boundary'
    );
    await page.getByRole('button', { name: /^Session model:/ }).click();
    await page
      .getByRole('option', { name: 'Fixture Claude Sol · High', exact: true })
      .click();
    await page.screenshot({ path: '/tmp/exawatt-session-model.png' });
    await page
      .getByRole('button', { name: 'Apply and resume', exact: true })
      .click();
    const replacement = await until(
      async () =>
        (await sessions()).find(
          s =>
            !s.exited &&
            s.id !== claude.id &&
            s.durableSessionId === claude.durableSessionId
        ),
      'replacement from the Model control'
    );
    assert.equal(replacement.harnessSessionId, claude.harnessSessionId);
    assert.equal(replacement.launchModel, FIXTURE_CLAUDE_MODEL_ID);
    await until(
      async () =>
        readFileSync(argsFile, 'utf8').trim().split('\n').length === 2,
      'replacement launch'
    );
    const [before, after] = readFileSync(argsFile, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.equal(after[after.indexOf('--resume') + 1], claude.harnessSessionId);
    assert.equal(after[after.indexOf('--model') + 1], FIXTURE_CLAUDE_MODEL_ID);
    assert.equal(after[after.indexOf('--effort') + 1], 'high');
    assert.equal(
      after.includes('--dangerously-skip-permissions'),
      before.includes('--dangerously-skip-permissions')
    );
    const live = (await sessions()).filter(
      s => !s.exited && s.durableSessionId === claude.durableSessionId
    );
    assert.equal(live.length, 1);
    const saved = await until(async () => {
      const workspace = JSON.parse(
        readFileSync(join(fixture.userData, 'workspace.json'), 'utf8')
      );
      const tabs = workspace.projects
        .flatMap(project => project.tabs)
        .filter(tab => tab.durableSessionId === claude.durableSessionId);
      return tabs.length === 1 &&
        tabs[0].launchModel === FIXTURE_CLAUDE_MODEL_ID &&
        tabs[0].launchEffort === 'high'
        ? tabs[0]
        : null;
    }, 'one persisted Session with the applied choice');
    await page.reload();
    await page.locator(`[data-tab-id="${saved.id}"]`).waitFor();
    await until(
      async () =>
        (await sessions()).filter(
          s => !s.exited && s.durableSessionId === claude.durableSessionId
        ).length === 1,
      'one live process after renderer reload'
    );
    await page
      .getByRole('button', {
        name: new RegExp(`^Session model: ${FIXTURE_CLAUDE_MODEL_ID}`),
      })
      .waitFor();
    console.log(
      'PASS model change: busy/invalid choices preserve process; exact identity, launch flags, permission policy and single replacement proven'
    );
  });
} finally {
  rmSync(fixture.root, { recursive: true, force: true });
}
