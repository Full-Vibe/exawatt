import { describe, expect, it } from 'vitest';
import { demoConsumption } from '@/components/consumption/demo-source';
import { gridRows, pivotAbsenceNote, pivotRows, type PivotRow } from './derive';

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
    const claude = rows.filter(r => r.source === 'claude-code' && r.identified);
    expect(claude.length).toBeGreaterThan(0);
    for (const r of claude) {
      expect(r.contextWindow).toBeNull();
      expect(r.contextPeakTokens).toBeNull();
      expect(r.compactions).toBeNull();
    }
  });
});

describe('the Analytics breakdown', () => {
  const demo = demoConsumption();
  const rows = gridRows(demo);

  it('accounts for every operator session by Project and by Agent alike', () => {
    const byProject = pivotRows(demo, 'project', rows);
    const byAgent = pivotRows(demo, 'session', rows);
    const total = (list: PivotRow[]) => list.reduce((n, r) => n + r.sessions, 0);
    expect(total(byAgent)).toBe(rows.length);
    expect(total(byProject)).toBeGreaterThan(0);
    expect(byAgent.every(r => r.drill.length === 1)).toBe(true);
  });

  it('orders rows by weighted burn, heaviest first', () => {
    const byAgent = pivotRows(demo, 'session', rows);
    for (let i = 1; i < byAgent.length; i += 1) {
      expect(byAgent[i - 1].weighted).toBeGreaterThanOrEqual(byAgent[i].weighted);
    }
  });
});

/* ------------------------------------------------------------------ */
/* a missing input is stated, never drawn as a measurement (D3)        */
/* ------------------------------------------------------------------ */

describe('pivotAbsenceNote', () => {
  const row = (over: Partial<PivotRow> & { id: string }): PivotRow => ({
    label: over.id,
    usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, reasoning: null },
    weighted: 1,
    sessions: 1,
    drill: [],
    ...over,
  });

  it('says no session resolves to a Project rather than drawing one grey bar', () => {
    const rows = [row({ id: 'no-project', unknown: true })];
    expect(pivotAbsenceNote('project', rows)).not.toBeNull();
  });

  it('stays silent as soon as one real row exists', () => {
    const rows = [row({ id: 'exawatt' }), row({ id: 'no-project', unknown: true })];
    expect(pivotAbsenceNote('project', rows)).toBeNull();
  });

  it('gives the empty corpus an empty state', () => {
    expect(pivotAbsenceNote('project', [])).not.toBeNull();
    expect(pivotAbsenceNote('session', [])).not.toBeNull();
  });
});
