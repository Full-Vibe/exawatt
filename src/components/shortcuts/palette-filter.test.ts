import { describe, expect, it } from 'vitest';
import {
  PALETTE_SCORE,
  PALETTE_VALUE_SEPARATOR,
  paletteFilter,
  paletteValue,
} from './palette-filter';

const usage = paletteValue('Usage', 'nav-consumption');
const usageKeywords = ['go', 'tokens', 'cost', 'spend', 'consumption'];
const session = paletteValue('Refactor usage metering', 'pty-123');

describe('paletteValue', () => {
  it('joins name and suffix with the invisible separator', () => {
    expect(usage).toBe(`Usage${PALETTE_VALUE_SEPARATOR}nav-consumption`);
  });

  it('keeps equal names unique via the suffix', () => {
    expect(paletteValue('Usage', 'a')).not.toBe(paletteValue('Usage', 'b'));
  });
});

describe('paletteFilter structural bands', () => {
  it('scores an exact name match above every other band', () => {
    expect(paletteFilter(usage, 'usage', usageKeywords)).toBe(
      PALETTE_SCORE.exactName
    );
    expect(paletteFilter(usage, 'Usage', usageKeywords)).toBe(
      PALETTE_SCORE.exactName
    );
  });

  it('scores a name prefix above word-in-name and keyword matches', () => {
    expect(paletteFilter(usage, 'usa', usageKeywords)).toBe(
      PALETTE_SCORE.namePrefix
    );
    // the session CONTAINS "usa" at a word boundary, but only mid-name
    expect(paletteFilter(session, 'usa', [])).toBe(PALETTE_SCORE.wordInName);
    expect(paletteFilter(usage, 'usa', usageKeywords)).toBeGreaterThan(
      paletteFilter(session, 'usa', [])
    );
  });

  it('scores keyword matches below every name band, above fuzzy', () => {
    const score = paletteFilter(usage, 'tokens', usageKeywords);
    expect(score).toBe(PALETTE_SCORE.keyword);
    expect(score).toBeLessThan(PALETTE_SCORE.wordInName);
    expect(score).toBeGreaterThan(1);
  });

  it('never matches on the unique suffix as if it were the name', () => {
    expect(paletteFilter(usage, 'nav-consumption', [])).toBeLessThan(
      PALETTE_SCORE.keyword
    );
  });

  it('falls back to cmdk fuzzy scoring inside (0, 1]', () => {
    const fuzzy = paletteFilter(session, 'rfum', []);
    expect(fuzzy).toBeGreaterThan(0);
    expect(fuzzy).toBeLessThanOrEqual(1);
  });

  it('returns 0 for a miss', () => {
    expect(paletteFilter(usage, 'zzzz', usageKeywords)).toBe(0);
  });

  it('keeps session-name prefixes in the same band as nav-name prefixes', () => {
    // DOM order decides the tie, so session switching keeps winning its own
    // queries — the bands must NOT separate these two.
    expect(paletteFilter(session, 'refactor', [])).toBe(
      paletteFilter(usage, 'usa', usageKeywords)
    );
  });
});

describe('paletteFilter go-phrasings', () => {
  it('scores "go to usage" a hair below the bare query', () => {
    const bare = paletteFilter(usage, 'usage', usageKeywords);
    const goTo = paletteFilter(usage, 'go to usage', usageKeywords);
    const go = paletteFilter(usage, 'go usage', usageKeywords);
    expect(goTo).toBeGreaterThan(PALETTE_SCORE.namePrefix);
    expect(goTo).toBeLessThan(bare);
    expect(go).toBe(goTo);
  });

  it('lets a literal raw-query match beat the stripped interpretation of the same band', () => {
    // "go to market" typed literally: the row NAMED that exact phrase earns
    // the raw exact band; the stripped reading of "Market" lands a hair below.
    const literal = paletteValue('Go to market', 'row-x');
    expect(paletteFilter(literal, 'go to market', [])).toBeGreaterThan(
      paletteFilter(paletteValue('Market', 'row-y'), 'go to market', [])
    );
  });

  it('does not treat a bare "go" as a phrasing', () => {
    // "go" alone matches the nav rows through their `go` keyword
    expect(paletteFilter(usage, 'go', usageKeywords)).toBe(
      PALETTE_SCORE.keyword
    );
  });

  it('keeps a stripped fuzzy match positive', () => {
    const fuzzy = paletteFilter(session, 'go to rfum', []);
    expect(fuzzy).toBeGreaterThan(0);
    expect(fuzzy).toBeLessThanOrEqual(1);
  });
});
