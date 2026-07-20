#!/usr/bin/env node
/**
 * Navigation-spine eval (ENG-016 D8): the altitude rail is present on every
 * Electron surface, spine affordances never link into legacy pages, go-chords
 * cover all three altitudes, ⌘[/⌘] traverse history while chrome owns focus,
 * and ⌘K is project-first (recents survive, add-project exists, signed-out
 * state is visible). Requires the dev server (`pnpm dev`) and a compiled
 * Electron main (`pnpm electron:compile`).
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const OUT = process.env.NAV_SCREENSHOT_DIR || '/tmp/exawatt-spine-eval';
mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'exawatt-spine-eval-'));

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

await withElectronApp(
  {
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: userData,
      EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
    },
  },
  async (app, page) => {
  page.setDefaultTimeout(15000);
  page.on('pageerror', e =>
    console.log('[pageerror]', String(e.message || e).slice(0, 300))
  );
  const markupWarnings = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (m.text().includes('eval() is not supported')) return;
    if (
      m.text().includes('cannot contain a nested') ||
      m.text().includes('cannot be a descendant')
    ) {
      markupWarnings.push(m.text().slice(0, 120));
    }
    console.log('[console]', m.text().slice(0, 300));
  });
  await page.locator('[data-command-altitude]').waitFor();
  check(
    'altitude rail is a no-drag title-bar island',
    (await page
      .locator('[data-command-altitude]')
      .evaluate(element => getComputedStyle(element).webkitAppRegion)) ===
      'no-drag'
  );

  // the menu bar mirrors the app's verbs (W4): Go/Session menus exist,
  // Settings… registers ⌘, for real, renderer-owned combos display-only
  const menuDump = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items.map(i => ({
      label: i.label,
      sub: i.submenu?.items.map(
        s => `${s.label}|${s.accelerator ?? ''}|reg:${s.registerAccelerator}`
      ),
    }))
  );
  const goMenu = menuDump.find(m => m.label === 'Go');
  check(
    'menu bar has Go and Session menus',
    !!goMenu && menuDump.some(m => m.label === 'Session')
  );
  check(
    'Settings… registers Command+,',
    menuDump[0].sub.some(s => s.startsWith('Settings…|Command+,|reg:true'))
  );
  check(
    'Go>Back displays Command+[ without registering it',
    goMenu.sub.some(s => s.includes('Back|Command+[|reg:false'))
  );
  for (const [label, accelerator] of [
    ['Terminal', 'Command+1'],
    ['Sessions', 'Command+2'],
    ['Spatial', 'Command+3'],
  ]) {
    check(
      `Go>${label} displays ${accelerator} without registering it`,
      goMenu.sub.some(s => s.includes(`${label}|${accelerator}|reg:false`))
    );
  }

  // D10: menu accelerators follow the registry — sync a rebind, read it back
  await page.evaluate(() =>
    window.electron.menu.syncAccelerators({ 'rename-tab': 'Command+Shift+E' })
  );
  await page.waitForTimeout(500);
  const sessionMenu = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find(i => i.label === 'Session')
      .submenu.items.map(s => `${s.label}|${s.accelerator ?? ''}`)
  );
  check(
    'Session menu accelerator follows a rebind sync',
    sessionMenu.includes('Rename Session|Command+Shift+E')
  );
  await page.evaluate(() =>
    window.electron.menu.syncAccelerators({ 'rename-tab': 'Command+E' })
  );

  // legacy stays reachable via its chord — and the spine follows you there
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyF');
  await page.waitForURL('**/fleet');
  await page.waitForTimeout(800);
  check('g f reaches /fleet', page.url().endsWith('/fleet'));
  check(
    'rail visible on legacy /fleet',
    await page.locator('[data-command-altitude]').isVisible()
  );
  await page.screenshot({ path: join(OUT, 'fleet-with-rail.png') });

  // bounded history: ⌘[ answers "where I just was", ⌘] re-advances
  await page.keyboard.press('Meta+BracketLeft');
  await page.waitForTimeout(900);
  check('cmd+[ goes back to /workspace', page.url().includes('/workspace'));
  await page.keyboard.press('Meta+BracketRight');
  await page.waitForTimeout(900);
  check('cmd+] goes forward to /fleet', page.url().endsWith('/fleet'));

  // the rail is a live exit from legacy pages
  await page.locator('[data-command-altitude-level="terminal"]').click();
  await page.waitForURL('**/workspace');
  check('rail Terminal click works from /fleet', true);

  // go-chords cover all three altitudes
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyO');
  await page.waitForTimeout(900);
  check('g o reaches sessions view', page.url().includes('view=sessions'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(1200);
  check('g m reaches spatial', page.url().includes('/fleet/spatial'));

  // D11: a focused search field keeps text, but modified global commands must
  // still provide an escape path back to Terminal.
  const spatialSearch = page.getByLabel('Search agents');
  await spatialSearch.fill('operator query');
  await page.keyboard.press('Meta+Shift+1');
  await page.waitForURL('**/workspace');
  check('cmd+1 returns from focused Spatial search', true);
  await page.keyboard.press('Meta+Shift+3');
  await page.waitForURL('**/fleet/spatial');

  // spine affordances never link into legacy: no "← Fleet" on Spatial
  const backLink = await page.locator('a[href="/fleet"]').count();
  check('spatial has no /fleet back link', backLink === 0);
  await page.screenshot({ path: join(OUT, 'spatial-no-backlink.png') });

  // project-first ⌘K: spine vocabulary, Legacy group, add-project, signed-out row
  await page.keyboard.press('Meta+Shift+1');
  await page.waitForTimeout(800);
  await page.keyboard.press('Meta+KeyK');
  await page.waitForTimeout(700);
  const paletteText = await page.locator('[cmdk-list]').innerText();
  check('palette has Go to Terminal', paletteText.includes('Go to Terminal'));
  check('palette has Go to Sessions', paletteText.includes('Go to Sessions'));
  check('palette has Go to Spatial', paletteText.includes('Go to Spatial'));
  check('palette has Legacy group', paletteText.includes('Legacy'));
  check('palette has Add project row', paletteText.includes('Add project'));
  check(
    'palette shows signed-out Projects state',
    paletteText.includes('Sign in to sync Projects')
  );
  await page.screenshot({ path: join(OUT, 'palette-project-first.png') });
  await page.keyboard.press('Escape');

  // Recents survive independently of live PTYs. Seed one stopped Session in
  // the isolated workspace store; reload proves the durable navigation state
  // without depending on the host login shell remaining alive.
  await page.evaluate(() =>
    window.electron.workspace.save({
      v: 5,
      lastUsedDir: '/tmp',
      activeDir: '/tmp',
      pinnedTabId: null,
      recentProjects: [
        {
          dir: '/tmp',
          name: 'Temporary Project',
          lastOpenedAt: Date.now(),
        },
      ],
      projects: [
        {
          dir: '/tmp',
          name: 'Temporary Project',
          color: '#19E6FF',
          activeTabId: 'spine-tab',
          tabs: [
            {
              id: 'spine-tab',
              durableSessionId: 'spine-session',
              harness: 'shell',
              title: 'Navigation Session',
              cwd: '/tmp',
              sessionId: null,
              harnessSessionId: null,
              roadmapItemId: null,
              lifecycle: 'stopped-clean',
              exitCode: 0,
            },
          ],
        },
      ],
    })
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-command-altitude]').waitFor();
  const persisted = await page.evaluate(() => window.electron.workspace.load());
  check(
    'recentProjects persisted in workspace layout',
    Array.isArray(persisted?.recentProjects) &&
      persisted.recentProjects.some(r => r.dir === '/tmp')
  );

  // ---- D9: keyboard authority, searchable help, recents, titles ----

  // per-surface titles via the metadata template
  check(
    'workspace title is Terminal — Exawatt',
    (await page.title()) === 'Terminal — Exawatt'
  );

  // registry-resolved workspace verb still fires: ⌘E opens the rename editor
  await page.keyboard.press('Meta+KeyE');
  await page.waitForTimeout(500);
  const renameFocused = await page.evaluate(
    () => document.activeElement?.tagName === 'INPUT'
  );
  check('cmd+E opens the inline rename editor', renameFocused);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // searchable help overlay lists workspace verbs dynamically
  await page.keyboard.press('Meta+Slash');
  await page.waitForTimeout(600);
  const helpFilter = page.getByLabel('Filter shortcuts');
  check('help overlay has a filter input', await helpFilter.isVisible());
  const wsSection = page.locator('[data-help-category="workspace"]');
  check(
    'help lists workspace verbs dynamically',
    (await wsSection.innerText()).includes('Rename the active tab')
  );
  await helpFilter.fill('rename');
  await page.waitForTimeout(300);
  const filtered = (
    await page.locator('[data-help-category]').allInnerTexts()
  ).join(' ');
  check(
    'help filter narrows to matching rows',
    filtered.includes('Rename the active tab') &&
      !filtered.includes('Overview of all sessions')
  );
  await helpFilter.fill('projection');
  await page.waitForTimeout(300);
  check(
    'help makes Spatial raw keys searchable',
    (await page.locator('[data-help-category="view"]').innerText()).includes(
      'Spatial: toggle projection'
    )
  );
  // chord gating: g d behind the open modal must not navigate
  await page.keyboard.press('Shift+Tab'); // leave the filter input
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyD');
  await page.waitForTimeout(700);
  check(
    'g d behind the help modal does not navigate',
    page.url().includes('/workspace')
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // palette recents: selecting a command makes it appear in Recent on reopen
  await page.keyboard.press('Meta+KeyK');
  await page.waitForTimeout(600);
  await page
    .locator('[cmdk-item]')
    .filter({ hasText: 'Go to Sessions' })
    .first()
    .click();
  await page.waitForURL('**view=sessions**');
  // wait for the exposé to mount before dismissing it hierarchically
  await page.locator('[data-expose]').waitFor();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForURL(url => !url.href.includes('view=sessions'));
  await page.waitForTimeout(400);
  // dev-mode Fast Refresh can momentarily detach listeners — retry the
  // palette open a bounded number of times before judging it broken
  let paletteEmptyText = '';
  for (let attempt = 0; attempt < 3 && !paletteEmptyText; attempt++) {
    await page.keyboard.press('Meta+KeyK');
    await page.waitForTimeout(800);
    paletteEmptyText = await page
      .locator('[cmdk-list]')
      .innerText({ timeout: 3000 })
      .catch(() => '');
  }
  const recentOk =
    paletteEmptyText.includes('Recent') &&
    paletteEmptyText.includes('Go to Sessions');
  if (!recentOk) {
    console.log(
      '[debug] palette text head:',
      JSON.stringify(paletteEmptyText.slice(0, 200))
    );
  }
  check('palette shows a Recent group after use', recentOk);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // legacy title — reach Fleet Command through the palette's Legacy group
  // (plain-key chords correctly stay dead while the terminal or an input
  // owns focus, so the palette is the honest keyboard path from here)
  await page
    .locator('[cmdk-root]')
    .waitFor({ state: 'detached', timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  await page.keyboard.press('Meta+KeyK');
  await page.waitForTimeout(700);
  await page
    .locator('[cmdk-item]')
    .filter({ hasText: 'Go to Fleet Command' })
    .first()
    .click();
  await page.waitForURL('**/fleet');
  await page.waitForTimeout(600);
  check(
    'fleet title is Fleet Command — Exawatt',
    (await page.title()) === 'Fleet Command — Exawatt'
  );

  // D10: the rename cycle must not produce nested-interactive markup warnings
  check('no nested-interactive markup warnings', markupWarnings.length === 0);
  // Leave the app on Terminal so its workspace checkpoint owner can answer the
  // normal coordinated-quit handshake used by ElectronApplication.close().
  await page.keyboard.press('Meta+Shift+1');
  await page.waitForURL('**/workspace');
  await page.locator('[data-workspace-underlay]').waitFor();
  await page.waitForTimeout(500);
  check('cmd+1 returns from legacy Fleet Command', true);
  },
  // this eval legitimately runs long (33 checks, several navigations)
  { maxMs: 480_000 }
);

if (failures.length > 0) {
  console.error(`FAIL navigation spine: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log(
  'PASS navigation spine: rail everywhere, legacy buried, history live, ⌘K project-first'
);
console.log(`Screenshots: ${OUT}`);
