#!/usr/bin/env node

/**
 * The bus's MCP door, end to end, on the REAL harnesses (ENG-029 B2).
 *
 * Exawatt launches two real Codex tabs in one Project in Auto-review, the
 * permission class whose workspace-write sandbox turns network off, so the
 * `exawatt` command cannot reach Exawatt from there (measured 2026-10-15).
 * The sender is asked, in plain words and without naming any tool, to
 * message the other Agent. Pass means the message is in the Project's
 * ledger from the sender to the recipient, sent through the Exawatt MCP
 * server Exawatt handed that launch, and the recipient read the stamp.
 * With CLAUDE_CODE_OAUTH_TOKEN set, a Claude Code tab sends one more the
 * same way.
 *
 * Codex asks before an MCP server's first tool call when its policy asks
 * (the harness's own dialog, not Exawatt's): the probe answers it as the
 * operator would, and says it did.
 *
 * Hygiene (the B0 rules): HOME is a scratch directory, so nothing touches the
 * operator's own `~/.codex` or `~/.claude`; Codex signs in with a copy of
 * `auth.json`. It spends real model turns: a probe the operator runs, never a
 * landing gate.
 *
 *   EXA_BASE=http://localhost:<port> pnpm eval:electron:bus-mcp-live
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

const root = realpathSync(mkdtempSync(join(tmpdir(), 'exawatt-bus-mcp-')));
const home = join(root, 'home');
const project = join(root, 'project');
const userData = join(root, 'userData');
for (const directory of [home, project, userData, join(home, '.codex')])
  mkdirSync(directory, { recursive: true });
execFileSync('git', ['init', '-q', project]);
writeFileSync(join(project, 'README.md'), '# bus mcp probe\n');
copyFileSync(
  join(homedir(), '.codex', 'auth.json'),
  join(home, '.codex', 'auth.json')
);
writeFileSync(
  join(home, '.codex', 'config.toml'),
  `check_for_update_on_startup = false\n\n[projects."${project}"]\ntrust_level = "trusted"\n`
);
const claudeToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || null;
if (claudeToken) {
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
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
    JSON.stringify({ tui: 'default' })
  );
} else {
  console.log('CLAUDE_CODE_OAUTH_TOKEN not set: Codex only.');
}

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('CLAUDE'))
);
const launch = {
  args: [new URL('../dist-electron/main/main.js', import.meta.url).pathname],
  env: {
    ...env,
    HOME: home,
    ...(claudeToken ? { CLAUDE_CODE_OAUTH_TOKEN: claudeToken } : {}),
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
const plain = text => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

sweepOrphans();
try {
  await withElectronApp(
    launch,
    async (_app, page) => {
      page.setDefaultTimeout(60_000);
      await waitForWorkspaceReady(page, { timeout: 120_000 });
      await page.setViewportSize({ width: 1400, height: 900 });
      for (const source of ['codex', 'claude'])
        await page.evaluate(
          ({ dir, source }) =>
            window.electron.settings.setAgentPermissionMode(
              dir,
              source,
              'auto'
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
      const ask = to =>
        `Send a message to the other agent working in this project, ${to}, saying exactly: MCP-PING. Do not use a shell command for it. Then stop.`;

      const recipient = await start(
        'Codex',
        'codex',
        'codex-2',
        'Reply with the single word READY and then wait for messages.'
      );
      const projectId = recipient.projectDir;
      const sender = await start('Codex', 'codex', 'codex-3', ask('@codex-2'));
      const claude = claudeToken
        ? await start('Claude Code', 'claude', 'claude-1', ask('@codex-2'))
        : null;

      // Wait for the effect; answer each harness's own approval dialog for
      // the MCP server as the operator would.
      const approved = new Set();
      const deadline = Date.now() + 300_000;
      let read = null;
      const arrived = from =>
        read?.ok &&
        read.records.some(
          record =>
            record.from.sessionId === from.durableSessionId &&
            record.to.sessionId === recipient.durableSessionId &&
            record.text.includes('MCP-PING') &&
            record.delivery.state === 'delivered'
        );
      while (Date.now() < deadline) {
        read = await page.evaluate(
          id => window.electron.bus.list(id),
          projectId
        );
        if (arrived(sender) && (!claude || arrived(claude))) break;
        for (const tab of [sender, claude].filter(Boolean)) {
          const screen = plain(
            await page.evaluate(id => window.electron.pty.buffer(id), tab.id)
          );
          const tail = screen.slice(-3000);
          if (/exawatt/i.test(tail) && /Allow|approve|Yes/i.test(tail)) {
            if (!approved.has(tab.id)) console.log(`approving for ${tab.id}`);
            approved.add(tab.id);
            await page.evaluate(
              id => window.electron.pty.write(id, '\r'),
              tab.id
            );
          }
        }
        await page.waitForTimeout(2_000);
      }
      if (process.env.EXAWATT_BUS_MCP_KEEP)
        for (const tab of [sender, recipient, claude].filter(Boolean))
          writeFileSync(
            join(root, `${tab.id}.screen.txt`),
            plain(
              await page.evaluate(id => window.electron.pty.buffer(id), tab.id)
            )
          );
      console.log(JSON.stringify(read, null, 2));
      console.log(
        `harness approval dialogs answered: ${approved.size ? [...approved].join(', ') : 'none'}`
      );
      const record = from =>
        read?.ok
          ? read.records.find(
              item =>
                item.from.sessionId === from.durableSessionId &&
                item.text.includes('MCP-PING')
            )
          : null;
      const ping = record(sender);
      check(
        'a Codex Agent in Auto-review reached another Agent through the MCP door',
        ping?.to.sessionId === recipient.durableSessionId &&
          ping.delivery.state === 'delivered' &&
          ping.delivery.adapter === 'codex-queue',
        JSON.stringify(ping ?? read)
      );
      const recipientScreen = plain(
        await page.evaluate(id => window.electron.pty.buffer(id), recipient.id)
      ).replace(/\s+/g, ' ');
      check(
        'the recipient read the stamp, which offers its own send tool for the reply',
        /\[Exawatt\] Message from @codex-3 \(Codex\)/.test(recipientScreen) &&
          /exawatt_send_message/.test(recipientScreen),
        recipientScreen.slice(-1500)
      );
      const senderScreen = plain(
        await page.evaluate(id => window.electron.pty.buffer(id), sender.id)
      );
      check(
        'the sender used the Exawatt tool, not a shell command',
        /exawatt[._/]{1,2}exawatt_send_message|exawatt_send_message/.test(
          senderScreen
        ) && !/exawatt send @codex-2/.test(senderScreen),
        senderScreen.slice(-1500)
      );
      if (claude) {
        const claudePing = record(claude);
        check(
          'a Claude Code Agent reached the same Agent through the MCP door',
          claudePing?.to.sessionId === recipient.durableSessionId,
          JSON.stringify(claudePing ?? null)
        );
      }
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
  if (!process.env.EXAWATT_BUS_MCP_KEEP)
    rmSync(root, { recursive: true, force: true });
  else console.log(`scratch kept at ${root}`);
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nbus MCP live eval passed');
