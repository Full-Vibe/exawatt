#!/usr/bin/env node
// ENG-017 S2, re-homed by S12: the roadmap lens lives at the SESSIONS
// altitude. Drive it end-to-end — ⌘B summons Sessions with the rail focused,
// keyboard walk, drill, selection re-scoping across Projects, empty-queue,
// no-roadmap, declare-at-launch, starving ⌘J — and screenshot each state.
// Run with EXA_BASE pointing at a dev server serving THIS checkout.
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7071';
const OUT = process.env.EXA_SHOT_DIR || mkdtempSync(join(tmpdir(), 'rail-shots-'));

// fixture projects (non-git dirs are their own Project)
const healthy = mkdtempSync(join(tmpdir(), 'rail-healthy-'));
writeFileSync(
  join(healthy, 'ROADMAP.md'),
  `---
exawatt-roadmap: v1
---

# Acme roadmap

## Now

### ACME-003 Billing export pipeline

Status: now — started 2026-07-02.

Scope:

- CSV export of invoices
- month-end summary rollup

Exit criteria:

- finance downloads the month-end CSV without engineering help

Milestones:

- [x] M1 schema
- [ ] M2 export endpoint
- [ ] M3 dashboard tile

## Next

### ACME-007 Webhooks for partner sync

### ACME-009 Audit log surface

Status: blocked — waiting on retention decision.

## Later

### Dark mode

### ACME-011 Self-serve billing portal

## Shipped

### ACME-001 Auth

### ACME-002 Team invites
`
);
const empty = mkdtempSync(join(tmpdir(), 'rail-empty-'));
writeFileSync(
  join(empty, 'ROADMAP.md'),
  `## Shipped

### DONE-1 The only thing

Status: done — shipped long ago.
`
);
// deterministic inference fixture: a real git repo whose BRANCH carries the
// item id, so the link is high-confidence regardless of this checkout's
// commit history (which other agents churn)
import { execSync } from 'node:child_process';
const gitFix = mkdtempSync(join(tmpdir(), 'rail-git-'));
writeFileSync(
  join(gitFix, 'ROADMAP.md'),
  `## Now

### FIX-042 Probe pipeline

Status: now

Milestones:

- [x] P1 scaffold
- [ ] P2 wire up
`
);
execSync(
  'git init -q -b fix-042-probe && git add ROADMAP.md && git -c user.email=e@x -c user.name=t commit -qm "FIX-042 probe work"',
  { cwd: gitFix }
);

const bare = mkdtempSync(join(tmpdir(), 'rail-none-'));
mkdirSync(join(bare, 'src'), { recursive: true });

const openProject = (page, dir) =>
  page.evaluate(d => {
    window.dispatchEvent(new CustomEvent('exawatt:open-project', { detail: d }));
  }, dir);

const railText = page =>
  page.evaluate(
    () => document.querySelector('[data-roadmap-rail]')?.innerText ?? ''
  );

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('[rail] shot', name);
};

