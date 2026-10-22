import { describe, expect, it } from 'vitest';
import {
  isLineTerminatorChar,
  isWhitespaceChar,
  trimEdgeRuns,
  trimTrailingRun,
} from './runs';

describe('character runs', () => {
  it('trims a trailing run of literal characters', () => {
    expect(trimTrailingRun('/w/acme//', '/')).toBe('/w/acme');
    expect(trimTrailingRun('C:\\w\\/', '/\\')).toBe('C:\\w');
    expect(trimTrailingRun('///', '/')).toBe('');
    expect(trimTrailingRun('acme', '/')).toBe('acme');
  });

  it('trims both edges, by characters or by predicate', () => {
    expect(trimEdgeRuns('--open-claw--', '-')).toBe('open-claw');
    expect(trimEdgeRuns('---', '-')).toBe('');
    expect(trimEdgeRuns(' \tword\u3000', isWhitespaceChar)).toBe('word');
  });

  it('matches exactly what a regex \\s and . see, for every code unit', () => {
    const disagreements: number[] = [];
    for (let code = 0; code <= 0xffff; code++) {
      const char = String.fromCharCode(code);
      if (
        isWhitespaceChar(char) !== /\s/.test(char) ||
        isLineTerminatorChar(char) === /./.test(char)
      ) {
        disagreements.push(code);
      }
    }
    expect(disagreements).toEqual([]);
  });
});
