import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emptyLiveConsumptionSnapshot,
  type LiveConsumptionSnapshot,
  type PlanWindow,
  type UsageAlert,
} from '@exawatt/core';
import type { ConsumptionScannerLike } from '../consumption-ipc';
import { UsageAlertService } from './usage-alert-service';

const NOW = Date.parse('2026-09-30T01:40:00.000Z');
const HOUR = 3_600_000;

function window(over: Partial<PlanWindow> = {}): PlanWindow {
  return {
    source: 'codex',
    limitId: 'codex',
    limitName: null,
    scope: 'primary',
    usedPercent: 78,
    windowMinutes: 10_080,
    resetsAt: new Date(NOW + 96 * HOUR).toISOString(),
    planType: 'pro',
    observedAt: new Date(NOW - 60_000).toISOString(),
    providerSessionId: '',
    ...over,
  };
}

function source(planWindows: PlanWindow[], firstScanComplete = true): ConsumptionScannerLike {
  return {
    snapshot: async (): Promise<LiveConsumptionSnapshot> => {
      const snapshot = emptyLiveConsumptionSnapshot(NOW);
      snapshot.scanState.firstScanComplete = firstScanComplete;
      snapshot.planWindows = planWindows;
      snapshot.windowRates = { 'codex|codex|primary|10080': 2 };
      return snapshot;
    },
    rescan: () => {},
    cancelScan: () => {},
    onUpdated: () => () => {},
  };
}

describe('UsageAlertService', () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-usage-alerts-'));
  });
  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  const service = (
    planWindows: PlanWindow[],
    posted: UsageAlert[],
    options: { enabled?: boolean; firstScanComplete?: boolean } = {}
  ) =>
    new UsageAlertService({
      source: source(planWindows, options.firstScanComplete),
      stateDir,
      preferences: () => ({ enabled: options.enabled ?? true, leadMinutes: 60 }),
      post: alert => posted.push(alert),
      now: () => NOW,
    });

  it('posts an alert once, and remembers it across a restart', async () => {
    const posted: UsageAlert[] = [];
    const first = service([window()], posted);
    await first.check();
    await first.check();
    expect(posted.map(a => a.stage)).toEqual(['on-course']);
    // A relaunch reads what was already said.
    await service([window()], posted).check();
    expect(posted).toHaveLength(1);
  });

  it('posts nothing when the operator turned alerts off', async () => {
    const posted: UsageAlert[] = [];
    await service([window()], posted, { enabled: false }).check();
    expect(posted).toEqual([]);
  });

  it('waits for a full scan before deciding from a partial picture', async () => {
    const posted: UsageAlert[] = [];
    await service([window()], posted, { firstScanComplete: false }).check();
    expect(posted).toEqual([]);
  });

  it('sets a damaged state file aside and carries on', async () => {
    fs.writeFileSync(path.join(stateDir, 'usage-alerts.json'), '{not json');
    const posted: UsageAlert[] = [];
    await service([window()], posted).check();
    expect(posted).toHaveLength(1);
    // What was said is remembered in a fresh file.
    await service([window()], posted).check();
    expect(posted).toHaveLength(1);
  });
});
