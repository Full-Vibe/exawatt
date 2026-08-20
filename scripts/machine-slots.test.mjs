import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acquireMachineSlot, defaultSlotCount } from './lib/machine-slots.mjs';

async function slotArena() {
  return mkdtemp(path.join(tmpdir(), 'exawatt-machine-slots-'));
}

function options(baseDir, overrides = {}) {
  return {
    baseDir,
    slotCount: 2,
    env: {},
    log: () => {},
    // deadline 0 = a single non-blocking pass; tests never sleep-poll
    deadlineMs: 0,
    ...overrides,
  };
}

test('the pool admits exactly slotCount holders, then refuses', async t => {
  const arena = await slotArena();
  t.after(() => rm(arena, { recursive: true, force: true }));

  const first = await acquireMachineSlot(options(arena, { env: {} }));
  const second = await acquireMachineSlot(options(arena, { env: {} }));
  assert.equal(first.mode, 'acquired');
  assert.equal(second.mode, 'acquired');

  const warnings = [];
  const third = await acquireMachineSlot(
    options(arena, { env: {}, log: m => warnings.push(m) })
  );
  assert.equal(third.mode, 'unslotted');
  assert.ok(
    warnings.some(m => m.includes('UNSLOTTED')),
    'proceeding without a slot must be loud, never silent'
  );

  await first.release();
  const fourth = await acquireMachineSlot(options(arena, { env: {} }));
  assert.equal(fourth.mode, 'acquired', 'a released slot is acquirable again');
});

test('a child inheriting the token is reentrant and cannot free the parent slot', async t => {
  const arena = await slotArena();
  t.after(() => rm(arena, { recursive: true, force: true }));

  const parentEnv = {};
  const parent = await acquireMachineSlot(
    options(arena, { slotCount: 1, env: parentEnv })
  );
  assert.equal(parent.mode, 'acquired');
  assert.ok(parentEnv.EXAWATT_MACHINE_SLOT_TOKEN, 'holder exports its token');

  const child = await acquireMachineSlot(
    options(arena, { slotCount: 1, env: { ...parentEnv } })
  );
  assert.equal(child.mode, 'reentrant');
  await child.release();

  // the parent's slot must still be held after the reentrant release
  const stranger = await acquireMachineSlot(
    options(arena, { slotCount: 1, env: {} })
  );
  assert.equal(stranger.mode, 'unslotted');

  await parent.release();
  assert.equal(
    parentEnv.EXAWATT_MACHINE_SLOT_TOKEN,
    undefined,
    'release withdraws the exported token'
  );
});

test('a dead holder is reclaimed; a live holder is not', async t => {
  const arena = await slotArena();
  t.after(() => rm(arena, { recursive: true, force: true }));

  const deadPid = spawnSync('node', ['-e', '']).pid;
  const slotPath = path.join(arena, 'slot-0.lock');
  await mkdir(slotPath);
  await writeFile(
    path.join(slotPath, 'owner.json'),
    JSON.stringify({ token: 'stale', pid: deadPid, label: 'crashed run' })
  );
  const reclaimed = await acquireMachineSlot(
    options(arena, { slotCount: 1, env: {} })
  );
  assert.equal(reclaimed.mode, 'acquired', 'a dead PID must not hold a slot');

  const live = await acquireMachineSlot(
    options(arena, { slotCount: 1, env: {} })
  );
  assert.equal(live.mode, 'unslotted', 'a live holder is never evicted');
});

test('an unreadable owner inside the grace window still counts as held', async t => {
  const arena = await slotArena();
  t.after(() => rm(arena, { recursive: true, force: true }));

  // a slot directory with no owner file yet: a racing acquisition mid-write.
  // A failed read must never look like a free slot.
  await mkdir(path.join(arena, 'slot-0.lock'));
  const attempt = await acquireMachineSlot(
    options(arena, { slotCount: 1, env: {} })
  );
  assert.equal(attempt.mode, 'unslotted');
});

test('EXAWATT_MACHINE_SLOTS=0 disables the pool explicitly', async () => {
  const result = await acquireMachineSlot({
    env: { EXAWATT_MACHINE_SLOTS: '0' },
    log: () => {},
  });
  assert.equal(result.mode, 'disabled');
  await result.release();
});

test('the slot count comes from the environment when set, and is bounded when not', () => {
  assert.equal(defaultSlotCount({ EXAWATT_MACHINE_SLOTS: '5' }), 5);
  assert.equal(defaultSlotCount({ EXAWATT_MACHINE_SLOTS: '0' }), 0);
  const derived = defaultSlotCount({});
  assert.ok(
    derived >= 1 && derived <= 3,
    `derived count ${derived} outside [1,3]`
  );
});

test('release is idempotent and only the owner can free its slot', async t => {
  const arena = await slotArena();
  t.after(() => rm(arena, { recursive: true, force: true }));

  const holder = await acquireMachineSlot(
    options(arena, { slotCount: 1, env: {} })
  );
  await holder.release();
  await holder.release(); // second release must be a no-op, not an error

  const next = await acquireMachineSlot(
    options(arena, { slotCount: 1, env: {} })
  );
  assert.equal(next.mode, 'acquired');
  // the earlier holder's release must not free the NEW owner's slot
  await holder.release();
  const contender = await acquireMachineSlot(
    options(arena, { slotCount: 1, env: {} })
  );
  assert.equal(contender.mode, 'unslotted');
});
