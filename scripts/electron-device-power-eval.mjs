#!/usr/bin/env node

// Real main/preload/settings/PTY/native assertions. Only the harness and
// powerMonitor events are fixtures; this never locks or sleeps the host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { waitForPageCondition, withElectronApp } from './lib/electron-eval.mjs';
import {
  createHarnessFixture,
  fixtureLaunch,
} from './lib/harness-event-fixture.mjs';
import { FIXTURE_CODEX_VERSION } from './lib/harness-probe-fixture.mjs';

const fixture = createHarnessFixture('exawatt-device-power', {
  codexProtocol: true,
});
const cli = join(fixture.fakeBin, 'codex');
const original = readFileSync(cli, 'utf8');
function installFixture(protocol = true) {
  writeFileSync(
    cli,
    original
      .replace(FIXTURE_CODEX_VERSION, 'codex-cli 0.156.1')
      .replace(
        'const protocolEnabled = true;',
        `if (cargv.includes('features')) {
  process.stdout.write('prevent_idle_sleep experimental false\\n');
  process.exit(0);
}
const protocolEnabled = ${JSON.stringify(protocol)};`
      )
      .replace(
        "if (line.startsWith('say '))",
        "if (line === 'bell') process.stdout.write('\\x07');\n    else if (line.startsWith('say '))"
      )
  );
}

async function bridgeReady(page) {
  await page.waitForURL(
    url =>
      url.origin ===
      new URL(process.env.EXA_BASE ?? 'http://localhost:7000').origin,
    { timeout: 90_000 }
  );
  await page.waitForFunction(() => Boolean(window.electron?.app?.devicePower));
}

