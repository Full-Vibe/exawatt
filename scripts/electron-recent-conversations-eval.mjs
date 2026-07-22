#!/usr/bin/env node

import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const root = mkdtempSync(join(tmpdir(), 'exawatt-recent-conversations-'));
const userData = join(root, 'userData');
const fakeHome = join(root, 'home');
const fakeBin = join(root, 'bin');
const project = join(root, 'cortex-ehr');
const claudeRoot = join(root, 'claude-projects');
const codexRoot = join(root, 'codex-sessions');
const output = resolve('.artifacts', 'recent-conversations');
for (const directory of [
  userData,
  fakeHome,
  fakeBin,
  project,
  claudeRoot,
  codexRoot,
  output,
]) {
  mkdirSync(directory, { recursive: true });
}
writeFileSync(join(project, 'package.json'), '{}');

for (const source of ['claude', 'codex']) {
  const executable = join(fakeBin, source);
  writeFileSync(
    executable,
    `#!/bin/sh
printf 'FAKE_${source.toUpperCase()}_ARGS:'
printf '<%s>' "$@"
printf '\n'
while true; do
  if IFS= read -r line; then printf '%s\n' "$line"; else /bin/sleep 1; fi
done
`
  );
  chmodSync(executable, 0o755);
}

const targetId = '6e3a2161-9d9c-445e-85a4-cca87896b071';
const claudeProject = join(claudeRoot, project.replace(/[^a-zA-Z0-9_-]/g, '-'));
mkdirSync(claudeProject, { recursive: true });
const now = Date.now();
writeFileSync(
  join(claudeProject, 'sessions-index.json'),
  JSON.stringify({
    entries: [
      {
        sessionId: targetId,
        projectPath: project,
        summary: 'client-side-deidentification-mmhc',
        firstPrompt:
          'Move patient identifiers out of the browser de-identification boundary.',
        created: new Date(now - 3_600_000).toISOString(),
        modified: new Date(now - 10_000).toISOString(),
        fileMtime: now + 10_000,
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        sessionId: `00000000-0000-4000-8000-00000000000${index}`,
        projectPath: project,
        summary: `Cortex follow-up ${index + 1}`,
        firstPrompt: `Continue Cortex follow-up ${index + 1}.`,
        created: new Date(now - (index + 2) * 86_400_000).toISOString(),
        modified: new Date(now - (index + 1) * 86_400_000).toISOString(),
        fileMtime: now - (index + 1) * 86_400_000,
      })),
    ],
  })
);
writeFileSync(
  join(codexRoot, 'rollout-cortex.jsonl'),
  [
    JSON.stringify({
      type: 'session_meta',
      payload: {
        session_id: '11111111-1111-4111-8111-111111111111',
        cwd: project,
        timestamp: new Date(now - 172_800_000).toISOString(),
      },
    }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        role: 'user',
        content: [{ text: 'Audit the client consent-state reducer' }],
      },
    }),
  ].join('\n')
);
writeFileSync(
  join(userData, 'closed-sessions.json'),
  JSON.stringify({
    v: 1,
    entries: [
      {
        durableSessionId: 'session-project-owned-provider',
        title: 'Codex',
        goal: 'Audit consent state from Project history',
        harness: 'codex',
        cwd: project,
        projectDir: project,
        projectName: 'cortex-ehr',
        harnessSessionId: '11111111-1111-4111-8111-111111111111',
        initialTask: 'Audit the client consent-state reducer',
        closedAt: now - 30_000,
      },
      {
        durableSessionId: 'session-project-only',
        title: 'Claude Code',
        goal: 'Restore a saved Project-only Session',
        harness: 'claude',
        cwd: project,
        projectDir: project,
        projectName: 'cortex-ehr',
        harnessSessionId: null,
        initialTask: 'Continue from retained terminal history.',
        closedAt: now - 40_000,
      },
      {
        durableSessionId: 'session-legacy-without-provider-id',
        title: 'Claude Code',
        goal: 'Reconcile identity-less Project Session',
        harness: 'claude',
        cwd: project,
        projectDir: project,
        projectName: 'cortex-ehr',
        harnessSessionId: null,
        initialTask: 'Continue Cortex follow-up 1.',
        closedAt: now - 50_000,
      },
    ],
  })
);

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

