import { describe, expect, it } from 'vitest';
import { DEMO_BASE_AGENTS } from '@exawatt/core';
import {
  demoCoordinationBoard,
  HANDOFF_SPECIMEN,
  LADDER,
  SUBSTRATE,
} from './model';

describe('demoCoordinationBoard (ENG-029 C1)', () => {
  const board = demoCoordinationBoard();

  it('reads one Project as common ground, from real fixture link truth', () => {
    expect(board.project.key).toBe('dispatch-engine');
    expect(board.rows.length).toBeGreaterThan(2);
    const expected = DEMO_BASE_AGENTS.filter(
      agent =>
        agent.projectKey === 'dispatch-engine' &&
        agent.roadmapItemId !== null &&
        agent.link !== null
    );
    expect(board.rows.length).toBe(expected.length);
    for (const row of board.rows) {
      expect(row.itemId).toBe(row.agent.roadmapItemId);
      expect(row.minutesSinceActivity).toBeGreaterThanOrEqual(0);
    }
  });

  it('orders by recency, freshest first', () => {
    const minutes = board.rows.map(row => row.minutesSinceActivity);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
  });

  it('speaks the real ENG-017 link vocabulary', () => {
    const allowed = new Set([
      'declared at launch',
      'read from branch',
      'read from title',
    ]);
    for (const row of board.rows) expect(allowed.has(row.how)).toBe(true);
  });

  it('rejects unknown projects loudly', () => {
    expect(() => demoCoordinationBoard('nope')).toThrow(/unknown demo project/);
  });
});

describe('coordination vocabulary (ENG-029 C2 rule)', () => {
  it('never says "claim" — the record is an assignment', () => {
    // `claim` is this product's assurance word (source-reported claims);
    // the operator explicitly forbade overloading it for coordination.
    const copy = JSON.stringify({ SUBSTRATE, LADDER, HANDOFF_SPECIMEN });
    expect(copy.toLowerCase()).not.toContain('claim');
  });

  it('assignments flow from the operator, and the rung is gated', () => {
    const assignments = LADDER.find(rung => rung.name === 'Assignments')!;
    expect(assignments.rung).toBe(1);
    expect(assignments.detail).toContain('The operator assigns');
    expect(assignments.state).toContain('gated');
  });
});
