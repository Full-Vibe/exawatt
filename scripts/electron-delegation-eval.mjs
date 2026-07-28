#!/usr/bin/env node

/**
 * Delegation visibility eval (ENG-023 D1).
 *
 * Exercises the WHOLE pipeline in the real Electron app: Exawatt writes a
 * settings file for the launch, the harness reads it, posts its own lifecycle
 * to the loopback channel, and the strip stops reporting a delegating Session
 * as a finished one.
 *
 * The harness is a fixture rather than the real CLI on purpose — it makes the
 * eval deterministic and free — but it is not a mock of Exawatt: it consumes
 * the ACTUAL injected `--settings` document and speaks the ACTUAL hook payload
 * shapes captured from Claude Code 2.1.206. Everything from the settings file
 * to the rendered dots is production code.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withElectronApp, sweepOrphans } from './lib/electron-eval.mjs';

const root = mkdtempSync(join(tmpdir(), 'exawatt-delegation-'));
const userData = join(root, 'userData');
const project = join(root, 'project');
const fakeBin = join(root, 'bin');
const fakeHome = join(root, 'home');
for (const directory of [userData, project, fakeBin, fakeHome]) {
  mkdirSync(directory, { recursive: true });
}
writeFileSync(join(project, 'package.json'), '{}');

/**
 * A harness that delegates. It parses `--settings` out of its own argv, reads
 * the endpoint and token Exawatt wrote there, and posts real hook payloads on
 * stdin commands:
 *   spawn <id>  -> SubagentStart      done <id> -> SubagentStop
 *   turn        -> UserPromptSubmit   stop      -> Stop
 * `child-stop` posts a Stop carrying an agent_id — the payload that must NOT
 * move the parent's own turn.
 */
writeFileSync(
  join(fakeBin, 'claude'),
  `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
const settingsPath = argv[argv.indexOf('--settings') + 1];
process.stdout.write('FAKE_CLAUDE_SETTINGS:' + (settingsPath || 'NONE') + '\\n');
let endpoint = null;
let token = null;
try {
  const hook = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    .hooks.SubagentStart[0].hooks[0];
  endpoint = hook.url;
  token = hook.headers['x-exawatt-token'];
  process.stdout.write('FAKE_CLAUDE_SUBSCRIBED\\n');
} catch (error) {
  process.stdout.write('FAKE_CLAUDE_UNSUBSCRIBED:' + error.message + '\\n');
}
async function post(body) {
  if (!endpoint) return;
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-exawatt-token': token },
      body: JSON.stringify(body),
    });
    process.stdout.write('POSTED:' + body.hook_event_name + '\\n');
  } catch (error) {
    process.stdout.write('POST_FAILED:' + error.message + '\\n');
  }
}
let buffer = '';
process.stdin.on('data', async chunk => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.search(/[\\r\\n]/)) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    const [command, id] = line.split(' ');
    if (command === 'spawn')
      await post({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'Explore' });
    else if (command === 'done')
      await post({ hook_event_name: 'SubagentStop', agent_id: id, agent_type: 'Explore', last_assistant_message: 'PRIVATE_REPORT_BODY' });
    else if (command === 'turn') await post({ hook_event_name: 'UserPromptSubmit' });
    else if (command === 'stop') await post({ hook_event_name: 'Stop' });
    else if (command === 'child-stop')
      await post({ hook_event_name: 'Stop', agent_id: id });
  }
});
setInterval(() => {}, 1 << 30);
`
);
chmodSync(join(fakeBin, 'claude'), 0o755);

// Codex reports no delegation. It must render as ABSENT, not as an empty one.
writeFileSync(
  join(fakeBin, 'codex'),
  `#!/usr/bin/env node
process.stdout.write('FAKE_CODEX_ARGS:' + process.argv.slice(2).join(' ') + '\\n');
setInterval(() => {}, 1 << 30);
`
);
chmodSync(join(fakeBin, 'codex'), 0o755);

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

const launch = {
  args: [resolve('dist-electron/main/main.js')],
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_TEST_DIR: project,
    EXAWATT_TEST_HARNESS_BIN: fakeBin,
    EXAWATT_TEST_QUIT_RESPONSES: 'confirm',
    // a delegating parent goes quiet fast; shorten the turn-end inference so
    // the "does it wrongly claim a result?" question resolves in eval time
    EXAWATT_ATTENTION_QUIET_MS: '1200',
    EXAWATT_ATTENTION_MIN_BURST: '1',
    EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
  },
};