await withElectronApp(
  {
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: mkdtempSync(join(tmpdir(), 'rail-ud-')),
      EXAWATT_DEV_URL: `${BASE}/workspace`,
    },
  },
  async (_app, page) => {
    page.setDefaultTimeout(20_000);
    const results = {};

    const summonComposer = async () => {
      const toggle = page.locator(
        '[data-composer-toggle][aria-expanded="false"]'
      );
      if ((await toggle.count()) > 0) await toggle.click();
      await page.locator('[data-agent-composer]').waitFor();
    };
    const railFocused = () =>
      page.evaluate(
        () => !!document.activeElement?.closest('[data-roadmap-rail]')
      );
    const inSessions = () => page.url().includes('view=sessions');
    const toTerminal = async () => {
      for (let i = 0; i < 3 && inSessions(); i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    };

    await page.locator('[data-workspace-chrome]').waitFor();
    await page.waitForTimeout(1200);
    // S12: the Terminal view carries NO rail and no strip — the lens lives
    // at the Sessions altitude
    results.terminalHasNoRail =
      (await page.locator('[data-roadmap-rail]').count()) === 0;
    await shot(page, '0-terminal-no-rail');

    // healthy fixture
    await openProject(page, healthy);
    await page.waitForTimeout(1800);
    await summonComposer();
    await page.getByRole('button', { name: /Open shell in / }).click();
    await page.locator('.xterm-helper-textarea').last().waitFor();

    // ⌘B from Terminal = Sessions with the rail focused
    await page.keyboard.press('Meta+b');
    await page.waitForURL('**view=sessions**');
    await page.locator('[data-roadmap-rail]').waitFor();
    await page.waitForTimeout(700);
    results.cmdBLandsInSessions = inSessions();
    results.cmdBFocusesRail = await railFocused();
    await shot(page, '1-sessions-rail');

    // S7: the header sequence bar renders the whole queue as one line
    results.sequenceBar =
      (await page.locator('[data-roadmap-sequence]').count()) === 1;
    const text = await railText(page);
    results.heroVisible = text.includes('ACME-003');
    results.milestoneReadout = text.includes('Next up:');
    results.blockedBadge = /blocked/i.test(text);
    results.shippedCollapsed = text.includes('2 shipped');
    results.trustLine = text.includes('7 items');
    results.readOnlyFooter = text.includes('Read-only');
    // the plain shell session matches no item → visibly unmapped (S3)
    results.unmappedShelf = text.includes('not linked to an item');

    // live update (S5): an on-disk edit reparses without any focus change
    appendFileSync(join(healthy, 'ROADMAP.md'), '\n### ACME-013 Live probe\n');
    await page.waitForTimeout(2000);
    results.liveUpdate = (await railText(page)).includes('8 items');
    await shot(page, '2-live-update');

    // keyboard walk + drill + milestone roving (S7/R2)
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    await page.click('[data-roadmap-row="ACME-003"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await shot(page, '3-drilled');
    results.drillShowsDetail = (await railText(page)).includes('Roadmap ·');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    results.milestoneRoving =
      (await page
        .locator('[data-roadmap-milestone][data-selected]')
        .count()) === 1;
    await page.getByRole('button', { name: 'Back to queue' }).click();
    await page.waitForTimeout(300);
    results.backReturnsToQueue = !(await railText(page)).includes('Roadmap ·');

    // S12: Escape at queue level leaves rail FOCUS but the rail stays — it
    // is a fixture of the Sessions altitude, not a dismissable panel
    await page.locator('[data-roadmap-rail]').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    results.escKeepsRailVisible =
      (await page.locator('[data-roadmap-rail]').count()) === 1;
    results.escReturnsToTiles = await page.evaluate(
      () => !!document.activeElement?.closest('[data-expose-tile]')
    );
    results.stillInSessions = inSessions();
    await shot(page, '4-esc-to-tiles');

    // ⌘B inside Sessions refocuses the rail
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(400);
    results.cmdBRefocusesRail = await railFocused();

    // shipped group expands
    await page.getByRole('button', { name: /shipped/ }).click();
    await page.waitForTimeout(300);
    results.shippedExpands = (await railText(page)).includes('ACME-001');
    await shot(page, '5-shipped-expanded');

    await toTerminal();

    // declare-at-launch (S4): link an item through Agent launch options; the
    // new Agent shows as a SOLID (declared) chip in the Sessions rail
    await summonComposer();
    await page.getByLabel('Agent launch options').click();
    await page.selectOption(
      'select[aria-label="Roadmap item this session will work on"]',
      'ACME-007'
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(1500);
    await page.keyboard.press('Meta+b');
    await page.waitForURL('**view=sessions**');
    await page.locator('[data-roadmap-rail]').waitFor();
    await page.waitForTimeout(600);
    results.declaredBadge = (await railText(page)).includes('▸1');
    results.chipRowInQueue =
      (await page
        .locator('[data-roadmap-rail] [data-roadmap-chip]')
        .count()) >= 1;
    await page.click('[data-roadmap-row="ACME-007"]');
    await page.waitForTimeout(400);
    results.declaredChipInDetail = (await railText(page)).includes('Sessions');
    results.declaredChipSolid = await page.evaluate(() => {
      const chip = document.querySelector(
        '[data-roadmap-rail] [data-roadmap-chip]'
      );
      return chip ? getComputedStyle(chip).borderStyle === 'solid' : false;
    });
    await shot(page, '6-declared-chip');
    await page.keyboard.press('Escape'); // drill → queue
    await toTerminal();

    // S8: declare a session on the BLOCKED item — its tab badge goes amber
    // through the same needs-you pipeline as terminal bells
    await summonComposer();
    await page.getByLabel('Agent launch options').click();
    await page.selectOption(
      'select[aria-label="Roadmap item this session will work on"]',
      'ACME-009'
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(1500);
    results.blockedTabBadge =
      (await page.locator('[data-project] [data-attention]').count()) >= 1;
    await shot(page, '6b-blocked-attention');

    // S9: exposé tiles mirror what each agent is executing
    await page.keyboard.press('Control+Meta+2');
    await page.waitForTimeout(900);
    results.exposeMirror =
      (await page.locator('[data-expose-roadmap-item]').count()) >= 2;
    await shot(page, '6c-expose-mirror');
    await toTerminal();

    // empty queue — the designed "no food" moment. ⌘J with no PTY attention
    // pending lands in SESSIONS on the starving rail (S8 + S12)
    await openProject(page, empty);
    await page.waitForTimeout(1500);
    await summonComposer();
    await page.getByRole('button', { name: /Open shell in / }).click();
    await page.waitForTimeout(1500);
    await page.keyboard.press('Meta+j');
    await page.waitForURL('**view=sessions**');
    await page.locator('[data-roadmap-rail]').waitFor();
    await page.waitForTimeout(600);
    results.starvingJumpOpensSessions = inSessions();
    results.emptyQueueHero = (await railText(page)).includes('Queue empty');
    await shot(page, '7-empty-queue');

    // S12: roving the overview selection re-scopes the rail to that tile's
    // Project — hover a healthy-fixture tile and the plan follows
    await page.hover(
      `[data-expose-project="${healthy}"] [data-expose-tile]`
    );
    await page.waitForTimeout(900);
    results.selectionScopesRail = (await railText(page)).includes('ACME-003');
    await shot(page, '7b-selection-scoped');
    // park the cursor on neutral background: a stationary mouse over a tile
    // position must not influence later overlay opens
    await page.mouse.move(8, 300);
    await toTerminal();

    // no roadmap at all
    await openProject(page, bare);
    await page.waitForTimeout(1500);
    await page.keyboard.press('Meta+b');
    await page.waitForURL('**view=sessions**');
    await page.locator('[data-roadmap-rail]').waitFor();
    await page.waitForTimeout(800);
    results.noRoadmapState = (await railText(page)).includes(
      'No roadmap found'
    );
    await shot(page, '8-no-roadmap');
    await toTerminal();

    // the real exawatt roadmap still renders (content sanity only)
    await openProject(page, process.cwd());
    await page.waitForTimeout(2500);
    await page.keyboard.press('Meta+b');
    await page.waitForURL('**view=sessions**');
    await page.locator('[data-roadmap-rail]').waitFor();
    await page.waitForTimeout(1200);
    results.realRepoRenders = (await railText(page)).includes('ENG-');
    await shot(page, '9-exawatt-real');
    await toTerminal();

    // deterministic inference (S3): the git fixture's branch carries the
    // item id → high-confidence link, chip badge, reciprocal context chip
    await openProject(page, gitFix);
    await page.waitForTimeout(2500);
    await summonComposer();
    await page.getByRole('button', { name: /Open shell in / }).click();
    await page.locator('.xterm-helper-textarea').last().waitFor();
    await page.waitForTimeout(1500);
    const contextBar = await page.evaluate(
      () =>
        document.querySelector('[data-active-session-context]')?.textContent ??
        ''
    );
    results.reciprocalChip = contextBar.includes('FIX-042');
    await shot(page, '9b-git-fixture');

    // the reciprocal chip now SUMMONS Sessions drilled into its item (S12)
    if (results.reciprocalChip) {
      await page.click(
        '[data-active-session-context] button[title*="open in roadmap"]'
      );
      await page.waitForURL('**view=sessions**');
      await page.locator('[data-roadmap-rail]').waitFor();
      await page.waitForTimeout(800);
      const drillText = await railText(page);
      results.reciprocalDrill =
        drillText.includes('Roadmap · FIX-042') && drillText.includes('Sessions');
      results.inferredChipBadge = drillText.includes('FIX-042');
      await shot(page, '10-reciprocal-drill');
    }

    console.log(JSON.stringify({ out: OUT, results }, null, 2));
    const failed = Object.entries(results).filter(([, v]) => v !== true);
    if (failed.length) {
      console.error('[rail] FAILED checks:', failed.map(([k]) => k).join(', '));
      process.exitCode = 1;
    } else {
      console.log('[rail] all checks passed');
    }
  },
  { maxMs: 180_000 }
);
