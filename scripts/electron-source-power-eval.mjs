#!/usr/bin/env node
// Real PTY launch and bridge records; isolated fake CLIs, no agent/model task.
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { waitForPageCondition, withElectronApp } from './lib/electron-eval.mjs';
import {
  createHarnessFixture,
  fixtureLaunch,
} from './lib/harness-event-fixture.mjs';
import { FIXTURE_CODEX_VERSION } from './lib/harness-probe-fixture.mjs';

const fixture = createHarnessFixture('exawatt-source-power');
const cli = join(fixture.fakeBin, 'codex');
const argsFile = join(fixture.root, 'power-launch-args.jsonl');
const original = readFileSync(cli, 'utf8');
function installFixture(version, recognized = true) {
  writeFileSync(
    cli,
    original.replace(FIXTURE_CODEX_VERSION, `codex-cli ${version}`).replace(
      'const protocolEnabled =',
      `
if (cargv.includes('features')) {
  process.stdout.write(${JSON.stringify(recognized ? 'prevent_idle_sleep experimental false\n' : 'other stable false\n')});
  process.exit(0);
}
fs.appendFileSync(${JSON.stringify(argsFile)}, JSON.stringify(cargv) + '\\n');
const protocolEnabled =`
    )
  );
}
async function waitForLaunches(page, count) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (existsSync(argsFile)) {
      const launches = readFileSync(argsFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse);
      if (launches.length === count) return launches;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`Fixture did not observe ${count} process launches`);
}
try {
  installFixture('0.156.1');
  await withElectronApp(fixtureLaunch(fixture), async (_app, page) => {
    await page.waitForURL(
      url =>
        url.origin ===
        new URL(process.env.EXA_BASE ?? 'http://localhost:7000').origin,
      { timeout: 90_000 }
    );
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.electron?.pty));
    const launch = async (extra = {}) => {
      const result = await page.evaluate(
        async options => window.electron.pty.create(options),
        {
          harness: 'codex',
          cwd: fixture.project,
          ...extra,
        }
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.session;
    };
    const supported = await launch();
    await waitForPageCondition(
      page,
      async id =>
        (await window.electron.pty.list()).find(row => row.id === id)
          ?.powerControl?.state === 'applied-at-launch',
      supported.id
    );
    supported.powerControl = (
      await page.evaluate(
        id =>
          window.electron.pty
            .list()
            .then(rows => rows.find(row => row.id === id)),
        supported.id
      )
    ).powerControl;
    assert.equal(supported.powerControl.state, 'applied-at-launch');
    assert.equal(supported.powerControl.version, '0.156.1');
    assert.equal(supported.powerControl.executable, cli);
    let [argv] = await waitForLaunches(page, 1);
    assert.equal(argv[argv.indexOf('--disable') + 1], 'prevent_idle_sleep');
    assert(!argv.includes('--no-daemon'));

    // A later launch re-probes: neither unsupported versions nor failed
    // feature recognition may inherit evidence from the earlier process.
    installFixture('0.156.2');
    const unsupported = await launch();
    assert.equal(unsupported.powerControl.state, 'unknown');
    await waitForLaunches(page, 2);
    installFixture('0.156.1', false);
    const unrecognized = await launch();
    assert.equal(unrecognized.powerControl.state, 'unknown');
    const shell = await launch({ harness: 'shell' });
    assert.equal(shell.powerControl.state, 'not-applicable');
    const claude = await launch({ harness: 'claude' });
    assert.equal(claude.powerControl.state, 'uncontrolled');
    const launches = await waitForLaunches(page, 3);
    assert.equal(launches.length, 3);
    for (argv of launches.slice(1)) assert(!argv.includes('--disable'));
    const listed = await page.evaluate(() => window.electron.pty.list());
    assert.deepEqual(
      listed.find(row => row.id === supported.id).powerControl,
      supported.powerControl
    );
    console.log(
      'PASS source power: verified flag and record; unknown-version/feature fallback; shell excluded; Claude uncontrolled; no daemon override'
    );
  });
  // Exercise normal command resolution: the explicit test executable above
  // deliberately bypasses shell lookup and cannot catch BUG-248.
  installFixture('0.156.1');
  rmSync(argsFile, { force: true });
  const alternateBin = join(fixture.root, 'alternate-bin');
  mkdirSync(alternateBin);
  const alternateCli = join(alternateBin, 'codex');
  const alternateMarker = join(fixture.root, 'alternate-ran');
  writeFileSync(
    alternateCli,
    readFileSync(cli, 'utf8').replace(
      'fs.appendFileSync(',
      `fs.writeFileSync(${JSON.stringify(alternateMarker)}, 'alternate'); fs.appendFileSync(`
    ),
    { mode: 0o755 }
  );
  const config = join(fixture.root, 'shell-config');
  mkdirSync(join(config, 'fish'), { recursive: true });
  const wrapperMarker = join(fixture.root, 'wrapper-ran');
  const quote = value => `'${value.replaceAll("'", `'"'"'`)}'`;
  const writeStartup = mode => {
    const terminalPath = mode === 'alternate' ? alternateBin : fixture.fakeBin;
    const zshWrapper =
      mode === 'wrapper'
        ? `function codex() { printf wrapper > ${quote(wrapperMarker)}; ${quote(cli)} "$@"; }`
        : '';
    const fishWrapper =
      mode === 'wrapper'
        ? `function codex; printf wrapper > ${quote(wrapperMarker)}; ${quote(cli)} $argv; end`
        : '';
    writeFileSync(
      join(config, '.zprofile'),
      `export PATH=${quote(fixture.fakeBin)}:$PATH\nif [[ -t 1 ]]; then\nexport PATH=${quote(terminalPath)}:$PATH\n${zshWrapper}\nfi\n`
    );
    writeFileSync(
      join(config, 'fish', 'config.fish'),
      `set -gx PATH ${quote(fixture.fakeBin)} $PATH\nif test -t 1\nset -gx PATH ${quote(terminalPath)} $PATH\n${fishWrapper}\nend\n`
    );
  };
  writeStartup('wrapper');
  await withElectronApp(
    fixtureLaunch(fixture, {
      EXAWATT_TEST_HARNESS_BIN: '',
      XDG_CONFIG_HOME: config,
      ZDOTDIR: config,
    }),
    async (_app, page) => {
      await page.waitForURL(
        url =>
          url.origin ===
          new URL(process.env.EXA_BASE ?? 'http://localhost:7000').origin,
        { timeout: 90_000 }
      );
      await page.waitForFunction(() => Boolean(window.electron?.pty));
      let count = 0;
      for (const mode of ['wrapper', 'alternate', 'plain']) {
        writeStartup(mode);
        const result = await page.evaluate(
          options => window.electron.pty.create(options),
          {
            harness: 'codex',
            cwd: fixture.project,
          }
        );
        assert.equal(result.ok, true, JSON.stringify(result));
        const launches = await waitForLaunches(page, ++count);
        const argv = launches.at(-1);
        const expected = mode === 'plain' ? 'applied-at-launch' : 'unknown';
        await waitForPageCondition(
          page,
          async ({ id, expected }) =>
            (await window.electron.pty.list()).find(row => row.id === id)
              ?.powerControl?.state === expected,
          { id: result.session.id, expected }
        );
        if (mode === 'wrapper')
          assert(
            existsSync(wrapperMarker),
            'the ordinary terminal wrapper must execute'
          );
        if (mode === 'alternate')
          assert(
            existsSync(alternateMarker),
            'the terminal PATH executable must execute'
          );
        assert.equal(
          argv.includes('--disable'),
          mode === 'plain',
          `${mode}: ${JSON.stringify(argv)}`
        );
        await page.evaluate(
          id => window.electron.pty.kill(id),
          result.session.id
        );
      }
      console.log(
        'PASS source power: real terminal wrapper and PATH changes preserve ordinary invocation; plain terminal launch confirms opt-out'
      );
    }
  );
} finally {
  rmSync(fixture.root, { recursive: true, force: true, maxRetries: 5 });
}
