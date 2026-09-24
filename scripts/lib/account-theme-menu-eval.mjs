import assert from 'node:assert/strict';

/** Exercise the real account menu: DOM visibility cannot detect an ancestor
 * clipping a submenu. A successful unforced click proves hit-testing too. */
export async function verifyAccountThemeMenu(page) {
  const originalViewport = page.viewportSize();
  const account = page.getByRole('button', {
    name: 'Account and Workspace menu',
  });
  const theme = page.locator('[data-account-theme-menu]');
  const air = page.getByRole('menuitemradio', { name: 'Air', exact: true });

  try {
    for (const viewport of [
      { width: 1312, height: 700 },
      { width: 420, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await account.click();
      await theme.hover();
      await air.waitFor();
      // Real pointer movement crosses the trigger before entering the popup;
      // teleporting misses Radix's direction-aware pointer-grace corridor.
      const entry = await page
        .getByRole('menuitemradio', { name: 'Auto', exact: true })
        .boundingBox();
      assert.ok(entry);
      await page.mouse.move(
        entry.x + entry.width / 2,
        entry.y + entry.height / 2,
        { steps: 12 }
      );
      // Clicking without force waits for both stable geometry and actual
      // pointer reachability; this fails for the clipped, unportalled popup.
      await air.click();
      await page.waitForFunction(
        () => document.documentElement.dataset.exaTheme === 'exawatt-air-light'
      );
      await page.waitForFunction(() =>
        document.activeElement?.hasAttribute('data-account-menu-trigger')
      );
      assert.equal(await page.getByRole('menu').count(), 0);

      await account.press('Enter');
      await theme.focus();
      await theme.press('ArrowRight');
      await air.waitFor();
      assert.equal(await air.getAttribute('aria-checked'), 'true');
      // Keyboard traversal must reach every choice, including the last one
      // when a short viewport requires the menu to scroll.
      const choices = page.getByRole('menuitemradio');
      const last = choices.last();
      await page.keyboard.press('End');
      await page.waitForFunction(() => {
        const choices = document.querySelectorAll('[role="menuitemradio"]');
        return choices[choices.length - 1] === document.activeElement;
      });
      const box = await last.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0);
      assert.ok(box.x + box.width <= viewport.width);
      assert.ok(box.y + box.height <= viewport.height);
      assert.equal(
        await last.evaluate(el => {
          const box = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2
            )
          );
        }),
        true
      );
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() =>
        document.activeElement?.hasAttribute('data-account-theme-menu')
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(() =>
        document.activeElement?.hasAttribute('data-account-menu-trigger')
      );
      assert.equal(await page.getByRole('menu').count(), 0);
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  return { tested: ['pointer selection', 'keyboard', 'focus', 'viewport'] };
}
