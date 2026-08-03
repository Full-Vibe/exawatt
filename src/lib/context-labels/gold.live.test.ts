import { beforeAll, describe, expect, it } from 'vitest';
import {
  contextLabelAnthropicRequest,
  parseContextLabelResponse,
} from './contract';
import { CONTEXT_LABEL_GOLD_CASES } from './gold-cases';
import { evaluateContextLabelGoldCases } from './gold-evaluator';

const live = process.env.EXAWATT_CONTEXT_LABEL_GOLD_LIVE === '1';

describe.skipIf(!live)('live context-label gold corpus', () => {
  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required for the live gold eval');
    }
  });

  it('holds every production-derived work-world regression', async () => {
    const report = await evaluateContextLabelGoldCases(
      CONTEXT_LABEL_GOLD_CASES,
      async gold => {
        const input = {
          schemaVersion: 1 as const,
          sessionKey: `gold:${gold.id}`,
          currentLabel: gold.currentLabel,
          currentLabelSource: gold.currentLabel ? ('accepted' as const) : null,
          initialInstruction: null,
          recentInstructions: gold.instructions.map((text, index) => ({
            text,
            submittedAt: index + 1,
          })),
        };
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY!,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(contextLabelAnthropicRequest(input)),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok)
          throw new Error(`Anthropic returned ${response.status}`);
        return parseContextLabelResponse(
          (await response.json()) as Parameters<
            typeof parseContextLabelResponse
          >[0],
          gold.currentLabel,
          input.currentLabelSource
        );
      }
    );
    expect(
      report.cases.filter(score => !score.passed),
      JSON.stringify(report.cases, null, 2)
    ).toEqual([]);
  }, 180_000);
});
