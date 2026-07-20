#!/usr/bin/env node
// ENG-017 S2: drive the roadmap rail end-to-end — strip, ⌘B summon, keyboard
// walk, drill, empty-queue and no-roadmap states — and screenshot each state.
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

    await page.locator('[data-workspace-chrome]').waitFor();
    await page.waitForTimeout(1200);
    await shot(page, '0-initial-strip');

    // healthy fixture: strip → ⌘B open → keyboard walk → drill → back
    await openProject(page, healthy);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /Open shell in / }).click();
    await page.locator('.xterm-helper-textarea').last().waitFor();
    await shot(page, '1-healthy-strip');

    // S6: the strip is a readable spine — one node per item, exactly one
    // CURRENT node (attachment, falling back to the now station), and the
    // blocked item visible even while collapsed
    results.stripSpineNodes = await page
      .locator('[data-strip-item]')
      .count()
      .then(n => n >= 6);
    results.stripCurrentNode = await page
      .locator('[data-strip-node="current"]')
      .count()
      .then(n => n === 1);
    results.stripBlockedVisible = await page
      .locator('[data-strip-item="ACME-009"]')
      .count()
      .then(n => n === 1);
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(700);
    await shot(page, '2-healthy-open');
    // S7: the header sequence bar renders the whole queue as one line
    results.sequenceBar = await page
      .locator('[data-roadmap-sequence]')
      .count()
      .then(n => n === 1);
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
    await shot(page, '2b-live-update');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    await shot(page, '3-selection-moved');
    // Drill the item that owns milestones so the detail's roving-milestone
    // contract is tested deliberately rather than depending on queue order.
    await page.click('[data-roadmap-row="ACME-003"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await shot(page, '4-drilled');
    results.drillShowsDetail = (await railText(page)).includes('Roadmap ·');
    // S7 (R2): ↑↓ roves the milestone spine inside the drill
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    results.milestoneRoving = await page
      .locator('[data-roadmap-milestone][data-selected]')
      .count()
      .then(n => n === 1);
    await page.getByRole('button', { name: 'Back to queue' }).click();
    await page.waitForTimeout(300);
    results.backReturnsToQueue = !(await railText(page)).includes('Roadmap ·');

    // Escape at queue level backs out of the lens entirely (project-scoped):
    // the rail collapses to the strip and the terminal takes focus
    await page.locator('[data-roadmap-rail]').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    results.escCollapsesRail = await page
      .locator('[data-roadmap-rail]')
      .count()
      .then(n => n === 0);
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(500);

    // shipped group expands
    await page.getByRole('button', { name: /shipped/ }).click();
    await page.waitForTimeout(300);
    results.shippedExpands = (await railText(page)).includes('ACME-001');
    await shot(page, '5-shipped-expanded');

    // The shipped control owns focus inside the rail, so ⌘B should collapse
    // and hand focus back to the terminal.
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(400);
    results.cmdBCollapses = !(await page
      .locator('[data-roadmap-rail]')
      .count()
      .then(n => n > 0));
    await shot(page, '6-collapsed-again');

    // declare-at-launch (S4): link an item through Agent launch options; the
    // new Agent shows as a SOLID (declared) chip
    await page.getByLabel('Agent launch options').click();
    await page.selectOption(
      'select[aria-label="Roadmap item this session will work on"]',
      'ACME-007'
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(1500);
    await page
      .getByRole('button', { name: /Open roadmap rail/ })
      .click();
    await page.waitForTimeout(600);
    // Collapsing preserves the prior drill address; return to the queue before
    // inspecting the newly declared item.
    if ((await page.locator('[data-roadmap-row="ACME-007"]').count()) === 0) {
      await page.getByRole('button', { name: 'Back to queue' }).click();
      await page.waitForTimeout(300);
    }
    results.declaredBadge = (await railText(page)).includes('▸1');
    // S7: the declared session renders as a focusable chip ROW on its
    // (next) item, not only a count badge
    results.chipRowInQueue = await page
      .locator('[data-roadmap-rail] [data-roadmap-chip]')
      .count()
      .then(n => n >= 1);
    await page.click('[data-roadmap-row="ACME-007"]');
    await page.waitForTimeout(400);
    results.declaredChipInDetail = (await railText(page)).includes('Sessions');
    results.declaredChipSolid = await page.evaluate(() => {
      const chip = document.querySelector(
        '[data-roadmap-rail] [data-roadmap-chip]'
      );
      return chip ? getComputedStyle(chip).borderStyle === 'solid' : false;
    });
    await shot(page, '6b-declared-chip');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+b');
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(300);

    // S8: declare a session on the BLOCKED item — its tab badge goes amber
    // through the same needs-you pipeline as terminal bells
    await page.getByLabel('Agent launch options').click();
    await page.selectOption(
      'select[aria-label="Roadmap item this session will work on"]',
      'ACME-009'
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(1500);
    results.blockedTabBadge = await page
      .locator('[data-project] [data-attention]')
      .count()
      .then(n => n >= 1);
    await shot(page, '6c-blocked-attention');

    // S9: exposé tiles mirror what each agent is executing
    await page.keyboard.press('Meta+Shift+2');
    await page.waitForTimeout(900);
    results.exposeMirror = await page
      .locator('[data-expose-roadmap-item]')
      .count()
      .then(n => n >= 2);
    await shot(page, '6d-expose-mirror');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // empty queue — the designed "no food" moment
    await openProject(page, empty);
    await page.waitForTimeout(1500);
    // S8: launch a live session here so the project is STARVING, then ⌘J
    // (with no PTY attention pending) opens the rail on the no-food moment
    await page.getByRole('button', { name: /Open shell in / }).click();
    await page.waitForTimeout(1500);
    // deterministically collapse first so ⌘J is what opens the rail
    for (let i = 0; i < 3 && (await page.locator('[data-roadmap-rail]').count()); i++) {
      await page.keyboard.press('Meta+b');
      await page.waitForTimeout(350);
    }
    results.railCollapsedBeforeJump =
      (await page.locator('[data-roadmap-rail]').count()) === 0;
    await page.keyboard.press('Meta+j');
    await page.waitForTimeout(800);
    results.starvingJumpOpensRail = await page
      .locator('[data-roadmap-rail]')
      .count()
      .then(n => n === 1);
    const emptyText = await railText(page);
    results.emptyQueueHero = emptyText.includes('Queue empty');
    await shot(page, '7-empty-queue');
    // rail stays OPEN here — the tail sections read it directly

    // no roadmap at all
    await openProject(page, bare);
    await page.waitForTimeout(1500);
    const noneText = await railText(page);
    results.noRoadmapState = noneText.includes('No roadmap found');
    await shot(page, '8-no-roadmap');

    // the real exawatt roadmap still renders (content sanity only — link
    // inference against the live checkout is history-dependent)
    await openProject(page, process.cwd());
    await page.waitForTimeout(2500);
    const exaText = await railText(page);
    results.realRepoRenders = exaText.includes('ENG-');
    await shot(page, '9-exawatt-real');

    // deterministic inference (S3): the git fixture's branch carries the
    // item id → high-confidence link, chip badge, reciprocal context chip
    await openProject(page, gitFix);
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Open shell in / }).click();
    await page.locator('.xterm-helper-textarea').last().waitFor();
    await page.waitForTimeout(1000);
    const fixText = await railText(page);
    results.inferredChipBadge = fixText.includes('▸1') || fixText.includes('FIX-042');
    const contextBar = await page.evaluate(
      () =>
        document.querySelector('[data-active-session-context]')?.textContent ?? ''
    );
    results.reciprocalChip = contextBar.includes('FIX-042');
    await shot(page, '9b-git-fixture');

    // reciprocal chip click opens the rail drilled into the item with the
    // session chip in the detail panel
    if (results.reciprocalChip) {
      await page.click('[data-active-session-context] button[title*="open in roadmap"]');
      await page.waitForTimeout(600);
      const drillText = await railText(page);
      results.reciprocalDrill =
        drillText.includes('Roadmap · FIX-042') && drillText.includes('Sessions');
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
  { maxMs: 120_000 }
);
