/**
 * ENG-008 E12 — the honesty machinery, pinned.
 *
 * These are the assertions the E12 corpus says every multiplexer eventually
 * fails. They are written against the shared model rather than any one
 * direction, because all three render it.
 */
import { describe, expect, it } from 'vitest';
import {
  ROSTER,
  STATES,
  ambientProjection,
  buildLedger,
  buildRoster,
  PIVOTS,
  type StateId,
} from './model';

const ALL: StateId[] = STATES.map(s => s.id);

describe('the roster is a fixed denominator', () => {
  it('renders every roster entry in every state, in the same order', () => {
    for (const id of ALL) {
      const view = buildRoster(id);
      expect(view.rows.map(r => r.id)).toEqual(ROSTER.map(r => r.id));
    }
  });

  it('never shrinks the coverage denominator when a read fails', () => {
    const base = buildRoster('all-reporting').headline.coverage;
    for (const id of ALL) {
      const c = buildRoster(id).headline.coverage;
      expect(c.defined).toBe(base.defined);
      expect(c.roster).toBe(base.roster);
    }
  });
});

describe('monotonicity — losing information never flatters the headline', () => {
  const base = buildRoster('all-reporting').headline;

  it('a failed source read does not lower the verdict severity', () => {
    const degraded = buildRoster('unreadable').headline;
    expect(degraded.verdict.rank).toBeGreaterThanOrEqual(base.verdict.rank);
  });

  it('a failed source read does not raise the reported total', () => {
    const degraded = buildRoster('unreadable').headline;
    expect(degraded.bound.value).toBeLessThanOrEqual(base.bound.value);
  });

  it('a partial scan does not raise the reported total', () => {
    const scanning = buildRoster('first-scan').headline;
    expect(scanning.bound.value).toBeLessThanOrEqual(base.bound.value);
  });

  it('states the total as a lower bound exactly when it is knowably incomplete', () => {
    expect(buildRoster('all-reporting').headline.bound.isBound).toBe(false);
    expect(buildRoster('unreadable').headline.bound.isBound).toBe(true);
    expect(buildRoster('first-scan').headline.bound.isBound).toBe(true);
  });

  it('keeps the last good windows on a source whose read failed', () => {
    const row = buildRoster('unreadable').rows[0];
    expect(row.state).toBe('unreadable');
    expect(row.windows.length).toBeGreaterThan(0);
    // and the freshness stamp tells the truth about their age
    expect(row.asOfMs).toBeLessThan(
      buildRoster('all-reporting').rows[0].asOfMs!
    );
  });
});

describe('absence is never zero and never vanishes', () => {
  it('a source with no readable window reports no percentage at all', () => {
    for (const id of ALL) {
      for (const cell of ambientProjection(buildRoster(id)).cells) {
        if (cell.usedPercent === null) continue;
        // a rendered figure must have come from a window that exists
        const row = buildRoster(id).rows.find(r => r.id === cell.id)!;
        expect(row.windows.length).toBeGreaterThan(0);
      }
    }
  });

  it('never renders 0% or 100% for a source that could not be read', () => {
    for (const id of ALL) {
      const view = buildRoster(id);
      for (const row of view.rows) {
        if (row.windows.length > 0) continue;
        const cell = ambientProjection(view).cells.find(c => c.id === row.id)!;
        expect(cell.usedPercent).toBeNull();
      }
    }
  });

  it('gives every unreadable or unconnected source a product-language note', () => {
    for (const id of ALL) {
      for (const row of buildRoster(id).rows) {
        if (row.windows.length > 0) continue;
        expect(row.note).toBeTruthy();
      }
    }
  });
});

describe('the split between broken and settled', () => {
  it('offers a repair verb for a credential failure', () => {
    const row = buildRoster('unreadable').rows[0];
    expect(row.repair).not.toBeNull();
  });

  it('offers no repair verb for a source that is legitimately unavailable', () => {
    const view = buildRoster('unavailable');
    const grok = view.rows.find(r => r.id === 'xai-plan')!;
    expect(grok.state).toBe('unavailable');
    expect(grok.repair).toBeNull();
    const console = view.rows.find(r => r.id === 'anthropic-console')!;
    expect(console.state).toBe('unavailable');
    expect(console.repair).toBeNull();
  });

  it('never puts a settled fact in the needs-attention block', () => {
    for (const id of ALL) {
      const view = buildRoster(id);
      for (const row of view.attention) {
        expect(['unreadable', 'stale']).toContain(row.state);
      }
    }
  });

  it('leaves the attention block empty when nothing is broken', () => {
    expect(buildRoster('all-reporting').attention).toHaveLength(0);
    expect(buildRoster('dual-signal').attention).toHaveLength(0);
  });
});

describe('the glance is a projection of the detail', () => {
  it('carries the same rows in the same order as the page', () => {
    for (const id of ALL) {
      const view = buildRoster(id);
      expect(ambientProjection(view).cells.map(c => c.id)).toEqual(
        view.rows.map(r => r.id)
      );
    }
  });

  it('speaks the page verdict verbatim', () => {
    for (const id of ALL) {
      const view = buildRoster(id);
      expect(ambientProjection(view).word).toBe(view.headline.verdict.word);
      expect(ambientProjection(view).tone).toBe(view.headline.verdict.tone);
    }
  });
});

describe('ordering answers "what runs out first"', () => {
  it('picks the binding window by time to exhaustion, not by percent used', () => {
    const view = buildRoster('dual-signal');
    expect(view.headline.binding).not.toBeNull();
    expect(view.headline.binding!.read.exhaustsBeforeReset).toBe(true);
  });

  it('names the largest expiring allocation alongside it', () => {
    const view = buildRoster('dual-signal');
    expect(view.headline.expiring).not.toBeNull();
    expect(view.headline.expiring!.opportunity!.coursePts).toBeGreaterThan(50);
    expect(view.headline.expiringSource!.id).not.toBe(
      view.headline.bindingSource!.id
    );
  });
});

describe('the ledger draws its residual', () => {
  it('always carries the off-tool plan-burn row, in every pivot', () => {
    for (const p of PIVOTS) {
      const ledger = buildLedger(p.id, buildRoster('dual-signal'));
      const residual = ledger.rows.find(r => r.key === 'residual-offtool');
      expect(residual).toBeDefined();
      expect(residual!.nt).toBeNull();
      expect(residual!.residual).toBe(true);
    }
  });

  it('computes the total independently of the rows it draws', () => {
    const view = buildRoster('dual-signal');
    const byProject = buildLedger('project', view);
    const byModel = buildLedger('model', view);
    // Two different breakdowns of the same corpus share one total.
    expect(byProject.total.nt).toBe(byModel.total.nt);
  });

  it('marks the total as a bound while the scan is partial', () => {
    expect(
      buildLedger('project', buildRoster('first-scan')).total.isBound
    ).toBe(true);
    expect(
      buildLedger('project', buildRoster('all-reporting')).total.isBound
    ).toBe(false);
  });
});

describe('the authored state is declared', () => {
  it('marks exactly one state as authored, with a stated reason', () => {
    const authored = STATES.filter(s => s.origin === 'authored');
    expect(authored).toHaveLength(1);
    expect(authored[0].originNote.length).toBeGreaterThan(40);
  });
});
