import { describe, expect, it, vi } from 'vitest';
import { CONTEXT_LABEL_GOLD_CASES } from './gold-cases';
import {
  evaluateContextLabelGoldCases,
  scoreContextLabelGoldCase,
} from './gold-evaluator';

describe('context-label gold evaluator', () => {
  it('executes every committed case and reports a passing replay', async () => {
    const predict = vi.fn(
      async (gold: (typeof CONTEXT_LABEL_GOLD_CASES)[number]) => ({
        label: gold.expectedLabel,
        relationship: gold.expectedRelationship,
        confidence: 1,
      })
    );
    const report = await evaluateContextLabelGoldCases(
      CONTEXT_LABEL_GOLD_CASES,
      predict
    );
    expect(predict).toHaveBeenCalledTimes(CONTEXT_LABEL_GOLD_CASES.length);
    expect(report).toMatchObject({
      total: CONTEXT_LABEL_GOLD_CASES.length,
      passed: CONTEXT_LABEL_GOLD_CASES.length,
      passRate: 1,
    });
  });

  it('fails a semantic-label or relationship regression with diagnostics', () => {
    const score = scoreContextLabelGoldCase(CONTEXT_LABEL_GOLD_CASES[2], {
      label: 'Animate project tabs',
      relationship: 'same_context',
      confidence: 0.8,
    });
    expect(score.passed).toBe(false);
    expect(score.labelPassed).toBe(false);
    expect(score.relationshipPassed).toBe(false);
    expect(score.missingRequiredTerms).toEqual(['agent', 'sources', 'launch']);
  });

  it('permits wording variation only when required work-world anchors survive', () => {
    const score = scoreContextLabelGoldCase(CONTEXT_LABEL_GOLD_CASES[5], {
      label: 'Fix Patty flowsheet scraper',
      relationship: 'new_context',
      confidence: 0.9,
    });
    expect(score.passed).toBe(true);
  });

  it('rejects labels that violate production output hygiene', () => {
    const score = scoreContextLabelGoldCase(CONTEXT_LABEL_GOLD_CASES[0], {
      label: 'I am improving agent context summaries',
      relationship: 'new_context',
      confidence: 0.9,
    });
    expect(score.hygienePassed).toBe(false);
    expect(score.labelPassed).toBe(false);
    expect(score.passed).toBe(false);
  });
});
