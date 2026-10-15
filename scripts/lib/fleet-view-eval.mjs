/** One contract suite, independently isolated and labelled for each Fleet view. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const fleetView = process.env.EXAWATT_EVAL_FLEET_VIEW || 'v1';
if (!['v1', 'v2'].includes(fleetView)) {
  throw new Error(`Unsupported EXAWATT_EVAL_FLEET_VIEW: ${fleetView}`);
}

/** Default delivery evidence covers both views. Explicit selection is for diagnosis. */
export async function runFleetViewMatrix(scriptUrl) {
  if (process.env.EXAWATT_EVAL_FLEET_VIEW) return;
  let failed = false;
  for (const view of ['v1', 'v2']) {
    console.log(`\nFleet ${view}: ${fileURLToPath(scriptUrl)}`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(scriptUrl)], {
        stdio: 'inherit',
        env: { ...process.env, EXAWATT_EVAL_FLEET_VIEW: view },
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    });
    if (code !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

/** Fixtures use an explicit prop; production pages use the real preference. */
export function fleetViewUrl(value) {
  const url = new URL(value);
  url.searchParams.set('fleetView', fleetView);
  return url.toString();
}

export async function prepareFleetViewPage(page) {
  await page.addInitScript(view => {
    localStorage.setItem(
      'exawatt.presentation.fleetView.v1',
      JSON.stringify(view)
    );
  }, fleetView);
}

/** Prove the selected implementation, not just the preference written by the harness. */
export async function assertFleetView(page) {
  await page.waitForFunction(
    view =>
      document
        .querySelector('[data-spatial-board]')
        ?.getAttribute('data-board-view') === view,
    fleetView
  );
}

/** Read actual GPU instance transforms as well as v1's named Instance objects. */
export async function installBoardBodyProbe(page) {
  await page.evaluate(() => {
    window.__EVAL_AGENT_BODIES__ = () => {
      const bodies = [];
      window.__EVAL_SCENE__.traverse(node => {
        if (node.name.startsWith('body:')) {
          bodies.push({ name: node.name, scale: node.scale.x });
        }
        const ids = node.userData.boardTileBodyIds;
        if (!node.isInstancedMesh || !ids) return;
        const values = node.instanceMatrix.array;
        for (let slot = 0; slot < node.count; slot++) {
          const id = ids[slot];
          if (!id?.startsWith('agent:')) continue;
          const offset = slot * 16;
          const scale = Math.hypot(
            values[offset],
            values[offset + 1],
            values[offset + 2]
          );
          if (scale > 0) bodies.push({ name: `body:${id}`, scale });
        }
      });
      return bodies;
    };
  });
}
