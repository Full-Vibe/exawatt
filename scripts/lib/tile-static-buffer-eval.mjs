import { primeEvalBrowserPage } from './qa-browser.mjs';

/** Algorithmic GPU contract: camera paints may consume static population
 * buffers, but only changed population/presentation inputs may rewrite them. */
export async function verifyStaticTileBuffers(context, base) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await primeEvalBrowserPage(page);
    await page.goto(
      `${base}/hud-gallery/board-study?view=v2&material=gummy&theme=classic&fixture=scale-1000&altitude=fleet`,
      { waitUntil: 'load' }
    );
    await page.waitForFunction(() => {
      const canvas = document.querySelector('[data-board-view="v2"] canvas');
      const evidence = canvas?.boardEvidence;
      let population;
      evidence?.scene.traverse(node => {
        if (
          node.name === 'tile-agent-bodies' &&
          node.userData.boardTileBodyIds?.some(id =>
            id?.startsWith('population:')
          )
        )
          population = node;
      });
      if (!population?.count || !population.instanceMatrix.version)
        return false;
      window.__TILE_BUFFER_PROBE__ = { canvas, evidence, population };
      return true;
    });
    // Let mount-time DOM anchors and the initial camera commit finish.
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    const before = await page.evaluate(() => {
      const { population, evidence } = window.__TILE_BUFFER_PROBE__;
      return {
        version: population.instanceMatrix.version,
        count: population.count,
        frame: evidence.gl.info.render.frame,
        x: evidence.camera.position.x,
        y: evidence.camera.position.y,
      };
    });
    const rect = await page
      .locator('[data-board-view="v2"] canvas')
      .boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel(70, 120);
    await page.waitForFunction(previous => {
      const { evidence } = window.__TILE_BUFFER_PROBE__;
      return (
        evidence.gl.info.render.frame > previous.frame &&
        (evidence.camera.position.x !== previous.x ||
          evidence.camera.position.y !== previous.y)
      );
    }, before);
    const cameraVersion = await page.evaluate(
      () => window.__TILE_BUFFER_PROBE__.population.instanceMatrix.version
    );
    if (cameraVersion !== before.version)
      throw new Error(
        `Static population uploaded during camera input: ${before.version} -> ${cameraVersion}`
      );

    await page.getByRole('link', { name: 'air', exact: true }).click();
    await page.waitForURL(/theme=air/);
    await page.waitForFunction(
      previous =>
        window.__TILE_BUFFER_PROBE__.population.instanceMatrix.version >
        previous,
      before.version
    );
    const themed = await page.evaluate(() => {
      const probe = window.__TILE_BUFFER_PROBE__;
      return {
        retained:
          probe.canvas ===
          document.querySelector('[data-board-view="v2"] canvas'),
        version: probe.population.instanceMatrix.version,
      };
    });
    if (!themed.retained)
      throw new Error(
        'Theme changed by remounting the static population canvas'
      );

    await page.getByRole('link', { name: '100 Agents', exact: true }).click();
    await page.waitForURL(/fixture=scale-100&/);
    await page.waitForFunction(previous => {
      const probe = window.__TILE_BUFFER_PROBE__;
      let count = 0;
      probe.evidence.scene.traverse(node => {
        if (
          node.name === 'tile-agent-bodies' &&
          node.userData.boardTileBodyIds?.some(id =>
            id?.startsWith('population:')
          )
        )
          count += node.count;
      });
      return count !== previous;
    }, before.count);
    const changed = await page.evaluate(() => {
      const probe = window.__TILE_BUFFER_PROBE__;
      let count = 0;
      probe.evidence.scene.traverse(node => {
        if (
          node.name === 'tile-agent-bodies' &&
          node.userData.boardTileBodyIds?.some(id =>
            id?.startsWith('population:')
          )
        )
          count += node.count;
      });
      return {
        retained:
          probe.canvas ===
          document.querySelector('[data-board-view="v2"] canvas'),
        count,
        version: probe.population.instanceMatrix.version,
      };
    });
    if (
      !changed.retained ||
      (changed.count > 0 && changed.version <= themed.version)
    )
      throw new Error(
        `Population change failed to refresh buffers: ${JSON.stringify(changed)}`
      );
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(
      `PASS static-population-buffers: camera version ${before.version} retained; theme ${themed.version}; population ${before.count} -> ${changed.count}`
    );
  } finally {
    await page.close();
  }
}
