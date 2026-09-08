import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifySourceLockHealth,
  latestPublishedPair,
  publicDeliveryPreflightBlocker,
  validateSourceLockEntry,
} from './lib/public-source-lock.mjs';

const PRIVATE_A = 'a'.repeat(40);
const PRIVATE_B = 'b'.repeat(40);
const PUBLIC_A = 'c'.repeat(40);
const PUBLIC_B = 'd'.repeat(40);

function record(status, privateSha, publicSha, extra = {}) {
  return { status, privateSha, publicSha, ...extra };
}

test('only an exact effective publication pair is healthy', () => {
  const published = record('published', PRIVATE_A, PUBLIC_A);

  assert.deepEqual(classifySourceLockHealth([], PRIVATE_A), {
    state: 'unpublished',
    healthy: false,
    blocksIntegration: false,
    requestedPrivateSha: PRIVATE_A,
    latestRecord: null,
    effectivePair: null,
  });
  assert.deepEqual(classifySourceLockHealth([published], PRIVATE_A), {
    state: 'healthy',
    healthy: true,
    blocksIntegration: false,
    requestedPrivateSha: PRIVATE_A,
    latestRecord: published,
    effectivePair: published,
  });
  assert.deepEqual(classifySourceLockHealth([published], PRIVATE_B), {
    state: 'stale',
    healthy: false,
    blocksIntegration: false,
    requestedPrivateSha: PRIVATE_B,
    latestRecord: published,
    effectivePair: published,
  });
});

test('a trailing pending delivery explicitly latches newer integration', () => {
  const published = record('published', PRIVATE_A, PUBLIC_A);
  const pending = record('pending', PRIVATE_B, null, {
    reason: 'public remote unavailable',
  });
  const records = [published, pending];

  assert.equal(latestPublishedPair(records), published);
  assert.equal(publicDeliveryPreflightBlocker(records), pending);
  assert.deepEqual(classifySourceLockHealth(records, PRIVATE_A), {
    state: 'pending',
    healthy: false,
    blocksIntegration: true,
    requestedPrivateSha: PRIVATE_A,
    latestRecord: pending,
    effectivePair: published,
  });
});

test('a trailing refusal wins over an older success or pending attempt', () => {
  const published = record('published', PRIVATE_A, PUBLIC_A);
  const pending = record('pending', PRIVATE_B, null, {
    reason: 'public remote unavailable',
  });
  const refused = record('refused', PRIVATE_B, null, {
    reason: 'public master diverged',
  });
  const records = [published, pending, refused];

  assert.equal(publicDeliveryPreflightBlocker(records), refused);
  assert.deepEqual(classifySourceLockHealth(records, PRIVATE_B), {
    state: 'refused',
    healthy: false,
    blocksIntegration: true,
    requestedPrivateSha: PRIVATE_B,
    latestRecord: refused,
    effectivePair: published,
  });
});

test('a later publication clears the failure latch and proves the repair', () => {
  const published = record('published', PRIVATE_A, PUBLIC_A);
  const pending = record('pending', PRIVATE_B, null, {
    reason: 'public remote unavailable',
  });
  const repair = record('published', PRIVATE_B, PUBLIC_B);
  const records = [published, pending, repair];

  assert.equal(publicDeliveryPreflightBlocker(records), null);
  assert.equal(latestPublishedPair(records), repair);
  assert.deepEqual(classifySourceLockHealth(records, PRIVATE_B), {
    state: 'healthy',
    healthy: true,
    blocksIntegration: false,
    requestedPrivateSha: PRIVATE_B,
    latestRecord: repair,
    effectivePair: repair,
  });
});

test('a deliberate reseed is also an effective repair pair', () => {
  const refused = record('refused', PRIVATE_B, null, {
    reason: 'public master diverged',
  });
  const reseeded = record('reseeded', PRIVATE_B, PUBLIC_B, {
    reason: 'operator approved public-history rewrite',
  });
  const records = [refused, reseeded];

  assert.equal(publicDeliveryPreflightBlocker(records), null);
  assert.equal(latestPublishedPair(records), reseeded);
  assert.equal(classifySourceLockHealth(records, PRIVATE_B).healthy, true);
});

test('effective publication statuses always require a complete pair', () => {
  assert.throws(
    () => validateSourceLockEntry(record('published', PRIVATE_A, null)),
    /published pair needs a publicSha/u
  );
  assert.throws(
    () =>
      validateSourceLockEntry(
        record('reseeded', PRIVATE_A, null, { reason: 'operator approved' })
      ),
    /reseeded pair needs a publicSha/u
  );
});

test('health classification rejects ambiguous inputs', () => {
  assert.throws(
    () => classifySourceLockHealth(null, PRIVATE_A),
    /records must be an array/u
  );
  assert.throws(
    () => classifySourceLockHealth([], 'master'),
    /requestedPrivateSha must be a full commit id/u
  );
});
