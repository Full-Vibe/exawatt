// Shared fixture for harness-event-channel evals (ENG-023 / ENG-015 S1.1).
//
// The fixture harness is NOT a mock of Exawatt: it parses the ACTUAL settings
// document Exawatt injects and posts the ACTUAL hook payload shapes captured
// from Claude Code 2.1.206. Everything from the settings file to the rendered
// strip is production code — only the model is replaced, so a permutation
// costs nothing and lands on an exact boundary instead of a plausible one.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeProbeJs, codexProbeJs } from './harness-probe-fixture.mjs';

/**
 * Commands the fixture Claude accepts on stdin:
 *   turn                 UserPromptSubmit    stop            Stop
 *   spawn <id>           SubagentStart       done <id>       SubagentStop
 *   label <type> <desc>  PreToolUse[Agent] — the spawn label (ENG-023 D3a)
 *   child-stop <id>      Stop carrying agent_id (must not move the parent)
 *   ask                  PreToolUse[AskUserQuestion]  — the operator gate
 *   answer               PostToolUse[AskUserQuestion] — the gate closing
 *   permission           Notification[permission_prompt]
 *   idle                 Notification[idle_prompt] — deliberately NOT a gate
 *   batch                PostToolBatch — the granted-permission release
 *   say <text>           plain stdout, no hook — pure terminal bytes
 *   bell                 a BARE BEL, no hook — Claude Code's idle-prompt nudge
 */
export function createHarnessFixture(prefix) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const userData = join(root, 'userData');
  const project = join(root, 'project');
  const fakeBin = join(root, 'bin');
  const fakeHome = join(root, 'home');
  for (const directory of [userData, project, fakeBin, fakeHome]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(join(project, 'package.json'), '{}');

  writeFileSync(
    join(fakeBin, 'claude'),
    `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
// Answer the product's PROBES and exit. Only an interactive launch holds the
// process open. Without this every \`claude --version\` and \`auth status\` the
// registry runs hangs forever, and each eval run LEAKS those processes —
// observed accumulating across runs and degrading the machine for every later
// run. The answers live in \`harness-probe-fixture.mjs\` so every fixture gives
// the same ones.
${claudeProbeJs()}
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
  } catch {}
}
let buffer = '';
let labelSeq = 0;
process.stdin.on('data', async chunk => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.search(/[\\r\\n]/)) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    const space = line.indexOf(' ');
    const command = space === -1 ? line : line.slice(0, space);
    const rest = space === -1 ? '' : line.slice(space + 1);
    if (command === 'spawn')
      await post({ hook_event_name: 'SubagentStart', agent_id: rest, agent_type: 'Explore' });
    else if (command === 'label') {
      // The real payload shape from PreToolUse matched to Agent|Task: the
      // operator-legible description plus the private prompt, which must
      // never reach a surface.
      const cut = rest.indexOf(' ');
      const type = cut === -1 ? rest : rest.slice(0, cut);
      const desc = cut === -1 ? '' : rest.slice(cut + 1);
      labelSeq += 1;
      await post({
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        tool_use_id: 'toolu_label_' + labelSeq,
        tool_input: { description: desc, subagent_type: type, prompt: 'PRIVATE_PROMPT_BODY' },
      });
    }
    else if (command === 'done')
      await post({ hook_event_name: 'SubagentStop', agent_id: rest, agent_type: 'Explore', last_assistant_message: 'PRIVATE_REPORT_BODY' });
    else if (command === 'turn') await post({ hook_event_name: 'UserPromptSubmit' });
    else if (command === 'stop') await post({ hook_event_name: 'Stop' });
    else if (command === 'ask')
      await post({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_ask' });
    else if (command === 'answer')
      await post({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_ask' });
    else if (command === 'permission')
      await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude wants to run: Bash' });
    else if (command === 'idle')
      await post({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'waiting' });
    else if (command === 'batch')
      await post({ hook_event_name: 'PostToolBatch', tool_calls: [] });
    else if (command === 'child-stop')
      await post({ hook_event_name: 'Stop', agent_id: rest });
    // The idle nudge, byte for byte. Claude Code 2.1.231's \`idle_prompt\`
    // Notification is deliberately unsubscribed, so 60s after its own Stop it
    // reaches Exawatt as nothing but this: one bare BEL, no hook at all.
    else if (command === 'bell') process.stdout.write('\\x07');
    else if (command === 'say') process.stdout.write(rest + '\\n');
  }
});
setInterval(() => {}, 1 << 30);
`
  );
  chmodSync(join(fakeBin, 'claude'), 0o755);

  // Codex reports no DELEGATION. Absent must render as absent, never as an
  // empty one — that is the control these evals need, and it is unchanged.
  // It does publish a model catalog, because a real Codex CLI does and because
  // since D49 an engine that publishes none may not start at all: answering
  // only `--version` made the product refuse the launch, and the refusal was
  // read as an eval defect for two months (BUG-014).
  writeFileSync(
    join(fakeBin, 'codex'),
    `#!/usr/bin/env node
const cargv = process.argv.slice(2);
${codexProbeJs()}
process.stdout.write('FAKE_CODEX_ARGS:' + cargv.join(' ') + '\\n');
// Accepts \`say <text>\` so a test can drive PURE byte inference on a source
// that reports nothing — the control for the reported path.
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.search(/[\\r\\n]/)) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.startsWith('say ')) process.stdout.write(line.slice(4) + '\\n');
  }
});
setInterval(() => {}, 1 << 30);
`
  );
  chmodSync(join(fakeBin, 'codex'), 0o755);

  return { root, userData, project, fakeBin, fakeHome };
}

