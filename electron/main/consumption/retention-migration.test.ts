/**
 * BUG-141 — an existing auto-publishing install keeps its history on the
 * first launch of a build that has BUG-032's retention horizon.
 *
 * The v0.1.10 shape, reproduced exactly: an unbounded state (that release had
 * no sample horizon at all), every corpus file watermarked as consumed, and
 * `settings.json` holding `{ operatorProfile: { autoPublish: true } }` with
 * no `startedAt` — the field was added two days after the release, and the
 * renderer's first sync is what recovers the hosted `joined_at` and writes
 * it, minutes after boot. This test drives that sequence in order: boot,
 * hydrate, first pass, the sync's anchor write, the sync's scan, the next
 * pass, and a relaunch. Everything a real user would lose is asserted from
 * the payload the sync would have PUBLISHED, because the hosted RPC replaces
 * the user's days and runs with exactly that payload.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSUMPTION_SAMPLE_HORIZON_MS,
  CONSUMPTION_SAMPLE_MAX_HORIZON_MS,
} from '@exawatt/core';

const electronState = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
}));

import { scanLocalOperatorStats } from '../operator-stats-ipc';
import {
  loadSettings,
  recordOperatorProfilePublicationState,
} from '../settings-store';
import { sampleRetentionPolicy } from './retention-policy';
import { ConsumptionScannerService } from './scanner-service';

const DAY = 24 * 3_600_000;

/* ------------------------------------------------------------------ */
/* a corpus spanning ninety days                                        */
/* ------------------------------------------------------------------ */

/** One Codex rollout per week back to day 84, plus one at day 90. */
const CORPUS_DAYS_BACK = [0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 90];
/** Each rollout carries two `token_count` events, at these offsets. */
const SAMPLE_OFFSETS_MS = [60_000, 600_000];
const samplesFor = (days: number[]) => days.length * SAMPLE_OFFSETS_MS.length;

const codexLine = (record: unknown) => JSON.stringify(record);

function rollout(sessionId: string, startMs: number): string {
  const at = (offsetMs: number) => new Date(startMs + offsetMs).toISOString();
  const usage = (n: number) => ({
    input_tokens: n,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: n / 10,
    reasoning_output_tokens: 0,
    total_tokens: n + n / 10,
  });
  const tokenCount = (offsetMs: number, cumulative: number, delta: number) =>
    codexLine({
      timestamp: at(offsetMs),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: usage(cumulative),
          last_token_usage: usage(delta),
          model_context_window: 272_000,
        },
      },
    });
  return (
    [
      codexLine({
        timestamp: at(0),
        type: 'session_meta',
        payload: {
          session_id: sessionId,
          cwd: '/w/acme',
          originator: 'codex-tui',
        },
      }),
      codexLine({
        timestamp: at(1_000),
        type: 'turn_context',
        payload: {
          model: 'gpt-5.6-sol',
          cwd: '/w/acme',
          collaboration_mode: { settings: { reasoning_effort: 'high' } },
        },
      }),
      tokenCount(SAMPLE_OFFSETS_MS[0], 1_000, 1_000),
      tokenCount(SAMPLE_OFFSETS_MS[1], 3_000, 2_000),
    ].join('\n') + '\n'
  );
}

let root: string;
let stateDir: string;
let codexRoot: string;
let claudeRoot: string;
let services: ConsumptionScannerService[];
/** Wall time for the whole scenario; the corpus is dated back from it. */
let now: number;

function dayStart(daysBack: number): number {
  // Midday, so no local date is ambiguous and the sync's UTC day matches.
  return now - daysBack * DAY;
}

function localDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** How many corpus samples a horizon retains behind the newest one. */
function retainedUnder(horizonMs: number): number {
  const instants = CORPUS_DAYS_BACK.flatMap(d =>
    SAMPLE_OFFSETS_MS.map(offset => dayStart(d) + offset)
  );
  const cutoff = Math.max(...instants) - horizonMs;
  return instants.filter(instant => instant >= cutoff).length;
}

async function writeCorpus(): Promise<void> {
  for (const daysBack of CORPUS_DAYS_BACK) {
    const start = dayStart(daysBack);
    const date = new Date(start);
    const dir = path.join(
      codexRoot,
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0')
    );
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      path.join(dir, `rollout-${date.toISOString()}-day-${daysBack}.jsonl`),
      rollout(`codex-day-${daysBack}`, start)
    );
  }
}

function makeService(
  sampleHorizonMs: number | (() => number)
): ConsumptionScannerService {
  const service = new ConsumptionScannerService({
    stateDir,
    claudeRoot,
    codexRoot,
    grokRoot: path.join(root, 'grok-sessions'),
    watch: false,
    initialDelayMs: 0,
    debounceMs: 5,
    minPassIntervalMs: 0,
    staleAfterMs: Number.POSITIVE_INFINITY,
    sampleHorizonMs,
  });
  services.push(service);
  return service;
}

/** What v0.1.10 left on disk: everything retained, every file consumed. */
async function installLegacyState(): Promise<void> {
  const legacy = makeService(CONSUMPTION_SAMPLE_MAX_HORIZON_MS);
  await legacy.snapshot();
  await legacy.settle();
  expect((await legacy.snapshot()).samples).toHaveLength(
    samplesFor(CORPUS_DAYS_BACK)
  );
  await legacy.dispose();
  services.pop();
}

function writeSettings(settings: unknown): void {
  fs.writeFileSync(
    path.join(electronState.userData, 'settings.json'),
    JSON.stringify(settings)
  );
}