try {
  installFixture();
  await withElectronApp(fixtureLaunch(fixture), async (app, page) => {
    await bridgeReady(page);
    const power = () => page.evaluate(() => window.electron.app.devicePower());
    const waitPower = async expected => {
      await waitForPageCondition(
        page,
        async values => {
          const status = await window.electron.app.devicePower();
          return Object.entries(values).every(
            ([key, value]) => status[key] === value
          );
        },
        expected
      );
      return power();
    };
    const event = name =>
      app.evaluate(({ powerMonitor }, value) => powerMonitor.emit(value), name);
    const policy = value =>
      page.evaluate(next => window.electron.settings.setKeepAwake(next), value);
    const launch = async harness => {
      const result = await page.evaluate(
        options => window.electron.pty.create(options),
        { harness, cwd: fixture.project }
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.session;
    };
    const send = (id, data) =>
      page.evaluate(
        value => window.electron.pty.write(value.id, `${value.data}\r`),
        { id, data }
      );
    const waitSession = async (id, expected) => {
      await waitForPageCondition(
        page,
        async ({ id, expected }) => {
          const row = (await window.electron.pty.list()).find(
            item => item.id === id
          );
          return (
            row &&
            Object.entries(expected).every(([key, value]) => row[key] === value)
          );
        },
        { id, expected }
      );
    };
    assert.equal((await power()).policy, 'ac-only');
    await event('on-ac');
    await waitPower({ assertion: 'inactive', supportedWorkingSessions: 0 });

    // pmset proves the real macOS assertion, scoped to this isolated app's
    // PID. Electron exposes wrapper objects, so monkey-patching the inspector's
    // powerSaveBlocker would not observe the controller's native reference.
    const pid = app.process().pid;
    const native = () =>
      execFileSync('/usr/bin/pmset', ['-g', 'assertions'], {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(
          line =>
            line.includes(`pid ${pid}(`) &&
            /\b(?:PreventUserIdleSystemSleep|NoIdleSleepAssertion)\b/.test(line)
        )
        .map(line => line.match(/\[([^\]]+)\]/)?.[1]);
    const assertNative = async count => {
      const deadline = Date.now() + 10_000;
      let evidence;
      do {
        evidence = native();
        if (evidence.length === count) return evidence;
        await page.waitForTimeout(50);
      } while (Date.now() < deadline);
      assert.equal(evidence.length, count, JSON.stringify(evidence));
      return evidence;
    };
    const codex = await launch('codex');
    assert.equal(codex.powerControl?.state, 'applied-at-launch');
    await waitForPageCondition(
      page,
      async id => {
        const row = (await window.electron.pty.list()).find(
          item => item.id === id
        );
        return row?.delegation?.children.length === 2;
      },
      codex.id
    );
    await waitPower({ assertion: 'active', supportedWorkingSessions: 1 });
    const held = await assertNative(1);

    await event('lock-screen');
    await waitPower({ assertion: 'active', supportedWorkingSessions: 1 });
    assert.deepEqual(
      await assertNative(1),
      held,
      'lock must retain the same assertion'
    );
    await waitSession(codex.id, { exited: false });
    await event('on-battery');
    await waitPower({
      assertion: 'inactive',
      powerSource: 'battery',
      supportedWorkingSessions: 1,
    });
    await assertNative(0);
    await waitSession(codex.id, { exited: false });
    await policy('ac-and-battery');
    await waitPower({ assertion: 'active', policy: 'ac-and-battery' });
    await assertNative(1);
    // Electron aggregates its IDs into one OS assertion. Hold an independent
    // native ID while Never releases the controller's ID, then release only
    // the independent ID and prove no policy-owned assertion remains.
    await app.evaluate(({ powerSaveBlocker }) => {
      globalThis.__powerEvalIndependent = powerSaveBlocker.start(
        'prevent-app-suspension'
      );
    });
    await policy('never');
    await waitPower({ assertion: 'inactive', policy: 'never' });
    assert.equal(
      await app.evaluate(({ powerSaveBlocker }) =>
        powerSaveBlocker.isStarted(globalThis.__powerEvalIndependent)
      ),
      true,
      'Never must preserve an independently owned assertion'
    );
    await assertNative(1);
    await app.evaluate(({ powerSaveBlocker }) => {
      powerSaveBlocker.stop(globalThis.__powerEvalIndependent);
    });
    await assertNative(0);
    await event('on-ac');
    await waitPower({ assertion: 'inactive', powerSource: 'ac' });
    await policy('ac-only');
    await waitPower({ assertion: 'active' });
    await assertNative(1);
    await event('suspend');
    await waitPower({ assertion: 'inactive' });
    await assertNative(0);
    await event('resume');
    await event('on-ac');
    await event('unlock-screen');
    await waitPower({ assertion: 'active' });
    await assertNative(1);
    console.log(
      'PASS device power: default AC, lock continuity, unplug release, battery opt-in, Never, suspend/resume; real owned native assertion only'
    );

    for (const child of fixture.codex.childIds)
      await send(codex.id, `finish ${child}`);
    await waitForPageCondition(
      page,
      async id => {
        const row = (await window.electron.pty.list()).find(
          item => item.id === id
        );
        // A source with nothing live reports `delegation: null`, never an
        // empty list (`PtySessionRecord`), so either reads as cleared.
        return row && (row.delegation?.children.length ?? 0) === 0;
      },
      codex.id
    );
    await waitPower({ assertion: 'inactive', supportedWorkingSessions: 0 });
    await assertNative(0);
    // BEL is the real PTY operator-attention boundary for a source without a
    // more specific question event; no private monitor state is injected.
    await page.evaluate(() => window.electron.pty.focus(null));
    await send(codex.id, 'bell');
    await waitForPageCondition(
      page,
      async id => {
        const row = (await window.electron.pty.list()).find(
          item => item.id === id
        );
        return row?.attention?.kind === 'bell';
      },
      codex.id
    );
    await waitPower({ assertion: 'inactive', supportedWorkingSessions: 0 });
    await assertNative(0);
    await page.evaluate(id => window.electron.pty.kill(id), codex.id);
    // `pty.kill` stops the process and forgets its record, so the row leaves
    // the list rather than reading `exited`.
    await waitForPageCondition(
      page,
      async id =>
        !(await window.electron.pty.list()).some(
          item => item.id === id && !item.exited
        ),
      codex.id,
      { label: 'the killed Agent to leave the live list' }
    );
    await assertNative(0);

    installFixture(false);
    const idle = await launch('codex');
    assert.equal(idle.powerControl?.state, 'applied-at-launch');
    await waitSession(idle.id, {
      working: false,
      engaged: false,
      exited: false,
    });
    await waitPower({ assertion: 'inactive', supportedWorkingSessions: 0 });
    const shell = await launch('shell');
    await send(shell.id, 'printf shell-output');
    await waitPower({ assertion: 'inactive', supportedWorkingSessions: 0 });
    await assertNative(0);
    await page.evaluate(
      async ids => {
        for (const id of ids) await window.electron.pty.kill(id);
      },
      [idle.id, shell.id]
    );
    console.log(
      'PASS device power: completed delegation, operator gate, exited Agent, idle supported Agent, and shell do not hold an assertion'
    );

    await policy('ac-and-battery');
    const disk = JSON.parse(
      readFileSync(join(fixture.userData, 'settings.json'), 'utf8')
    );
    assert.equal(disk.power.keepAwake, 'ac-and-battery');
    // A renderer reload must subscribe/read the same main-owned truth.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await bridgeReady(page);
    await waitPower({ policy: 'ac-and-battery', assertion: 'inactive' });
  });

  await withElectronApp(fixtureLaunch(fixture), async (_app, page) => {
    await bridgeReady(page);
    const status = await page.evaluate(() => window.electron.app.devicePower());
    assert.equal(status.policy, 'ac-and-battery');
    assert.equal(status.assertion, 'inactive');
    assert.equal(status.supportedWorkingSessions, 0);
    await page.goto(
      `${process.env.EXA_BASE ?? 'http://localhost:7000'}/settings`,
      { waitUntil: 'domcontentloaded' }
    );
    await page
      .getByRole('button', { name: 'Preferences', exact: true })
      .click();
    const group = page.locator('[data-power-settings]');
    await group.waitFor();
    const control = group.getByRole('combobox');
    await control.click();
    await page.getByRole('option', { name: 'Never', exact: true }).click();
    await waitForPageCondition(
      page,
      async () => (await window.electron.app.devicePower()).policy === 'never'
    );
    await group.screenshot({ path: '/tmp/exawatt-device-power-settings.png' });
    assert.equal(
      JSON.parse(readFileSync(join(fixture.userData, 'settings.json'), 'utf8'))
        .power.keepAwake,
      'never'
    );
    console.log(
      'PASS device power: Preferences control writes the persisted policy through the real bridge'
    );
    console.log(
      'PASS device power: setting persists on disk, renderer reload, and a fresh Electron process; no idle assertion'
    );
  });
} finally {
  rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3 });
}