/** Launch options for `withElectronApp` against a fixture. */
export function fixtureLaunch(fixture, extraEnv = {}) {
  return {
    args: [
      new URL('../../dist-electron/main/main.js', import.meta.url).pathname,
    ],
    env: {
      ...process.env,
      HOME: fixture.fakeHome,
      PATH: `${fixture.fakeBin}:${process.env.PATH ?? ''}`,
      NODE_ENV: 'development',
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: fixture.userData,
      EXAWATT_TEST_DIR: fixture.project,
      EXAWATT_TEST_HARNESS_BIN: fixture.fakeBin,
      EXAWATT_TEST_QUIT_RESPONSES: 'confirm',
      EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
      ...extraEnv,
    },
  };
}

/** Boot the app onto a Project with one fixture Claude Session running. */
export async function openFixtureSession(page, fixture) {
  page.setDefaultTimeout(25_000);
  await page.setViewportSize({ width: 1200, height: 760 });
  // A cold dev server compiles the workspace route on first hit; only these
  // first waits get that headroom so real failures still surface fast.
  await page.locator('[data-command-altitude]').waitFor({ timeout: 90_000 });
  await page.evaluate(dir => {
    window.dispatchEvent(
      new CustomEvent('exawatt:open-project', { detail: dir })
    );
  }, fixture.project);
  await page.locator('[data-agent-composer]').waitFor({ timeout: 90_000 });
  // Source truth fails closed, so a fake harness that stops satisfying the
  // Agent Source registry leaves Start disabled — and Playwright reports that
  // as a bare 25s "element is not enabled" with nothing naming the cause.
  // Read the registry directly and fail with the actual reason instead.
  const launchable = await page.evaluate(async () => {
    const snapshot = await window.electron?.agentSources?.list('launch', true);
    return (snapshot?.sources ?? []).map(source => ({
      harness: source.harness,
      launchable: source.launchable,
      stateLabel: source.stateLabel,
      facts: Object.fromEntries(
        Object.entries(source.facts ?? {}).map(([key, value]) => [
          key,
          `${value.state}: ${value.value}`,
        ])
      ),
    }));
  });
  const claudeSource = launchable.find(source => source.harness === 'claude');
  if (!claudeSource?.launchable) {
    throw new Error(
      `Fixture Claude is not launchable — Start will never enable.\n` +
        `  state: ${claudeSource?.stateLabel ?? 'source missing entirely'}\n` +
        Object.entries(claudeSource?.facts ?? {})
          .map(([key, value]) => `  ${key}: ${value}`)
          .join('\n') +
        `\nThe fake harness in this fixture must answer whatever the Agent` +
        ` Source registry probes (version, auth status).`
    );
  }
  await page.getByRole('button', { name: 'Start' }).click();

  const sessions = async () =>
    (await page.evaluate(
      async () => (await window.electron?.pty?.list()) ?? []
    )) ?? [];
  const until = async (predicate, label, timeout = 20_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await predicate();
      if (value) return value;
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
  const status = async () =>
    page.evaluate(
      () =>
        document.querySelector('[data-status]')?.getAttribute('data-status') ??
        'none'
    );
  await until(
    async () => (await buffer()).includes('FAKE_CLAUDE_SUBSCRIBED'),
    'the harness to read the injected settings'
  );
  return { claude, sessions, until, buffer, send, status };
}
