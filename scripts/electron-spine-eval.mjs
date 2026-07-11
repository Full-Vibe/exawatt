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
