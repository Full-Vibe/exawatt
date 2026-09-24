/**
 * The queue head holds while public publication is latched (BUG-201).
 *
 * ENG-030 keeps private `master` behind unpublished work: while a catch-up of
 * the already-integrated private tip cannot publish, no new private commit may
 * integrate. That guarantee is right; what it cost was wrong. The head found
 * the latch only after its rebase and full re-check, then failed, and its
 * owner went around again: 11 of September's 38 ticket deaths, 10 of them on
 * one night, 6 of those after a complete re-check. Nothing the owner could do
 * would clear it.
 *
 * So the head checks the latch BEFORE it rebases, and while latched it waits,
 * bounded and visible, with the latch's own diagnosis (`error.publicLatch`,
 * BUG-197) on its status line and in its ticket. The latch decides how:
 *
 * - `transient` (a push or network failure): retrying is what clears it, so
 *   the head retries the catch-up itself on a doubling backoff.
 * - `deterministic` (a commit that cannot render, a non-fast-forward, a stale
 *   maintenance hold): every retry refuses the same way, and only the
 *   operator's recovery clears it. The head does not re-run the projector on a
 *   timer; it watches the cheap signals that recovery changes (the source
 *   lock, the maintenance hold, `origin/master`) and re-checks when one moves,
 *   with a slow backstop.
 *
 * Past the bound the head gives up and fails with the diagnosis, exactly as
 * it failed before this existed; `0` restores that immediately.
 */

const PUBLIC_LATCH_HOLD_ENV = 'EXAWATT_PUBLIC_LATCH_HOLD_MINUTES';
const PUBLIC_LATCH_RETRY_ENV = 'EXAWATT_PUBLIC_LATCH_RETRY_SECONDS';

const DEFAULT_HOLD_MINUTES = 120;
const DEFAULT_RETRY_SECONDS = 30;
const MAX_TRANSIENT_RETRY_MS = 5 * 60_000;
const MAX_SIGNAL_POLL_MS = 5_000;
const DETERMINISTIC_BACKSTOP_MS = 10 * 60_000;
const STATUS_EVERY_MS = 5 * 60_000;

function nonNegative(value, fallback) {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function publicLatchHoldPolicy(env = process.env) {
  const holdMs =
    nonNegative(env[PUBLIC_LATCH_HOLD_ENV], DEFAULT_HOLD_MINUTES) * 60_000;
  const retryMs =
    Math.max(
      nonNegative(env[PUBLIC_LATCH_RETRY_ENV], DEFAULT_RETRY_SECONDS),
      0.05
    ) * 1_000;
  return {
    holdMs,
    retryMs,
    maxRetryMs: Math.max(retryMs, MAX_TRANSIENT_RETRY_MS),
    signalPollMs: Math.min(retryMs, MAX_SIGNAL_POLL_MS),
    backstopMs: DETERMINISTIC_BACKSTOP_MS,
    statusEveryMs: STATUS_EVERY_MS,
  };
}

function firstLine(text) {
  return String(text ?? '')
    .split('\n')[0]
    .replace(/^\[[a-z-]+\]\s*/u, '')
    .trim();
}

/**
 * The latch a failed publication check threw, in the queue's terms. A
 * structured `publicLatch` record (BUG-197) is read, never re-derived; an
 * error without one is classified by who can clear it: maintenance-hold and
 * reseed state belong to the operator, anything else is retried.
 */
export function describePublicLatch(error) {
  const record = error?.publicLatch ?? null;
  const message = String(error?.message ?? error);
  const failure =
    record?.failure ??
    (/\[public-maintenance\]|open-source:reseed/u.test(message)
      ? 'deterministic'
      : 'transient');
  let cause;
  if (record?.path) {
    cause =
      `private ${String(record.privateSha ?? record.sourceSha ?? '').slice(0, 12)} ` +
      `cannot render ${record.path} (check ${record.check})`;
  } else if (record?.check === 'non-fast-forward') {
    cause = `the projection does not descend from public ${String(record.publicSha).slice(0, 12)}`;
  } else {
    cause = firstLine(record?.reason) || firstLine(message);
  }
  const recovery =
    failure === 'deterministic'
      ? (record?.recovery?.preview ?? 'operator recovery (see the diagnosis)')
      : 'retrying';
  return {
    failure,
    message,
    record,
    summary: `${failure}: ${cause}; ${failure === 'deterministic' ? 'recovery' : 'next'}: ${recovery}`,
  };
}

const defaultSleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

/**
 * Holds while `check()` reports a latch. Resolves with `clear` (never
 * latched), `released` (the latch cleared while held), or `expired` (the
 * bound passed; the latch is still set).
 *
 * `check` returns null or a `describePublicLatch` value. `signature` is a
 * cheap fingerprint of the state an operator's recovery changes; for a
 * deterministic latch a re-check runs only when it moves or the backstop
 * passes. `report` receives `held`, `changed`, and periodic `status` events.
 */
export async function holdWhilePublicLatched({
  check,
  signature,
  policy,
  report = async () => {},
  sleep = defaultSleep,
  now = Date.now,
}) {
  let latch = await check();
  if (!latch) return { outcome: 'clear', heldMs: 0 };
  const startedAt = now();
  await report('held', latch, 0);
  let retryMs = policy.retryMs;
  let lastCheckAt = now();
  let lastStatusAt = now();
  let lastSignature = await signature();
  while (true) {
    const heldMs = now() - startedAt;
    if (heldMs >= policy.holdMs) return { outcome: 'expired', latch, heldMs };
    if (now() - lastStatusAt >= policy.statusEveryMs) {
      lastStatusAt = now();
      await report('status', latch, heldMs);
    }
    const remaining = policy.holdMs - heldMs;
    if (latch.failure === 'deterministic') {
      await sleep(Math.min(policy.signalPollMs, remaining));
      const current = await signature();
      const moved = current !== lastSignature;
      lastSignature = current;
      if (!moved && now() - lastCheckAt < policy.backstopMs) continue;
    } else {
      await sleep(Math.min(retryMs, remaining));
      retryMs = Math.min(retryMs * 2, policy.maxRetryMs);
    }
    if (now() - startedAt >= policy.holdMs) {
      return { outcome: 'expired', latch, heldMs: now() - startedAt };
    }
    lastCheckAt = now();
    const next = await check();
    if (!next) {
      return { outcome: 'released', latch, heldMs: now() - startedAt };
    }
    if (next.summary !== latch.summary) {
      await report('changed', next, now() - startedAt);
      if (next.failure !== latch.failure) retryMs = policy.retryMs;
    }
    latch = next;
  }
}
