import { describe, expect, it } from 'vitest';
import type {
  CapacityWindowView,
  ConsumptionSourceView,
} from '@/components/consumption/model';
import type { DemoConsumption } from '@/components/consumption/demo-source';
import { allPaces } from './derive';

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
