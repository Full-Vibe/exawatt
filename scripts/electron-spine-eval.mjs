#!/usr/bin/env node
/**
 * Navigation-spine eval (ENG-016 D8): the altitude rail is present on every
 * Electron surface, spine affordances never link into legacy pages, go-chords
 * cover all three altitudes, ⌘[/⌘] traverse history while chrome owns focus,
 * and ⌘K is project-first (recents survive, add-project exists, signed-out
 * state is visible). Requires the dev server (`pnpm dev`) and a compiled
 * Electron main (`pnpm electron:compile`).
 */
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.env.NAV_SCREENSHOT_DIR || '/tmp/exawatt-spine-eval';
mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'exawatt-spine-eval-'));

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_DEV_URL: 'http://localhost:7000/workspace',
  },
});

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e =>
    console.log('[pageerror]', String(e.message || e).slice(0, 300))
  );
  page.on('console', m => {
    if (
      m.type() === 'error' &&
      !m.text().includes('eval() is not supported')
    ) {
      console.log('[console]', m.text().slice(0, 300));
    }
  });
  await page.locator('[data-command-altitude]').waitFor();

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

  // spine affordances never link into legacy: no "← Fleet" on Spatial
  const backLink = await page.locator('a[href="/fleet"]').count();
  check('spatial has no /fleet back link', backLink === 0);
  await page.screenshot({ path: join(OUT, 'spatial-no-backlink.png') });

  // project-first ⌘K: spine vocabulary, Legacy group, add-project, signed-out row
  await page.keyboard.press('Meta+Shift+KeyM');
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

  // recents survive: launching a session records the Project durably
  await page.getByLabel('Working directory for new sessions').fill('/tmp');
  await page.getByTitle(/Launch a new Shell session/).click();
  await page.waitForFunction(
    async () => (await window.electron?.pty?.list())?.length === 1
  );
  await page.waitForTimeout(1200); // debounced save
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
  // wait for the exposé to actually mount before toggling it closed —
  // ⌘O within the mount race would re-open instead
  await page.locator('[data-expose-tile]').first().waitFor();
  await page.waitForTimeout(400);
  await page.keyboard.press('Meta+KeyO'); // toggle the overview closed
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
} finally {
  await app.close();
}

if (failures.length > 0) {
  console.error(`FAIL navigation spine: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log(
  'PASS navigation spine: rail everywhere, legacy buried, history live, ⌘K project-first'
);
console.log(`Screenshots: ${OUT}`);
