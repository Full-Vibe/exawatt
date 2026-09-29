import { describe, expect, it } from 'vitest';
import { parseJsonWithComments } from './json-with-comments';

describe('parseJsonWithComments', () => {
  it('reads what the gemini-cli family writes: comments and a byte-order mark', () => {
    expect(
      parseJsonWithComments(
        '\uFEFF{\n  // chosen with /auth\n  "a": 1, /* inline */ "b": [2]\n}\n'
      )
    ).toEqual({ a: 1, b: [2] });
  });

  it('leaves comment markers inside strings alone', () => {
    expect(
      parseJsonWithComments(
        '{"url": "https://example.com//x", "glob": "/* keep */", "q": "a\\"//b"}'
      )
    ).toEqual({
      url: 'https://example.com//x',
      glob: '/* keep */',
      q: 'a"//b',
    });
  });

  it('is otherwise strict, as the harness is', () => {
    expect(() => parseJsonWithComments('{"a": 1,}')).toThrow(SyntaxError);
    expect(() => parseJsonWithComments('{"a": 1')).toThrow(SyntaxError);
  });
});