sweepOrphans();
let completed = false;
try {
  await withElectronApp(
    launch,
    async (_app, page) => {
      page.setDefaultTimeout(25_000);
      page.on('pageerror', error =>
        console.log(`[delegation] pageerror: ${error.message}`)
      );
      await page.setViewportSize({ width: 1200, height: 760 });
      await page.locator('[data-command-altitude]').waitFor();
      await page.evaluate(dir => {
        window.dispatchEvent(
          new CustomEvent('exawatt:open-project', { detail: dir })
        );
      }, project);
      await page.locator('[data-agent-composer]').waitFor();
      await page.getByRole('button', { name: 'Start' }).click();

      const sessions = async () =>
        (await page.evaluate(
          async () => (await window.electron?.pty?.list()) ?? []
        )) ?? [];
      const until = async (predicate, label, timeout = 20_000) => {
        const deadline = Date.now() + timeout;
        let last;
        while (Date.now() < deadline) {
          last = await predicate();
          if (last) return last;
          await page.waitForTimeout(120);
        }
        throw new Error(`Timed out waiting for ${label}`);
      };
      const claude = await until(
        async () => (await sessions()).find(s => s.harness === 'claude'),
        'Claude session'
      );
      const buffer = async () =>
        (await page.evaluate(
          async id => window.electron?.pty?.buffer(id),
          claude.id
        )) ?? '';
      const send = async text =>
        page.evaluate(
          async ({ id, data }) => window.electron?.pty?.write(id, data),
          { id: claude.id, data: `${text}\r` }
        );
      const dots = page.locator('[data-delegation]').first();
      const statusOf = async () =>
        page.evaluate(() => {
          const node = document.querySelector('[data-status]');
          return node?.getAttribute('data-status') ?? null;
        });

      // --- the launch actually subscribed -------------------------------
      await until(
        async () => (await buffer()).includes('FAKE_CLAUDE_SUBSCRIBED'),
        'harness to read the injected settings'
      );
      const launchOutput = await buffer();
      check(
        'Exawatt injects a settings file the harness can read',
        launchOutput.includes('FAKE_CLAUDE_SUBSCRIBED')
      );
      check(
        'the settings file lives in Exawatt state, not the user harness config',
        /FAKE_CLAUDE_SETTINGS:.*harness-events/.test(launchOutput) &&
          !/FAKE_CLAUDE_SETTINGS:.*\.claude/.test(launchOutput)
      );

      // --- a delegating parent must not read as finished ----------------
      await send('turn');
      await send('spawn a1');
      await send('stop');
      await until(
        async () => (await dots.count()) > 0,
        'delegation dots to appear'
      );
      check('a delegated child shows as a dot', (await dots.count()) === 1);
      check(
        'one child reads as one working agent',
        (await dots.getAttribute('aria-label')) ===
          '1 delegated agent working — Explore'
      );

      // The parent's own turn ended and it has gone quiet. Before ENG-023
      // this is exactly where the strip claimed "result ready".
      await page.waitForTimeout(3_000);
      check(
        'a quiet parent with a live child still reads as working',
        (await statusOf()) === 'working'
      );
      const attention = await page.evaluate(
        async () =>
          ((await window.electron?.pty?.list()) ?? []).map(s => s.attention)
      );
      check(
        'no turn-end result is raised while a child runs',
        attention.every(entry => entry?.kind !== 'turn-end')
      );

      // --- a child's own turn boundary must not move the parent ---------
      await send('child-stop a1');
      await page.waitForTimeout(600);
      check(
        'a Stop from inside a child leaves the parent delegating',
        (await dots.count()) === 1 && (await statusOf()) === 'working'
      );

      // --- more children, stable geometry -------------------------------
      const widthBefore = await dots.evaluate(node => node.style.width);
      await send('spawn a2');
      await send('spawn a3');
      await until(
        async () => (await dots.getAttribute('data-delegation')) === '3',
        'three children'
      );
      check(
        'children arriving never resize the row',
        (await dots.evaluate(node => node.style.width)) === widthBefore
      );

      // --- the last child finishing settles the Session -----------------
      for (const id of ['a1', 'a2', 'a3']) await send(`done ${id}`);
      await until(
        async () => (await dots.count()) === 0,
        'delegation dots to clear'
      );
      check('dots clear when the last child finishes', true);
      const settled = await until(
        async () => ((await statusOf()) === 'done' ? 'done' : null),
        'the Session to settle as a ready result',
        12_000
      );
      check('a finished Session finally reads as a ready result', settled === 'done');

      // --- the child's report never reaches the renderer ----------------
      const leaked = await page.evaluate(() =>
        document.body.innerHTML.includes('PRIVATE_REPORT_BODY')
      );
      check('a child report body never reaches a surface', !leaked);

      // --- a source that reports nothing shows nothing ------------------
      await page.keyboard.press('Meta+KeyT');
      await page.locator('[data-agent-composer]').waitFor();
      await page.getByLabel('Agent Source').click();
      await page.getByRole('option', { name: 'Codex' }).click();
      await page.getByRole('button', { name: 'Start' }).click();
      await until(
        async () => (await sessions()).find(s => s.harness === 'codex'),
        'Codex session'
      );
      await page.waitForTimeout(2_500);
      check(
        'a source with no delegation capability renders nothing at all',
        (await page.locator('[data-delegation]').count()) === 0
      );

      await page.screenshot({
        path: join(root, 'delegation.png'),
        fullPage: false,
      });
      completed = true;
    },
    { maxMs: 180_000 }
  );
} finally {
  if (process.env.EXAWATT_KEEP_EVAL) {
    console.log(`[delegation] retained fixture: ${root}`);
  } else {
    rmSync(root, { recursive: true, force: true });
  }
}

if (!completed || failures.length > 0) {
  console.error(`FAIL delegation eval — ${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('PASS delegation visibility (ENG-023 D1)');
