import { describe, expect, it } from 'vitest';
import {
  MAX_SOURCE_SENTENCE_LENGTH,
  MAX_TEXT_LENGTH,
  describeSourceError,
  isRecord,
  sourceSentence,
  validText,
} from './untrusted-input';

/**
 * A source's words, on their way to an operator (ENG-010).
 *
 * The reason this module exists is the case below: the Gateway session
 * collapsed and stripped a refusal before quoting it, and the runtime sliced
 * the same kind of string and handed it on raw. Both ended up in front of a
 * person, so both had to be the same rule.
 */

describe('a source’s own words', () => {
  it('collapses a multi-line refusal to one readable line', () => {
    const error = new Error('NOT_PAIRED:\n  pairing required\n\n  approve it');

    expect(sourceSentence(error)).toBe(
      'NOT_PAIRED: pairing required approve it'
    );
    expect(describeSourceError(error, 'fallback')).toBe(
      'NOT_PAIRED: pairing required approve it'
    );
  });

  it('strips control characters before either bound applies', () => {
    const error = new Error('refused\u0000\u001b[31m\u007f now');

    // A terminal escape quoted into product copy is a remote peer writing to
    // the operator's screen, whichever surface prints it.
    expect(sourceSentence(error)).toBe('refused [31m now');
    expect(describeSourceError(error, 'fallback')).toBe('refused [31m now');
  });

  it('bounds a quotation harder than an answer, because it is a guest', () => {
    const error = new Error('x'.repeat(5_000));

    expect(sourceSentence(error)).toHaveLength(MAX_SOURCE_SENTENCE_LENGTH);
    expect(describeSourceError(error, 'fallback')).toHaveLength(
      MAX_TEXT_LENGTH
    );
  });

  it('says nothing rather than quoting an empty pair of quotes', () => {
    expect(sourceSentence(new Error('   \n  '))).toBeNull();
    expect(sourceSentence('not an error')).toBeNull();
    expect(
      describeSourceError(new Error('  '), 'The Gateway said nothing.')
    ).toBe('The Gateway said nothing.');
    expect(describeSourceError(undefined, 'The Gateway said nothing.')).toBe(
      'The Gateway said nothing.'
    );
  });
});

describe('reading a value nothing produced', () => {
  it('refuses everything that is not a plain record', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    for (const value of [null, undefined, [], 'x', 7, true]) {
      expect(isRecord(value)).toBe(false);
    }
  });

  it('refuses a string that is absent, empty, or past its bound', () => {
    expect(validText('scout')).toBe(true);
    expect(validText('')).toBe(false);
    expect(validText(undefined)).toBe(false);
    expect(validText(7)).toBe(false);
    expect(validText('x'.repeat(MAX_TEXT_LENGTH))).toBe(true);
    expect(validText('x'.repeat(MAX_TEXT_LENGTH + 1))).toBe(false);
  });
});
