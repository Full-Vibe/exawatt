#!/usr/bin/env node
// ENG-017 S2: drive the roadmap rail end-to-end — strip, ⌘B summon, keyboard
// walk, drill, empty-queue and no-roadmap states — and screenshot each state.
// Run with EXA_BASE pointing at a dev server serving THIS checkout.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
    await shot(page, '1-healthy-strip');
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(700);
    await shot(page, '2-healthy-open');
    const text = await railText(page);
    results.heroVisible = text.includes('ACME-003');
    results.milestoneReadout = text.includes('m2') || text.includes('M2');
    results.blockedBadge = text.includes('blocked');
    results.shippedCollapsed = text.includes('2 shipped');
    results.trustLine = text.includes('7 items');
    results.readOnlyFooter = text.includes('read-only');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    await shot(page, '3-selection-moved');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await shot(page, '4-drilled');
    results.drillShowsDetail = (await railText(page)).includes('roadmap ·');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    results.escReturnsToQueue = !(await railText(page)).includes('roadmap ·');

    // shipped group expands
    await page.keyboard.press('g');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    results.shippedExpands = (await railText(page)).includes('ACME-001');
    await shot(page, '5-shipped-expanded');

    // ⌘B while focused → collapses to strip
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(400);
    results.cmdBCollapses = !(await page
      .locator('[data-roadmap-rail]')
      .count()
      .then(n => n > 0));
    await shot(page, '6-collapsed-again');

    // empty queue — the designed "no food" moment
    await openProject(page, empty);
    await page.waitForTimeout(1500);
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(600);
    const emptyText = await railText(page);
    results.emptyQueueHero = emptyText.includes('Queue empty');
    await shot(page, '7-empty-queue');

    // no roadmap at all
    await openProject(page, bare);
    await page.waitForTimeout(1500);
    const noneText = await railText(page);
    results.noRoadmapState = noneText.includes('No roadmap found');
    await shot(page, '8-no-roadmap');

    // the real exawatt roadmap (worktree resolves to the main repo)
    await openProject(page, process.cwd());
    await page.waitForTimeout(1800);
    const exaText = await railText(page);
    results.realRepoRenders = exaText.includes('ENG-');
    await shot(page, '9-exawatt-real');

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