const launch = {
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_TEST_DIR: project,
    EXAWATT_TEST_HARNESS_BIN: fakeBin,
    EXAWATT_CLAUDE_PROJECTS_ROOT: claudeRoot,
    EXAWATT_CODEX_SESSIONS_ROOT: codexRoot,
    EXAWATT_TEST_QUIT_RESPONSES: 'confirm',
    EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7011'}/workspace`,
  },
};

let completed = false;
try {
  await withElectronApp(
    launch,
    async (_app, page) => {
      page.setDefaultTimeout(20_000);
      page.on('pageerror', error =>
        console.log(`[recent-conversations] pageerror: ${error.message}`)
      );
      await page.setViewportSize({ width: 800, height: 600 });
      await page.locator('[data-command-altitude]').waitFor();
      await page.keyboard.press('Meta+KeyN');
      await page.locator('[data-project-opener]').waitFor();
      await page.getByRole('button', { name: 'Browse Folder' }).click();
      await page.locator('[data-agent-composer]').waitFor();
      const target = page.locator(`[data-conversation-id="${targetId}"]`);
      await target.waitFor();

      check(
        'new task remains the focused default',
        await page
          .getByLabel('Initial task for the new Agent')
          .evaluate(node => node === document.activeElement)
      );
      check(
        'native title and full exact ID are visible',
        (await target.innerText()).includes(
          'client-side-deidentification-mmhc'
        ) && (await target.innerText()).includes(targetId)
      );
      check(
        'exact resume and fresh migration are both discoverable',
        (await target.getByRole('button').count()) === 2 &&
          (await target.getByText('Start fresh').count()) === 1
      );
      check(
        'all harnesses share one recent browser',
        (await page
          .locator('[data-recent-conversations] [data-conversation-id]')
          .count()) === 15 &&
          /codex/i.test(
            await page.locator('[data-recent-conversations]').innerText()
          )
      );
      const projectOwned = page.locator(
        '[data-conversation-id="11111111-1111-4111-8111-111111111111"]'
      );
      check(
        'Project Session history merges into an exact one-click provider migration',
        (await projectOwned.getAttribute('data-continuation')) ===
          'exawatt-session' &&
          (await projectOwned.innerText()).includes(
            'Audit consent state from Project history'
          ) &&
          (await projectOwned
            .getByRole('button', {
              name: 'Resume Audit consent state from Project history in Codex',
            })
            .count()) === 1 &&
          (await page
            .locator('[data-conversation-id="session-project-only"]')
            .count()) === 1
      );
      const reconciledLegacy = page.locator(
        '[data-conversation-id="00000000-0000-4000-8000-000000000000"]'
      );
      check(
        'one unambiguous initial task reconciles legacy identity-less history',
        (await reconciledLegacy.getAttribute('data-continuation')) ===
          'exawatt-session' &&
          (await page
            .locator(
              '[data-conversation-id="session-legacy-without-provider-id"]'
            )
            .count()) === 0
      );
      const composerScroll = page.locator('[data-composer-scroll]');
      const scrollMetrics = await composerScroll.evaluate(node => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      }));
      check(
        'long recents are contained by one scrollable composer pane',
        scrollMetrics.scrollHeight > scrollMetrics.clientHeight &&
          scrollMetrics.scrollTop === 0
      );
      const overlapsChrome = await page.evaluate(() => {
        const chrome = document
          .querySelector('[data-command-altitude]')
          ?.getBoundingClientRect();
        if (!chrome) return true;
        return Array.from(
          document.querySelectorAll('[data-conversation-id]')
        ).some(row => row.getBoundingClientRect().top < chrome.bottom);
      });
      check(
        'recent rows never paint over fixed workspace chrome',
        !overlapsChrome
      );
      await page.screenshot({
        path: join(output, '01-new-agent-recents-800.png'),
      });

      await page
        .getByLabel('Initial task for the new Agent')
        .press('ArrowDown');
      check(
        'Down moves from the empty composer to the first recent',
        await target
          .getByRole('button', {
            name: 'Resume client-side-deidentification-mmhc in Claude Code',
          })
          .evaluate(node => node === document.activeElement)
      );

      await page.keyboard.press('ArrowUp');
      check(
        'Up from the first recent returns to the new-task composer',
        await page
          .getByLabel('Initial task for the new Agent')
          .evaluate(node => node === document.activeElement)
      );
      await page
        .getByLabel('Initial task for the new Agent')
        .press('ArrowDown');

      for (let index = 0; index < 9; index += 1) {
        await page.keyboard.press('ArrowDown');
      }
      const expectedKeyboardId = await page
        .locator('[data-conversation-id]')
        .nth(9)
        .getAttribute('data-conversation-id');
      const keyboardScroll = await composerScroll.evaluate(node => ({
        scrollTop: node.scrollTop,
        activeId: document.activeElement
          ?.closest('[data-conversation-id]')
          ?.getAttribute('data-conversation-id'),
        activeRect: document.activeElement?.getBoundingClientRect().toJSON(),
        viewportRect: node.getBoundingClientRect().toJSON(),
      }));
      check(
        'Down continues through off-screen results and reveals focus',
        keyboardScroll.scrollTop > 0 &&
          keyboardScroll.activeId === expectedKeyboardId &&
          keyboardScroll.activeRect.top >= keyboardScroll.viewportRect.top &&
          keyboardScroll.activeRect.bottom <= keyboardScroll.viewportRect.bottom
      );

      await composerScroll.evaluate(node => {
        node.scrollTop = 0;
      });
      await composerScroll.hover();
      await page.mouse.wheel(0, 600);
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-composer-scroll]')?.scrollTop ?? 0) > 0
      );
      check('mouse and trackpad wheel scroll the same pane', true);

      await page.keyboard.press('Escape');
      await page
        .getByLabel('Initial task for the new Agent')
        .press('ArrowDown');
      await page.keyboard.press('Enter');
      let session;
      const sessionDeadline = Date.now() + 20_000;
      while (Date.now() < sessionDeadline) {
        session = await page.evaluate(
          async id =>
            ((await window.electron?.pty?.list()) ?? []).find(
              item => item.harnessSessionId === id && !item.exited
            ),
          targetId
        );
        if (session) break;
        await page.waitForTimeout(100);
      }
      if (!session) throw new Error('Exact-resume Session did not start');
      const activeTab = page.locator('[data-tab-id][data-active]').first();
      await activeTab.waitFor();
      check(
        'browser label and raw handoff are not promoted into tab chrome',
        session.title === 'Claude Code' &&
          !(await activeTab.innerText()).includes(
            'client-side-deidentification-mmhc'
          ) &&
          !(await activeTab.innerText()).includes('Move patient identifiers')
      );
      await page.waitForTimeout(500);
      const persistedTitleOwnership = await page.evaluate(async id => {
        const workspace = await window.electron?.workspace?.load();
        const tabs =
          workspace?.projects?.flatMap(project => project.tabs) ?? [];
        return tabs.find(tab => tab.harnessSessionId === id);
      }, targetId);
      check(
        'workspace v6 persists default-versus-operator title ownership',
        persistedTitleOwnership?.title === 'Claude Code' &&
          persistedTitleOwnership?.titleKind === 'default'
      );
      const expectedArgs = `<--resume><${targetId}>`;
      const bufferDeadline = Date.now() + 20_000;
      let resumedExactly = false;
      while (Date.now() < bufferDeadline) {
        resumedExactly = await page.evaluate(
          async ({ id, expected }) =>
            ((await window.electron?.pty?.buffer(id)) ?? '').includes(expected),
          { id: session.id, expected: expectedArgs }
        );
        if (resumedExactly) break;
        await page.waitForTimeout(100);
      }
      if (!resumedExactly) throw new Error('Harness did not receive exact ID');
      check('Enter resumes the selected exact provider ID', true);

      await page.setViewportSize({ width: 1200, height: 800 });
      await page.screenshot({ path: join(output, '02-exact-resume-1200.png') });

      // Exercise the same browser as the driven half of a real split. This is
      // the width that exposed title/action overlap in dogfood.
      await page.keyboard.press('Meta+KeyD');
      await page.keyboard.press('Meta+KeyT');
      await page.locator('[data-agent-composer]').waitFor();
      await page.locator('[data-recent-conversations]').waitFor();
      const splitTarget = page.locator(
        '[data-conversation-id="11111111-1111-4111-8111-111111111111"]'
      );
      await splitTarget.waitFor({ state: 'attached' });
      const splitLayout = await splitTarget.evaluate(row => {
        const buttons = row.querySelectorAll('button');
        const primary = buttons[0]?.getBoundingClientRect();
        const fresh = buttons[1]?.getBoundingClientRect();
        const title = row
          .querySelector('[id*="-title-"]')
          ?.getBoundingClientRect();
        const meta = Array.from(row.querySelectorAll('span'))
          .find(
            node =>
              node.childElementCount === 0 &&
              node.textContent?.includes('Codex ·')
          )
          ?.getBoundingClientRect();
        return {
          rowWidth: row.getBoundingClientRect().width,
          noHorizontalOverflow: row.scrollWidth <= row.clientWidth,
          freshWrapped: !!primary && !!fresh && fresh.top >= primary.bottom - 1,
          titleAndMetaSeparate:
            !!title &&
            !!meta &&
            (title.right <= meta.left || title.bottom <= meta.top),
        };
      });
      check(
        'split-pane recents reflow without title, metadata, or action overlap',
        splitLayout.rowWidth < 600 &&
          splitLayout.noHorizontalOverflow &&
          splitLayout.freshWrapped &&
          splitLayout.titleAndMetaSeparate
      );
      await page.screenshot({
        path: join(output, '03-split-pane-recents-1200.png'),
      });

      await splitTarget
        .getByRole('button', {
          name: 'Resume Audit consent state from Project history in Codex',
        })
        .click();
      await page.waitForFunction(async () =>
        ((await window.electron?.pty?.list()) ?? []).some(
          session =>
            session.durableSessionId === 'session-project-owned-provider' &&
            session.harnessSessionId ===
              '11111111-1111-4111-8111-111111111111' &&
            !session.exited
        )
      );
      const migrationSamples = [];
      for (let attempt = 0; attempt < 50; attempt += 1) {
        migrationSamples.push(
          await page.evaluate(async () => ({
            closed: ((await window.electron?.pty?.closedSessions()) ?? []).some(
              entry =>
                entry.durableSessionId === 'session-project-owned-provider'
            ),
            draftCount: Array.from(
              document.querySelectorAll('[data-tab-id]')
            ).filter(tab =>
              tab.textContent?.toLowerCase().includes('new agent')
            ).length,
          }))
        );
        if (
          !migrationSamples.at(-1).closed &&
          migrationSamples.at(-1).draftCount === 0
        ) {
          break;
        }
        await page.waitForTimeout(100);
      }
      const migrationState = await page.evaluate(async () => {
        const draftTabs = Array.from(
          document.querySelectorAll('[data-tab-id]')
        ).filter(tab => tab.textContent?.toLowerCase().includes('new agent'));
        return {
          stillClosed: (
            (await window.electron?.pty?.closedSessions()) ?? []
          ).some(
            entry => entry.durableSessionId === 'session-project-owned-provider'
          ),
          draftTabs: draftTabs.length,
          draftDetails: draftTabs.map(tab => ({
            id: tab.getAttribute('data-tab-id'),
            active: tab.getAttribute('data-active'),
            text: tab.textContent,
          })),
        };
      });
      if (migrationState.stillClosed || migrationState.draftTabs !== 0) {
        console.log(
          `[recent-conversations] migration state ${JSON.stringify({ migrationState, migrationSamples })}`
        );
      }
      check(
        'saved exact Session consumes the draft and ledger only after launch',
        !migrationState.stillClosed && migrationState.draftTabs === 0
      );
      completed = true;
    },
    { maxMs: 90_000 }
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (!completed || failures.length > 0) {
  console.error(`Recent-conversation eval failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`Recent-conversation eval screenshots: ${output}`);
