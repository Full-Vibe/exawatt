#!/usr/bin/env node

/**
 * The agent-to-agent bus, end to end, on the REAL harnesses (ENG-029 C4).
 *
 * Exawatt launches a real Claude Code tab and a real Codex tab in one
 * Project; Claude is asked to message Codex with the `exawatt` command on its
 * PATH, Codex to answer the same way, and the operator then sends Claude a
 * message of his own. Pass means: both peer messages are in the Project's
 * ledger with their delivery results (Codex's queue `queued` then
 * `delivered`, Claude's socket `delivered`), each recipient actually read the
 * stamped text, and the operator's message reached Claude as his own turn.
 *
 * Hygiene (the B0 rules): HOME, and with it `~/.claude` and `~/.codex`, is a
 * scratch directory, so nothing touches the operator's own harness state;
 * Claude signs in with the OAuth token the operator supplies and Codex with a
 * copy of `auth.json`. It spends a few real model turns, so it is a probe the
 * operator runs, never a landing gate.
 *
 *   CLAUDE_CODE_OAUTH_TOKEN=… EXA_BASE=http://localhost:<port> pnpm eval:electron:bus-live
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startAgentFromLauncher,
  sweepOrphans,
  waitForWorkspaceReady,
  withElectronApp,
} from './lib/electron-eval.mjs';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'exawatt-bus-live-')));
const home = join(root, 'home');
const project = join(root, 'project');
const userData = join(root, 'userData');
for (const directory of [home, project, userData, join(home, '.codex')])
  mkdirSync(directory, { recursive: true });
execFileSync('git', ['init', '-q', project]);
writeFileSync(join(project, 'README.md'), '# bus probe\n');

// Exawatt reads no Claude credential (ENG-038): the operator hands the probe
// a token, for example one minted by \`claude setup-token\`.
const claudeToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
if (!claudeToken) {
  console.error(
    'Set CLAUDE_CODE_OAUTH_TOKEN (for example from `claude setup-token`): the probe signs Claude Code in with it inside its scratch HOME.'
  );
  process.exit(64);
}
writeFileSync(
  join(home, '.claude.json'),
  JSON.stringify({
    hasCompletedOnboarding: true,
    bypassPermissionsModeAccepted: true,
    theme: 'dark',
    projects: {
      [project]: {
        hasTrustDialogAccepted: true,
        hasCompletedProjectOnboarding: true,
      },
    },
  })
);
mkdirSync(join(home, '.claude'), { recursive: true });
writeFileSync(
  join(home, '.claude', 'settings.json'),
  // The classic renderer: the fullscreen one never finished booting in an
  // eval window here, which is the eval's terminal, not the bus.
  JSON.stringify({ skipDangerousModePermissionPrompt: true, tui: 'default' })
);
copyFileSync(
  join(homedir(), '.codex', 'auth.json'),
  join(home, '.codex', 'auth.json')
);
writeFileSync(
  join(home, '.codex', 'config.toml'),
  `check_for_update_on_startup = false\n\n[projects."${project}"]\ntrust_level = "trusted"\n`
);

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('CLAUDE'))
);
const launch = {
  args: [new URL('../dist-electron/main/main.js', import.meta.url).pathname],
  env: {
    ...env,
    HOME: home,
    CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
    DISABLE_AUTOUPDATER: '1',
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_TEST_DIR: project,
    EXAWATT_TEST_QUIT_RESPONSES: 'confirm',
    EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
  },
};

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `\n     ${detail}`}`
  );
  if (!ok) failures.push(label);
};

sweepOrphans();
try {
  await withElectronApp(
    launch,
    async (_app, page) => {
      page.setDefaultTimeout(60_000);
      // The predicate runs in the page and resolves a boolean; this polls it
      // until true. Waiting for the effect, bounded so a stuck run says so.
      const until = async (probe, label, timeout = 240_000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (await page.evaluate(probe.fn, probe.arg)) return;
          await page.waitForTimeout(1_000);
        }
        throw new Error(`timed out waiting for ${label}`);
      };
      await waitForWorkspaceReady(page, { timeout: 120_000 });
      await page.setViewportSize({ width: 1400, height: 900 });
      for (const source of ['claude', 'codex'])
        await page.evaluate(
          ({ dir, source }) =>
            window.electron.settings.setAgentPermissionMode(
              dir,
              source,
              'unrestricted'
            ),
          { dir: project, source }
        );
      await page.evaluate(dir => {
        window.dispatchEvent(
          new CustomEvent('exawatt:open-project', { detail: dir })
        );
      }, project);
      await page.locator('[data-agent-composer]').waitFor({ timeout: 120_000 });

      const sessions = () => page.evaluate(() => window.electron.pty.list());
      /** Start one Agent through the shipped launcher and give it the name
       *  the prompts below address (an operator rename). */
      const start = async (engine, harness, name, task) => {
        const before = new Set((await sessions()).map(item => item.id));
        await startAgentFromLauncher(page, { engine, task });
        let session = null;
        const deadline = Date.now() + 180_000;
        while (!session && Date.now() < deadline) {
          session = (await sessions()).find(
            item =>
              item.harness === harness &&
              !before.has(item.id) &&
              item.harnessSessionId
          );
          if (!session) await page.waitForTimeout(500);
        }
        if (!session) throw new Error(`${engine} never named its conversation`);
        const renamed = await page.evaluate(
          ({ id, name }) => window.electron.pty.renameAgent(id, name),
          { id: session.durableSessionId, name }
        );
        if (!renamed.ok) throw new Error(`rename refused: ${renamed.reason}`);
        return session;
      };
      // A Codex thread exists once its first turn is submitted (measured
      // here on 0.162.1 in shared-server mode), so it starts with a task.
      const codex = await start(
        'Codex',
        'codex',
        'codex-2',
        'Reply with the single word READY and then wait for messages.'
      );
      const claude = await start('Claude Code', 'claude', 'claude-1');
      const projectId = codex.projectDir;

      // The operator's own turn starts the exchange: typed into Claude when
      // its turn is not running, exactly as if he had typed it.
      const kickoff = await page.evaluate(
        ({ id, to }) =>
          window.electron.bus.send({
            projectId: id,
            to,
            text:
              'Run exactly this shell command once, then stop and wait: ' +
              "exawatt send @codex-2 'PING-FROM-CLAUDE. Please answer me by running: exawatt send @claude-1 PONG-FROM-CODEX'",
            kind: 'operator',
          }),
        { id: projectId, to: claude.durableSessionId }
      );
      console.log('operator kickoff:', JSON.stringify(kickoff.delivery));
      const shot = name =>
        process.env.EXAWATT_BUS_LIVE_KEEP
          ? page.screenshot({ path: join(root, `${name}.png`) })
          : null;
      await shot('after-kickoff');

      const ledger = () =>
        page.evaluate(id => window.electron.bus.list(id), projectId);
      await until(
        {
          fn: id =>
            window.electron.bus
              .list(id)
              .then(
                read =>
                  read.ok &&
                  read.records.some(
                    record =>
                      record.from.harness === 'codex' &&
                      record.text.includes('PONG-FROM-CODEX') &&
                      record.delivery.state === 'delivered'
                  ) &&
                  read.records.some(
                    record =>
                      record.from.harness === 'claude' &&
                      record.text.includes('PING-FROM-CLAUDE') &&
                      record.delivery.state === 'delivered'
                  )
              ),
          arg: projectId,
        },
        'the two-way exchange'
      ).catch(error => console.log(String(error)));
      const read = await ledger();
      await shot('after-exchange');
      console.log(JSON.stringify(read, null, 2));
      if (process.env.EXAWATT_BUS_LIVE_KEEP) {
        for (const [label, id] of [
          ['claude', claude.id],
          ['codex', codex.id],
        ])
          writeFileSync(
            join(root, `${label}.screen.json`),
            JSON.stringify(
              await page.evaluate(
                ptyId => window.electron.pty.buffer(ptyId),
                id
              )
            )
          );
      }
      const ping = read.ok
        ? read.records.find(
            record =>
              record.from.harness === 'claude' &&
              record.text.includes('PING-FROM-CLAUDE')
          )
        : null;
      const pong = read.ok
        ? read.records.find(
            record =>
              record.from.harness === 'codex' &&
              record.text.includes('PONG-FROM-CODEX')
          )
        : null;
      check(
        'Claude reached Codex through codex queue: queued, then delivered when its turn began',
        ping?.from.sessionId === claude.durableSessionId &&
          ping?.to.sessionId === codex.durableSessionId &&
          ping.delivery.adapter === 'codex-queue' &&
          ping.history.map(event => event.state).join('>') ===
            'queued>delivered',
        JSON.stringify(ping?.history)
      );
      check(
        'Codex answered Claude through its socket: delivered',
        pong?.from.sessionId === codex.durableSessionId &&
          pong?.to.sessionId === claude.durableSessionId &&
          pong.delivery.adapter === 'claude-socket' &&
          pong.delivery.state === 'delivered',
        JSON.stringify(pong?.history)
      );
      const codexScreen = await page.evaluate(
        id => window.electron.pty.buffer(id),
        codex.id
      );
      check(
        'Codex read the stamp naming Claude, its harness and the Project',
        /\[Exawatt\] Message from @claude-1 \(Claude Code\) in Project/.test(
          codexScreen.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
        )
      );

      const after = await ledger();
      const operatorRecord = after.ok
        ? after.records.find(record => record.from.kind === 'operator')
        : null;
      check(
        'the operator message reached Claude as his own turn and reads delivered',
        operatorRecord?.to.sessionId === claude.durableSessionId &&
          operatorRecord.delivery.adapter === 'terminal-input' &&
          operatorRecord.delivery.state === 'delivered',
        JSON.stringify(operatorRecord?.history)
      );
      const refused = await page.evaluate(
        id =>
          window.electron.bus.send({
            projectId: id,
            to: '@nobody',
            text: 'hi',
            kind: 'operator',
          }),
        projectId
      );
      check(
        'an unknown recipient is refused at the sender with a reason',
        refused.record === null &&
          /No Agent named @nobody/.test(refused.delivery.reason ?? '')
      );
    },
    { maxMs: 900_000 }
  );
} finally {
  // Codex leaves its managed app-server daemon running from the scratch
  // home; stop exactly the processes whose command names this scratch root.
  const leftovers = execFileSync('ps', ['-axo', 'pid=,command='])
    .toString()
    .split('\n')
    .filter(line => line.includes(root))
    .map(line => Number(line.trim().split(/\s+/)[0]))
    .filter(pid => Number.isInteger(pid) && pid > 1 && pid !== process.pid);
  for (const pid of leftovers) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  if (!process.env.EXAWATT_BUS_LIVE_KEEP)
    rmSync(root, { recursive: true, force: true });
  else console.log(`scratch kept at ${root}`);
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nbus live eval passed');
