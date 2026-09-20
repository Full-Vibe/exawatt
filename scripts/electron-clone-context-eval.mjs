#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';
import {
  createHarnessFixture,
  fixtureLaunch,
  openFixtureSession,
} from './lib/harness-event-fixture.mjs';

const fixture = createHarnessFixture('exawatt-clone-context');
const argsFile = join(fixture.root, 'launch-args.jsonl');
const nativeRoot = join(fixture.root, 'claude-projects');
const cli = join(fixture.root, 'bin', 'claude');
writeFileSync(
  cli,
  readFileSync(cli, 'utf8').replace(
    'const settingsPath =',
    `fs.appendFileSync(${JSON.stringify(argsFile)}, JSON.stringify(argv) + '\\n');\nconst settingsPath =`
  )
);
try {
  await withElectronApp(
    fixtureLaunch(fixture, { EXAWATT_CLAUDE_PROJECTS_ROOT: nativeRoot }),
    async (_app, page) => {
      const { claude, until, sessions } = await openFixtureSession(
        page,
        fixture
      );
      await page.evaluate(
        id => window.electron.pty.write(id, 'turn\r', true),
        claude.id
      );
      const directory = join(
        nativeRoot,
        claude.cwd.replace(/[^a-zA-Z0-9_-]/g, '-')
      );
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, `${claude.harnessSessionId}.jsonl`),
        [
          {
            sessionId: claude.harnessSessionId,
            cwd: claude.cwd,
            message: {
              role: 'user',
              content: 'Current objective: ship the context handoff',
            },
          },
          {
            sessionId: claude.harnessSessionId,
            cwd: claude.cwd,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: 'Implementation complete; verification remains.',
                },
              ],
            },
          },
          {
            sessionId: 'unrelated-session',
            cwd: claude.cwd,
            message: {
              role: 'user',
              content: 'UNRELATED_CONTEXT_MUST_NOT_ESCAPE',
            },
          },
        ]
          .map(row => JSON.stringify(row))
          .join('\n')
      );
      const context = await page.evaluate(
        id => window.electron.pty.cloneContext(id),
        claude.durableSessionId
      );
      assert.equal(context.provenance, 'source-conversation');
      assert.ok(context.text.includes('Current objective'));
      assert.ok(!context.text.includes('UNRELATED_CONTEXT'));
      await page
        .locator('[data-tab-harness="claude"]')
        .first()
        .click({ button: 'right' });
      await until(async () => {
        if (
          await page
            .getByRole('menuitem', { name: 'Clone to…', exact: true })
            .count()
        )
          return true;
        await page.keyboard.press('Escape');
        await page
          .locator('[data-tab-harness="claude"]')
          .first()
          .click({ button: 'right' });
        return false;
      }, 'Clone targets ready');
      await page
        .getByRole('menuitem', { name: 'Clone to…', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: /^Clone to .*Claude/ })
        .first()
        .click();
      const clone = await until(
        async () =>
          (await sessions()).find(
            row => row.id !== claude.id && row.harness === 'claude'
          ),
        'new cloned Agent'
      );
      assert.notEqual(clone.durableSessionId, claude.durableSessionId);
      assert.notEqual(clone.harnessSessionId, claude.harnessSessionId);
      assert.equal(
        (await sessions()).find(row => row.id === claude.id)?.exited,
        false
      );
      await until(
        async () =>
          readFileSync(argsFile, 'utf8').trim().split('\n').length === 2,
        'clone launch'
      );
      const argv = JSON.parse(
        readFileSync(argsFile, 'utf8').trim().split('\n')[1]
      );
      assert.ok(!argv.includes('--resume'));
      assert.ok(
        argv.some(arg =>
          arg.includes('Current objective: ship the context handoff')
        )
      );
      assert.ok(argv.some(arg => arg.includes('verification remains')));
      assert.ok(!argv.some(arg => arg.includes('UNRELATED_CONTEXT')));
      console.log(
        'PASS: one target gesture launches a distinct Agent with current owned context; original remains running.'
      );
    }
  );
} finally {
  rmSync(fixture.root, { recursive: true, force: true });
}
