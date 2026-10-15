import assert from 'node:assert/strict';
import test from 'node:test';
import { fleetViewUrl, installBoardBodyProbe } from './lib/fleet-view-eval.mjs';

test('view selection preserves a fixture scenario and replaces a stale view', () => {
  const url = new URL(fleetViewUrl('http://localhost:7000/eval/t10-board-scale?agents=10000&fleetView=old'));
  assert.equal(url.searchParams.get('agents'), '10000');
  assert.equal(url.searchParams.getAll('fleetView').length, 1);
  assert.equal(url.searchParams.get('fleetView'), process.env.EXAWATT_EVAL_FLEET_VIEW || 'v1');
});

test('body evidence reads actual instanced scales and ignores vacant/decorative slots', async () => {
  const previous = globalThis.window;
  const values = new Float32Array(5 * 16);
  values[0] = 2;
  values[16] = 9;
  values[32] = 0;
  values[48] = 0.5;
  values[64] = 7;
  globalThis.window = {
    __EVAL_SCENE__: {
      traverse: visit => {
        visit({ name: 'body:agent:legacy', scale: { x: 0.25 }, userData: {} });
        visit({
          name: 'tile-agent-bodies', isInstancedMesh: true, count: 4,
          userData: { boardTileBodyIds: ['agent:one', 'ghost:one', 'agent:departed', 'agent:arriving', 'agent:outside-count'] },
          instanceMatrix: { array: values },
        });
      },
    },
  };
  try {
    await installBoardBodyProbe({ evaluate: fn => fn() });
    assert.deepEqual(window.__EVAL_AGENT_BODIES__(), [
      { name: 'body:agent:legacy', scale: 0.25 },
      { name: 'body:agent:one', scale: 2 },
      { name: 'body:agent:arriving', scale: 0.5 },
    ]);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
