import {
  contextLabelRejectionReason,
  type ContextLabelResult,
} from './contract';
import type { ContextLabelGoldCase } from './gold-cases';

const STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'of', 'the', 'to', 'ux']);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(token => token && !STOP_WORDS.has(token));
}

function normalized(value: string): string {
  return tokens(value).join(' ');
}

export interface ContextLabelGoldCaseScore {
  id: string;
  passed: boolean;
  relationshipPassed: boolean;
  labelPassed: boolean;
  hygienePassed: boolean;
  labelTokenRecall: number;
  missingRequiredTerms: string[];
  expected: Pick<
    ContextLabelGoldCase,
    'expectedLabel' | 'expectedRelationship'
  >;
  actual: Pick<ContextLabelResult, 'label' | 'relationship'>;
}

export interface ContextLabelGoldReport {
  total: number;
  passed: number;
  passRate: number;
  cases: ContextLabelGoldCaseScore[];
}

export function scoreContextLabelGoldCase(
  gold: ContextLabelGoldCase,
  actual: ContextLabelResult
): ContextLabelGoldCaseScore {
  const expectedTokens = new Set(tokens(gold.expectedLabel));
  const actualTokens = new Set(tokens(actual.label));
  const matched = [...expectedTokens].filter(token => actualTokens.has(token));
  const labelTokenRecall =
    expectedTokens.size === 0 ? 0 : matched.length / expectedTokens.size;
  const missingRequiredTerms = gold.requiredLabelTerms.filter(term =>
    tokens(term).some(token => !actualTokens.has(token))
  );
  const exact = normalized(actual.label) === normalized(gold.expectedLabel);
  const hygienePassed = contextLabelRejectionReason(actual.label) === null;
  const labelPassed =
    hygienePassed &&
    (exact ||
      (labelTokenRecall >= (gold.minimumLabelTokenRecall ?? 0.5) &&
        missingRequiredTerms.length === 0));
  const relationshipPassed = actual.relationship === gold.expectedRelationship;
  return {
    id: gold.id,
    passed: labelPassed && relationshipPassed,
    relationshipPassed,
    labelPassed,
    hygienePassed,
    labelTokenRecall,
    missingRequiredTerms,
    expected: {
      expectedLabel: gold.expectedLabel,
      expectedRelationship: gold.expectedRelationship,
    },
    actual: { label: actual.label, relationship: actual.relationship },
  };
}

export async function evaluateContextLabelGoldCases(
  cases: readonly ContextLabelGoldCase[],
  predict: (gold: ContextLabelGoldCase) => Promise<ContextLabelResult>
): Promise<ContextLabelGoldReport> {
  const scores: ContextLabelGoldCaseScore[] = [];
  for (const gold of cases) {
    scores.push(scoreContextLabelGoldCase(gold, await predict(gold)));
  }
  const passed = scores.filter(score => score.passed).length;
  return {
    total: scores.length,
    passed,
    passRate: scores.length === 0 ? 0 : passed / scores.length,
    cases: scores,
  };
}
