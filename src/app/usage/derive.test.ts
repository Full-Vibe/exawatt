import { describe, expect, it } from 'vitest';
import type {
  CapacityWindowView,
  ConsumptionSourceView,
} from '@/components/consumption/model';
import {
  demoConsumption,
  type DemoConsumption,
} from '@/components/consumption/demo-source';
import { allPaces, gridRows } from './derive';

const NOW = Date.parse('2026-08-02T15:20:00.000Z');
const MIN = 60_000;

function win(
  overrides: Partial<CapacityWindowView> & { limitId: string; usedPercent: number }
): CapacityWindowView {
  return {
    label: '5-hour window',
    windowMinutes: 300,
    resetsAtMs: NOW + 90 * MIN,
    burnPercentPerHour: 8,
    observedAtMs: NOW - MIN,
    ...overrides,
  };
}

function source(windows: CapacityWindowView[]): ConsumptionSourceView {
  return {
    key: 'codex',
    harness: 'codex',
    label: 'Codex',
    planType: 'pro',
    credits: null,
    windows,
    observedTokens5h: 1_000_000,
    observedSessions: 2,
    observedDelegatedShare: null,
    burn: [0.4, 0.5],
  };
}

function demoWith(sources: ConsumptionSourceView[]): DemoConsumption {
  return { nowMs: NOW, sources } as unknown as DemoConsumption;
}

describe('allPaces — the page applies the meter’s freshness discipline', () => {
  it('drops expired and stale windows so a dead reading can never headline', () => {
    const live = win({ limitId: 'live', usedPercent: 40 });
    const expired = win({
      limitId: 'expired',
      usedPercent: 95,
      resetsAtMs: NOW - MIN,
    });
    const stale = win({
      limitId: 'stale',
      usedPercent: 90,
      observedAtMs: NOW - 400 * MIN,
    });
    const paces = allPaces(demoWith([source([live, expired, stale])]));
    expect(paces.map(p => p.window.limitId)).toEqual(['live']);
  });

  it('sorts tightest (highest used) first and carries the shared pace verdict', () => {
    const a = win({ limitId: 'a', usedPercent: 40 });
    const b = win({ limitId: 'b', usedPercent: 78 });
    const paces = allPaces(demoWith([source([a, b])]));
    expect(paces.map(p => p.window.limitId)).toEqual(['b', 'a']);
    // 70% elapsed → +8 pts on b (ahead), −30 pts on a (behind); the verdict
    // field exists because the page renders the meter's reading, not its own
    expect(paces[0].pace).toBe('ahead');
    expect(paces[1].pace).toBe('behind');
  });
});

describe('per-run context pressure — absent is never zero', () => {
  it('carries codex context truth and leaves claude-code unreported', () => {
    const rows = gridRows(demoConsumption());
    const codex = rows.filter(r => r.source === 'codex' && r.identified);
    expect(codex.length).toBeGreaterThan(0);
    for (const r of codex) {
      expect(r.contextWindow).toBe(272_000);
      expect(r.contextPeakTokens).toBeGreaterThan(0);
      expect(r.contextPeakTokens!).toBeLessThanOrEqual(r.contextWindow!);
    }
    // at least one authored compaction survives to the drill
    expect(codex.some(r => (r.compactions ?? 0) > 0)).toBe(true);
    // Claude Code records neither window nor peak: null, never 0
    const claude = rows.filter(
      r => r.source === 'claude-code' && r.identified
    );
    expect(claude.length).toBeGreaterThan(0);
    for (const r of claude) {
      expect(r.contextWindow).toBeNull();
      expect(r.contextPeakTokens).toBeNull();
      expect(r.compactions).toBeNull();
    }
  });
});
