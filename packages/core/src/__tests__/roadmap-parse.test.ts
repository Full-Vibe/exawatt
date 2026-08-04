import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRoadmap } from '../roadmap/parse';

const OPTS = {
  projectDir: '/repo',
  file: 'ROADMAP.md',
  now: () => 1_752_000_000_000,
};

const CONFORMANT = `---
exawatt-roadmap: v1
---

# Acme roadmap

## Now

### ACME-003 Billing export

Status: now — started 2026-07-02.

Scope:

- CSV export of invoices

Exit criteria:

- finance downloads the month-end CSV without engineering help

Milestones:

- [x] M1 schema
- [ ] M2 export endpoint

## Next

### ACME-007 Webhooks

## Later

### Dark mode

## Shipped

### ACME-001 Auth
`;

// Shape-faithful excerpt of exawatt's own docs/engineering/roadmap.md —
// prose sections, active-build/planned/blocked statuses, landed milestones.
const EXAWATT_EXCERPT = `# Exawatt Engineering Roadmap

## Operating Model

Work is sequenced in this file. Statuses: planned, next, active-build,
blocked, done, stale.

## Now

### ENG-016 Daily-driver adoption

Status: active-build — promoted 2026-07-10.

Scope:

- self-contained installed Mac app
- exact-identity session resume

Exit criteria:

- Exawatt launches from Spotlight

Milestones:

- D0 Baseline gates (landed 2026-07-10): lint scope fixed; PTY smoke added.
- D7 Product-grade updates (activation-gated; implementation landed 2026-07-10): packaged updater.

Sequencing: D0 → D1 → D2, then dogfood begins.

Project doc:

- \`docs/engineering/projects/daily-driver-adoption.md\`

### ENG-017 Project roadmap lens

Status: active-build — design resolved 2026-07-11.

## Next

### ENG-018 Durable, resumable sessions

Status: planned — promoted 2026-07-10 from ENG-002.

### ENG-013 Fleet orchestrator agent

Status: blocked — waiting on ENG-003.
`;

const NEAR_MISS = `# Product roadmap

## Current priorities

| ID | Status | Item |
| --- | --- | --- |
| P0-01 | now | Admin usage page |
| P0-02 | now | Attribution |

## Now

Some intro prose that belongs to no item.

### P1-01 Post-connect checklist

Status: someday — who knows.
`;

const GARBAGE = `just some text
not a roadmap at all
- a stray bullet
`;

