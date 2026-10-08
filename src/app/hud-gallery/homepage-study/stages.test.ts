import { describe, expect, it } from 'vitest';
import { READER_AS_BOTTLENECK } from '@/components/site/bands/fold-copy';
import { STAGES } from './stages';

const prose = (lines: (string | undefined)[]) =>
  lines.filter(Boolean).join(' ');

describe('homepage study copy', () => {
  it('carries no em dashes in either copy set', () => {
    for (const stage of STAGES)
      for (const set of ['deck', 'canon'] as const) {
        const copy = stage.copy[set];
        expect(
          prose([copy.kicker, ...copy.headline, ...(copy.body ?? [])])
        ).not.toMatch(/—/);
      }
  });

  it('never makes the reader the bottleneck', () => {
    for (const stage of STAGES)
      for (const set of ['deck', 'canon'] as const) {
        const copy = stage.copy[set];
        const text = prose([
          copy.kicker,
          ...copy.headline,
          ...(copy.body ?? []),
        ]).toLowerCase();
        for (const phrase of READER_AS_BOTTLENECK)
          expect(text).not.toContain(phrase);
      }
  });

  it('points every dissection at a product signal', () => {
    for (const stage of STAGES.filter(stage => stage.card)) {
      expect(stage.highlight.canon).toBeDefined();
      expect(stage.highlight.deck).toBeDefined();
    }
  });
});
