#!/usr/bin/env node
/**
 * Navigation-spine eval (ENG-016 D8, altitude names per decision 0023):
 * the altitude rail (Agent · Team · Fleet) is present on every Electron
 * surface, go-chords cover all three altitudes, the retired legacy demo trio
 * stays gone, ⌘[/⌘] traverse history while chrome owns focus, and ⌘K is
 * project-first (recents survive, add-project exists, signed-out state is
 * visible). Requires the dev server (`pnpm dev`) and a compiled Electron
 * main (`pnpm electron:compile`).
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
  const backButton = page.locator('[data-navigation-back]');
  const forwardButton = page.locator('[data-navigation-forward]');
  await backButton.waitFor();
  check(
    'title bar exposes subtle back/forward controls',
    (await backButton.isVisible()) && (await forwardButton.isVisible())
  );
  check(
    'history controls are no-drag click islands',
    (await backButton.evaluate(
      element => getComputedStyle(element.parentElement).webkitAppRegion
    )) === 'no-drag'
  );
  check(
    'back starts disabled at the history floor',
    await backButton.isDisabled()
  );

  // F1 feedback chip grammar: the screenshot toggle is named in visible UI,
  // not only through accessibility metadata.
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('exawatt:test-feedback-auth', {
        detail: { accessToken: 'test-jwt' },
      })
    );
  });
  await page.waitForTimeout(100);
  await page.keyboard.press('Meta+Shift+KeyF');
  const quickFeedback = page.getByRole('dialog', { name: 'Quick feedback' });
  await quickFeedback.waitFor();
  const screenshotToggle = quickFeedback.getByRole('button', {
    name: 'Attach screenshot',
  });
  check(
    'quick feedback visibly labels the Screenshot chip',
    (await screenshotToggle.innerText()).includes('Screenshot') &&
      (await screenshotToggle.innerText()).includes('⌘S')
  );
  await page.screenshot({
    path: join(OUT, 'quick-feedback-screenshot-label.png'),
  });
  await page.keyboard.press('Escape');

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
  // D19: the altitude family rides ⌃⌘digit (⌘digit = Session tabs since
  // D18; ⌘⇧3 was eaten by macOS screenshots)
  for (const [label, accelerator] of [
    ['Agent', 'Control+Command+1'],
    ['Team', 'Control+Command+2'],
    ['Fleet', 'Control+Command+3'],
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

  // FIX-012: every verb the product offers owes a native menu item derived
  // from the command-verb manifest, not just a chord and a palette row.
  const helpMenu = menuDump.find(m => m.label === 'Help');
  for (const row of [
    'Resume This Agent|Command+Alt+R',
    'Resume Parked Agents|Command+Alt+Shift+R',
  ]) {
    check(
      `Session menu publishes ${row.split('|')[0]}`,
      sessionMenu.includes(row)
    );
  }
  check(
    'Go>Project Roadmap displays Command+B',
    goMenu.sub.some(s => s.includes('Project Roadmap|Command+B|reg:false'))
  );
  check(
    'Help>Submit Feedback… displays Command+Shift+F',
    helpMenu.sub.some(s => s.includes('Command+Shift+F|reg:false'))
  );
  check(
    'Help>Keyboard Shortcuts displays Command+/',
    helpMenu.sub.some(s => s.includes('Keyboard Shortcuts|Command+/|reg:false'))
  );
  // FIX-014: the application menu leads with product identity.
  const appMenuLabels = menuDump[0].sub.map(s => s.split('|')[0]);
  const versionIndex = appMenuLabels.findIndex(l => l.startsWith('Version '));
  const buildIndex = appMenuLabels.findIndex(l => l.startsWith('Build '));
  check('application menu shows the app version', versionIndex > -1);
  check(
    'the build sha stays behind the version',
    buildIndex > versionIndex && buildIndex > -1
  );

  // Menu enablement is renderer-published truth for every verb that declares
  // an availability, resume included.
  await page.evaluate(() =>
    window.electron.menu.syncAvailability({
      'resume-agent': true,
      'resume-scope': true,
    })
  );
  await page.waitForTimeout(500);
  const resumeEnabled = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find(i => i.label === 'Session')
      .submenu.items.filter(s => s.label.startsWith('Resume '))
      .map(s => `${s.label}|${s.enabled}`)
  );
  check(
    'Resume rows follow the availability sync',
    resumeEnabled.length === 2 && resumeEnabled.every(s => s.endsWith('|true'))
  );

  // the spine follows you onto off-spine surfaces (Settings)
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyS');
  await page.waitForURL('**/settings');
  await page.waitForTimeout(800);
  check('g s reaches /settings', page.url().endsWith('/settings'));
  check(
    'rail visible on off-spine /settings',
    await page.locator('[data-command-altitude]').isVisible()
  );
  await page.screenshot({ path: join(OUT, 'settings-with-rail.png') });

  // The visible controls call the exact same app-location owner as ⌘[/⌘].
  check(
    'back enables after cross-surface navigation',
    !(await backButton.isDisabled())
  );
  await backButton.click();
  await page.waitForURL(url => url.pathname.endsWith('/workspace'));
  check('top-bar Back returns to /workspace', true);
  check(
    'forward enables after visible Back',
    !(await forwardButton.isDisabled())
  );
  await forwardButton.click();
  await page.waitForURL(url => url.pathname.endsWith('/settings'));
  check('top-bar Forward returns to /settings', true);

  // bounded history: ⌘[ answers "where I just was", ⌘] re-advances.
  // Bounded URL waits, not fixed sleeps — under load navigation can take
  // longer than any chosen sleep and a race here reads as a spine failure.
  await page.keyboard.press('Meta+BracketLeft');
  const backOk = await page
    .waitForURL(url => url.pathname.endsWith('/workspace'), { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check('cmd+[ goes back to /workspace', backOk);
  await page.keyboard.press('Meta+BracketRight');
  const forwardOk = await page
    .waitForURL(url => url.pathname.endsWith('/settings'), { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check('cmd+] goes forward to /settings', forwardOk);

  // the rail is a live exit from off-spine pages
  await page.locator('[data-command-altitude-level="terminal"]').click();
  await page.waitForURL('**/workspace');
  check('rail Agent click works from /settings', true);

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
  // still provide an escape path back to the Agent altitude.
  const spatialSearch = page.getByLabel('Search agents');
  await spatialSearch.fill('operator query');
  await page.keyboard.press('Control+Meta+1');
  await page.waitForURL('**/workspace');
  check('ctrl+cmd+1 returns from focused Fleet search', true);
  await page.keyboard.press('Control+Meta+3');
  await page.waitForURL('**/fleet/spatial');

  // no affordance links back into the retired legacy trio
  const backLink = await page.locator('a[href="/fleet"]').count();
  check('fleet surface has no legacy /fleet link', backLink === 0);
  await page.screenshot({ path: join(OUT, 'fleet-no-backlink.png') });

  // project-first ⌘K: spine vocabulary, no legacy group, add-project, signed-out row
  await page.keyboard.press('Control+Meta+1');
  await page.waitForTimeout(800);
  await page.keyboard.press('Meta+KeyK');
  await page.waitForTimeout(700);
  const paletteText = await page.locator('[cmdk-list]').innerText();
  check('palette has Go to Agent', paletteText.includes('Go to Agent'));
  check('palette has Go to Team', paletteText.includes('Go to Team'));
  check('palette has Go to Fleet', paletteText.includes('Go to Fleet'));
  check(
    'palette has public Leaderboard destination',
    paletteText.includes('Go to Leaderboard')
  );
  check(
    'palette has no Legacy group (trio retired, decision 0023)',
    !paletteText.includes('Legacy') && !paletteText.includes('Lattice')
  );
  check('palette has Add project row', paletteText.includes('Add project'));
  check(
    'palette shows signed-out Projects state',
    paletteText.includes('Sign in to sync Projects')
  );
  await page.screenshot({ path: join(OUT, 'palette-project-first.png') });

  // ENG-035: public route presentation and command discovery are independent.
  // Search and execute the real row so a manifest-only assertion cannot hide
  // a palette wiring regression.
  await page.getByPlaceholder('Type a command or search...').fill('leaderboard');
  const leaderboardRow = page
    .locator('[cmdk-item]')
    .filter({ hasText: 'Go to Leaderboard' })
    .first();
  check(
    'Leaderboard is searchable in the palette',
    await leaderboardRow.isVisible()
  );
  await leaderboardRow.click();
  await page.waitForURL('**/leaderboard');
  await page.locator('#site-footer').waitFor();
  check(
    'Leaderboard keeps public route presentation after palette navigation',
    await page.locator('#site-footer').isVisible()
  );
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/workspace');
  await page.locator('[data-command-altitude]').waitFor();

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
    'workspace title is Agent — Exawatt',
    (await page.title()) === 'Agent — Exawatt'
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
    'help makes Fleet raw keys searchable',
    (await page.locator('[data-help-category="view"]').innerText()).includes(
      'Fleet: toggle projection'
    )
  );
  // chord gating: g m behind the open modal must not navigate
  await page.keyboard.press('Shift+Tab'); // leave the filter input
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(700);
  check(
    'g m behind the help modal does not navigate',
    page.url().includes('/workspace')
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // palette recents: selecting a command makes it appear in Recent on reopen
  await page.keyboard.press('Meta+KeyK');
  await page.waitForTimeout(600);
  await page
    .locator('[cmdk-item]')
    .filter({ hasText: 'Go to Team' })
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
    paletteEmptyText.includes('Go to Team');
  if (!recentOk) {
    console.log(
      '[debug] palette text head:',
      JSON.stringify(paletteEmptyText.slice(0, 200))
    );
  }
  check('palette shows a Recent group after use', recentOk);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Fleet altitude title via the metadata template
  await page
    .locator('[cmdk-root]')
    .waitFor({ state: 'detached', timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Meta+3');
  await page.waitForURL('**/fleet/spatial**');
  await page.waitForTimeout(600);
  check(
    'fleet title is Fleet — Exawatt',
    (await page.title()) === 'Fleet — Exawatt'
  );

  // D10: the rename cycle must not produce nested-interactive markup warnings
  check('no nested-interactive markup warnings', markupWarnings.length === 0);
  // Leave the app at the Agent altitude so its workspace checkpoint owner can
  // answer the coordinated-quit handshake used by ElectronApplication.close().
  await page.keyboard.press('Control+Meta+1');
  await page.waitForURL('**/workspace');
  await page.locator('[data-workspace-underlay]').waitFor();
  await page.waitForTimeout(500);
  check('ctrl+cmd+1 returns from Fleet', true);
  },
  // this eval legitimately runs long (36 checks, several navigations)
  { maxMs: 480_000 }
);

if (failures.length > 0) {
  console.error(`FAIL navigation spine: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log(
  'PASS navigation spine: rail everywhere, legacy retired, history live, ⌘K project-first'
);
console.log(`Screenshots: ${OUT}`);