describe('parseRoadmap', () => {
  it('keeps Exawatt own v2 roadmap declared and diagnostic-clean', () => {
    const text = readFileSync(
      new URL('../../../../docs/engineering/roadmap.md', import.meta.url),
      'utf8'
    );
    const doc = parseRoadmap(text, {
      projectDir: '/repo',
      file: 'docs/engineering/roadmap.md',
      now: () => 0,
    });
    expect(doc.convention).toBe('exawatt-v2');
    expect(doc.conformance).toBe('declared');
    expect(
      doc.diagnostics.filter(diagnostic => diagnostic.level === 'warn')
    ).toEqual([]);
    expect(doc.unparsedLineCount).toBe(0);
    // The COUNT of backlog rows is live editorial state: it changes whenever
    // anyone grooms the roadmap, and pinning it fails the suite for unrelated
    // work (it has now been re-pinned twice in one day). What this test is
    // for is that the v2 backlog section still parses into well-formed items.
    const backlog = doc.items.filter(item => item.status === 'backlog');
    expect(backlog.length).toBeGreaterThan(0);
    for (const item of backlog) {
      expect(item.id).toMatch(/\S/);
      expect(item.title).toMatch(/\S/);
    }
  });

  it('parses a declared-conformant roadmap fully', () => {
    const doc = parseRoadmap(CONFORMANT, OPTS);
    expect(doc.conformance).toBe('declared');
    expect(doc.items.map(i => i.id)).toEqual([
      'ACME-003',
      'ACME-007',
      '~dark-mode',
      'ACME-001',
    ]);
    expect(doc.items.map(i => i.status)).toEqual([
      'now',
      'next',
      'later',
      'shipped',
    ]);
    expect(doc.unparsedLineCount).toBe(0);
    expect(doc.diagnostics).toEqual([]);

    const billing = doc.items[0];
    expect(billing.declaredId).toBe('ACME-003');
    expect(billing.title).toBe('Billing export');
    expect(billing.statusNote).toBe('now — started 2026-07-02.');
    expect(billing.scope).toEqual(['CSV export of invoices']);
    expect(billing.exitCriteria).toEqual([
      'finance downloads the month-end CSV without engineering help',
    ]);
    expect(billing.milestones).toEqual([
      expect.objectContaining({ id: 'M1', title: 'schema', done: true }),
      expect.objectContaining({
        id: 'M2',
        title: 'export endpoint',
        done: false,
      }),
    ]);

    const darkMode = doc.items[2];
    expect(darkMode.declaredId).toBeNull();
    expect(darkMode.title).toBe('Dark mode');
  });

  it('keeps Backlog compatible in v1 and distinct with provenance in v2', () => {
    const v1 = parseRoadmap(
      `---\nexawatt-roadmap: v1\n---\n\n## Backlog\n\n### ACME-009 Retry failed export\n\nStatus: bug · ACME-003 · quick-capture 2026-08-03\n`,
      OPTS
    );
    expect(v1.items[0]).toMatchObject({ status: 'later', backlog: null });

    const v2 = parseRoadmap(
      `---\nexawatt-roadmap: v2\n---\n\n## Backlog\n\n### ACME-009 Retry failed export\n\nStatus: bug · ACME-003 · quick-capture 2026-08-03\n`,
      OPTS
    );
    expect(v2.convention).toBe('exawatt-v2');
    expect(v2.items[0]).toMatchObject({
      status: 'backlog',
      backlog: {
        kind: 'bug',
        ownerItemId: 'ACME-003',
        provenance: 'quick-capture 2026-08-03',
      },
    });
    expect(v2.diagnostics).toEqual([]);
  });

  it('diagnoses malformed v2 backlog metadata instead of guessing fields', () => {
    for (const status of [
      'bug · ACME-003',
      'ACME-003 · provenance',
      'bug · provenance · ACME-003',
      'bug · ACME-003 ·',
    ]) {
      const doc = parseRoadmap(
        `---\nexawatt-roadmap: v2\n---\n\n## Backlog\n\n### ACME-009 Retry export\n\nStatus: ${status}\n`,
        OPTS
      );
      expect(doc.items[0].backlog).toBeNull();
      expect(doc.diagnostics).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining(
            'kind · owning item id · provenance'
          ),
        })
      );
    }
  });

  it('reads exawatt roadmap vocabulary without edits', () => {
    const doc = parseRoadmap(EXAWATT_EXCERPT, {
      ...OPTS,
      file: 'docs/engineering/roadmap.md',
    });
    expect(doc.conformance).toBe('detected');
    expect(doc.items.map(i => [i.id, i.status])).toEqual([
      ['ENG-016', 'now'],
      ['ENG-017', 'now'],
      ['ENG-018', 'next'],
      ['ENG-013', 'next'],
    ]);

    const eng016 = doc.items[0];
    // active-build → now via the alias table, with an info diagnostic
    expect(
      doc.diagnostics.some(
        d =>
          d.level === 'info' &&
          d.message.includes('"active-build" read as "now"')
      )
    ).toBe(true);
    expect(eng016.milestones).toHaveLength(2);
    expect(eng016.milestones[0]).toMatchObject({ id: 'D0', done: true });
    // "(activation-gated; implementation landed …)" is not a "(landed …)"
    // marker — D7 is gated, and the honest parse is not-done.
    expect(eng016.milestones[1]).toMatchObject({ id: 'D7', done: false });
    expect(eng016.docPaths).toEqual([
      'docs/engineering/projects/daily-driver-adoption.md',
    ]);
    // Sequencing prose is description, not an error
    expect(
      eng016.description.some(line => line.startsWith('Sequencing:'))
    ).toBe(true);

    // planned is position-neutral: stays next per its section
    expect(doc.items[2].status).toBe('next');
    // blocked is a flag, not a queue position
    expect(doc.items[3].status).toBe('next');
    expect(doc.items[3].blocked).toBe(true);

    // Operating Model prose outside queue sections is ignored silently
    expect(doc.unparsedLineCount).toBe(0);
    expect(doc.diagnostics.filter(d => d.level === 'warn')).toEqual([]);
  });

  it('degrades honestly on a near-miss roadmap', () => {
    const doc = parseRoadmap(NEAR_MISS, OPTS);
    // The table under an unrecognized section is ignored; the one real item parses.
    expect(doc.items.map(i => i.id)).toEqual(['P1-01']);
    expect(doc.conformance).toBe('detected');
    // "Current priorities" matches the current→now section alias, so the
    // table lines inside it (4) plus the intro prose in ## Now (1) are
    // counted as unattached — reported, never guessed into items.
    expect(doc.unparsedLineCount).toBe(5);
    expect(
      doc.diagnostics.some(
        d => d.level === 'warn' && d.message.includes('not attached')
      )
    ).toBe(true);
    // Unknown status keeps the section default and warns
    expect(doc.items[0].status).toBe('now');
    expect(
      doc.diagnostics.some(
        d =>
          d.level === 'warn' && d.message.includes('unknown status "someday"')
      )
    ).toBe(true);
  });

  it('reports none-conformance on garbage without inventing items', () => {
    const doc = parseRoadmap(GARBAGE, OPTS);
    expect(doc.items).toEqual([]);
    expect(doc.conformance).toBe('none');
  });

  it('warns on duplicate ids and anchors sources to 1-based lines', () => {
    const doc = parseRoadmap(
      `## Now\n\n### A-1 First\n\n### A-1 Second\n`,
      OPTS
    );
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0].source).toEqual({ file: 'ROADMAP.md', line: 3 });
    expect(
      doc.diagnostics.some(
        d => d.level === 'warn' && d.message.includes('duplicate item id "A-1"')
      )
    ).toBe(true);
  });

  it('keeps dotted milestone ids whole (W0.5, D1.2)', () => {
    const doc = parseRoadmap(
      `## Now\n\n### A-1 Thing\n\nMilestones:\n\n- W0.5 Spatial cockpit — replaced by exposé\n- [x] D1.2 Follow-up\n`,
      OPTS
    );
    expect(doc.items[0].milestones).toEqual([
      expect.objectContaining({
        id: 'W0.5',
        title: 'Spatial cockpit — replaced by exposé',
        done: false,
      }),
      expect.objectContaining({ id: 'D1.2', title: 'Follow-up', done: true }),
    ]);
  });

  it('marks rescoped/retired/dropped/superseded/cut milestones as retired, not pending', () => {
    const doc = parseRoadmap(
      `## Now\n\n### A-1 Thing\n\nMilestones:\n\n- W0.5 Spatial cockpit (rescoped 2026-07 — replaced by exposé)\n- D2 Old plan (retired)\n- D3 Cut idea (dropped for D4)\n- [x] D4 Landed anyway (superseded note is ignored when done)\n- D5 Real next step\n`,
      OPTS
    );
    expect(doc.items[0].milestones).toEqual([
      expect.objectContaining({ id: 'W0.5', done: false, retired: true }),
      expect.objectContaining({ id: 'D2', done: false, retired: true }),
      expect.objectContaining({ id: 'D3', done: false, retired: true }),
      expect.objectContaining({ id: 'D4', done: true, retired: false }),
      expect.objectContaining({ id: 'D5', done: false, retired: false }),
    ]);
  });

  it('hashes content stably for reparse skipping', () => {
    const a = parseRoadmap(CONFORMANT, OPTS);
    const b = parseRoadmap(CONFORMANT, OPTS);
    const c = parseRoadmap(`${CONFORMANT}\nextra`, OPTS);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).not.toBe(c.contentHash);
  });
});