async function logSampleDays(): Promise<number[]> {
  const log = await fs.promises.readFile(
    path.join(stateDir, 'log-v1.jsonl'),
    'utf8'
  );
  const days = new Set<number>();
  for (const line of log.split('\n')) {
    if (!line) continue;
    const envelope = JSON.parse(line) as { k: string; v: { at: string } };
    if (envelope.k !== 'sample') continue;
    days.add(Math.round((now - Date.parse(envelope.v.at)) / DAY));
  }
  return [...days].sort((a, b) => a - b);
}

beforeEach(async () => {
  services = [];
  // Midday today, so every fixture instant is behind wall time and the sync's
  // UTC local dates never straddle midnight.
  now = Math.floor(Date.now() / DAY) * DAY - 12 * 3_600_000;
  root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exa-retention-migration-')
  );
  electronState.userData = path.join(root, 'userData');
  await fs.promises.mkdir(electronState.userData, { recursive: true });
  stateDir = path.join(electronState.userData, 'consumption-scan');
  codexRoot = path.join(root, 'codex-sessions');
  claudeRoot = path.join(root, 'claude-projects');
  await fs.promises.mkdir(claudeRoot, { recursive: true });
  await writeCorpus();
  await installLegacyState();
});

afterEach(async () => {
  for (const service of services) await service.dispose();
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe('BUG-141 — first launch over a v0.1.10 auto-publishing profile', () => {
  it('publishes every day since the hosted anchor, not the last fourteen', async () => {
    // The v0.1.10 profile: consent given, anchor field not yet in existence.
    writeSettings({ operatorProfile: { autoPublish: true } });
    expect(loadSettings().operatorProfile).toEqual({ autoPublish: true });
    const policy = sampleRetentionPolicy({ now: () => now });

    // Boot: hydrate and the first pass, exactly as main.ts composes it.
    const booted = makeService(policy);
    await booted.snapshot();
    await booted.settle();

    // The renderer's first sync, two minutes later: no local anchor, so it
    // recovers the hosted profile's `joined_at` (sixty days ago here), writes
    // it, and scans everything since it for the payload the RPC will REPLACE
    // the hosted aggregate with.
    const joinedAt = new Date(dayStart(60)).toISOString();
    recordOperatorProfilePublicationState({
      startedAt: joinedAt,
      lastSyncedAt: new Date(now - 6 * 3_600_000).toISOString(),
      profileEnabled: true,
    });
    const payload = await scanLocalOperatorStats(booted, joinedAt, 'UTC');

    const expectedDays = CORPUS_DAYS_BACK.filter(d => d <= 60).map(d =>
      localDate(dayStart(d))
    );
    expect(payload.days.map(day => day.localDate).sort()).toEqual(
      [...expectedDays].sort()
    );
    expect(payload.runs).toHaveLength(expectedDays.length);
  });

  it('converges on the anchor without a relaunch, and the log follows', async () => {
    writeSettings({ operatorProfile: { autoPublish: true } });
    const policy = sampleRetentionPolicy({ now: () => now });
    const booted = makeService(policy);
    await booted.snapshot();
    await booted.settle();
    // Nothing was pruned while the anchor was unknown.
    expect((await booted.snapshot()).samples).toHaveLength(
      samplesFor(CORPUS_DAYS_BACK)
    );

    const joinedAt = new Date(dayStart(60)).toISOString();
    recordOperatorProfilePublicationState({ startedAt: joinedAt });

    // The next pass re-reads the owner: sixty days back plus the default
    // horizon behind that, so days 77, 84, and 90 fall away — and because the
    // retained set shrank, the log is rewritten to match at once.
    booted.rescan();
    await booted.settle();
    const retained = (await booted.snapshot()).samples;
    const horizonDays = 60 + CONSUMPTION_SAMPLE_HORIZON_MS / DAY;
    const expected = CORPUS_DAYS_BACK.filter(d => d <= horizonDays);
    expect(retained).toHaveLength(samplesFor(expected));
    await booted.dispose();
    services.pop();
    expect(await logSampleDays()).toEqual(expected);

    // A relaunch resolves the same horizon at hydrate and serves the same
    // history to the next sync.
    const relaunched = makeService(sampleRetentionPolicy({ now: () => now }));
    const sinceAnchor = await relaunched.settledSamplesSince(
      Date.parse(joinedAt)
    );
    expect(sinceAnchor).toHaveLength(
      samplesFor(CORPUS_DAYS_BACK.filter(d => d <= 60))
    );
    expect((await relaunched.snapshot()).samples).toHaveLength(
      samplesFor(expected)
    );
  });

  it('control: an install that is not publishing still gets the default horizon', async () => {
    writeSettings({ operatorProfile: { autoPublish: false } });
    const quiet = makeService(sampleRetentionPolicy({ now: () => now }));
    await quiet.snapshot();
    await quiet.settle();
    const retained = (await quiet.snapshot()).samples;
    expect(retained).toHaveLength(retainedUnder(CONSUMPTION_SAMPLE_HORIZON_MS));
    expect(retained.length).toBeLessThan(samplesFor(CORPUS_DAYS_BACK));
  });

  it('control: an unreadable preference retains rather than prunes', async () => {
    const policy = sampleRetentionPolicy({
      readProfile: () => {
        throw new Error('settings.json: EACCES');
      },
      now: () => now,
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(policy()).toBe(CONSUMPTION_SAMPLE_MAX_HORIZON_MS);
    } finally {
      errors.mockRestore();
    }
  });
});
