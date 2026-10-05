/**
 * ENG-038 slice 2 — the Codex plan-account read. The fixture is the answer
 * the operator's own Pro account gave `account/rateLimits/read` on
 * 2026-09-29 (codex-cli 0.158.0), ids redacted, so the parser is pinned to
 * the real boundary rather than to what this module wishes it returned.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planWindowKey } from '@exawatt/core';
import {
  CodexPlanAccountService,
  parseCodexAccountRateLimits,
} from './codex-plan-account';
import { CodexProtocolIncompatibleError } from '../harness-events/codex-app-server';

const RECORDED = {
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: 'codex',
    limitName: null,
    normalModelSlug: null,
    primary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: 1791346971 },
    secondary: null,
    credits: { hasCredits: true, unlimited: false, balance: '60941.1992640000' },
    individualLimit: null,
    spendControlReached: false,
    planType: 'pro',
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: 'codex',
      limitName: null,
      normalModelSlug: null,
      primary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: 1791346971 },
      secondary: null,
      credits: { hasCredits: true, unlimited: false, balance: '60941.1992640000' },
      individualLimit: null,
      spendControlReached: false,
      planType: 'pro',
      rateLimitReachedType: null,
    },
  },
  rateLimitResetCredits: {
    availableCount: 3,
    credits: [
      {
        id: 'redacted-2',
        resetType: 'codexRateLimits',
        status: 'available',
        grantedAt: 1790108844,
        expiresAt: 1792700844,
        title: 'Full reset',
        description: "Thanks for using Codex! You've been granted one free rate limit reset.",
      },
      {
        id: 'redacted-1',
        resetType: 'codexRateLimits',
        status: 'available',
        grantedAt: 1788581918,
        expiresAt: 1791173918,
        title: 'Full reset',
        description: "Thanks for using Codex! You've been granted one free rate limit reset.",
      },
      {
        id: 'redacted-3',
        resetType: 'codexRateLimits',
        status: 'available',
        grantedAt: 1790707702,
        expiresAt: 1793299702,
        title: 'Full reset',
        description: "Thanks for using Codex! You've been granted one free rate limit reset.",
      },
    ],
  },
  accountId: 'redacted',
  rateLimitUpsell: null,
};

const OBSERVED_AT = '2026-09-30T04:40:00.000Z';

describe('parseCodexAccountRateLimits', () => {
  it('reads the week, the plan, the credits and the banked resets', () => {
    const read = parseCodexAccountRateLimits(RECORDED, OBSERVED_AT)!;
    expect(read.planType).toBe('pro');
    expect(read.windows).toEqual([
      {
        source: 'codex',
        limitId: 'codex',
        limitName: null,
        scope: 'primary',
        usedPercent: 45,
        windowMinutes: 10080,
        resetsAt: new Date(1791346971 * 1000).toISOString(),
        planType: 'pro',
        observedAt: OBSERVED_AT,
        providerSessionId: '',
        origin: 'provider-account',
      },
    ]);
    expect(read.credits).toEqual({ balance: 60941.199264, unlimited: false });
    expect(read.resets?.available).toBe(3);
    // Soonest expiry first, whatever order the account listed them in.
    expect(read.resets?.credits?.map(c => c.expiresAt)).toEqual([
      new Date(1791173918 * 1000).toISOString(),
      new Date(1792700844 * 1000).toISOString(),
      new Date(1793299702 * 1000).toISOString(),
    ]);
  });

  it('shares the local scanner bucket, so the fresher reading wins', () => {
    const read = parseCodexAccountRateLimits(RECORDED, OBSERVED_AT)!;
    expect(planWindowKey(read.windows[0])).toBe('codex|codex|primary|10080');
  });

  it('keeps only credits the account still holds', () => {
    const redeemed = structuredClone(RECORDED);
    redeemed.rateLimitResetCredits.credits[0].status = 'redeemed';
    const read = parseCodexAccountRateLimits(redeemed, OBSERVED_AT)!;
    expect(read.resets?.credits).toHaveLength(2);
  });

  it('reads model-scoped buckets and skips windows with no length', () => {
    const scoped = {
      rateLimitsByLimitId: {
        codex_bengalfox: {
          limitId: 'codex_bengalfox',
          limitName: 'GPT-5.3-Codex-Spark',
          primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1791346971 },
          secondary: { usedPercent: 1, windowDurationMins: null, resetsAt: null },
          planType: 'pro',
        },
        premium: { limitId: 'premium', primary: null, secondary: null },
      },
    };
    const read = parseCodexAccountRateLimits(scoped, OBSERVED_AT)!;
    expect(read.windows).toHaveLength(1);
    expect(read.windows[0]).toMatchObject({
      limitName: 'GPT-5.3-Codex-Spark',
      windowMinutes: 300,
    });
    // No reset summary in the answer: absent, never "none".
    expect(read.resets).toBeUndefined();
  });

  it('turns an unrecognizable answer into absence, never a throw', () => {
    expect(parseCodexAccountRateLimits(null, OBSERVED_AT)).toBeNull();
    expect(parseCodexAccountRateLimits('nope', OBSERVED_AT)).toBeNull();
    expect(parseCodexAccountRateLimits({ rateLimits: {} }, OBSERVED_AT)).toBeNull();
  });
});

describe('CodexPlanAccountService', () => {
  let stateDir: string;
  let nowMs: number;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-codex-plan-'));
    nowMs = Date.parse(OBSERVED_AT);
  });
  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  const service = (readRateLimits: () => Promise<unknown>, enabled = true) =>
    new CodexPlanAccountService({
      stateDir,
      enabled,
      readRateLimits,
      now: () => nowMs,
      minFetchIntervalMs: 0,
      jitterMs: 0,
    });

  it('serves the account state and persists it for a warm launch', async () => {
    const svc = service(async () => RECORDED);
    await svc.maybeRefresh();
    const view = svc.view();
    expect(view.account).toMatchObject({
      source: 'codex',
      status: 'ok',
      planType: 'pro',
      observedAt: OBSERVED_AT,
      resets: { available: 3 },
      credits: { unlimited: false },
    });
    const warm = service(async () => null).view();
    expect(warm.account.resets?.available).toBe(3);
    expect(warm.windows).toHaveLength(1);
  });

  it('keeps the last reading at its true age when a read fails', async () => {
    let failing = false;
    const svc = service(async () => {
      if (failing) throw new Error('app-server exited');
      return RECORDED;
    });
    await svc.maybeRefresh();
    failing = true;
    nowMs += 10 * 60_000;
    await svc.maybeRefresh();
    const view = svc.view();
    expect(view.account.status).toBe('unavailable');
    expect(view.account.observedAt).toBe(OBSERVED_AT);
    expect(view.windows[0].observedAt).toBe(OBSERVED_AT);
  });

  it('off starts no read and serves absence', async () => {
    let reads = 0;
    const svc = service(async () => {
      reads += 1;
      return RECORDED;
    }, false);
    await svc.maybeRefresh();
    expect(reads).toBe(0);
    expect(svc.view().account.status).toBe('disabled');
    expect(svc.view().windows).toEqual([]);
  });

  it('remembers a too-old app-server for the launch instead of respawning it', async () => {
    let reads = 0;
    const svc = service(async () => {
      reads += 1;
      throw new CodexProtocolIncompatibleError('installed app-server is older than 0.147.0');
    });
    await svc.maybeRefresh();
    nowMs += 10 * 60_000;
    await svc.maybeRefresh();
    expect(reads).toBe(1);
    expect(svc.view().account).toMatchObject({ status: 'unavailable', failure: 'unrecognized' });
  });

  it('names why a read failed', async () => {
    const failing = (message: string) =>
      service(async () => {
        throw new Error(message);
      });
    const missing = failing('Codex app-server exited (127): fish: Unknown command: codex');
    await missing.maybeRefresh();
    expect(missing.view().account.failure).toBe('not-installed');
    const slow = failing('Codex app-server request timed out: account/rateLimits/read');
    await slow.maybeRefresh();
    expect(slow.view().account.failure).toBe('timed-out');
  });

  it('keeps a warm launch readable when the last read carried only resets', async () => {
    const resetsOnly = { rateLimitResetCredits: RECORDED.rateLimitResetCredits };
    await service(async () => resetsOnly).maybeRefresh();
    const warm = service(async () => null).view();
    expect(warm.account.status).toBe('ok');
    expect(warm.account.resets?.available).toBe(3);
  });
});

describe('the credit balance is account-wide', () => {
  it('is read from a per-limit snapshot when the default one is absent', () => {
    const byIdOnly = { rateLimitsByLimitId: RECORDED.rateLimitsByLimitId };
    expect(parseCodexAccountRateLimits(byIdOnly, OBSERVED_AT)?.credits).toEqual({
      balance: 60941.199264,
      unlimited: false,
    });
  });
});

