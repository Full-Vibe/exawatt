import { describe, expect, it } from 'vitest';
import { inlineRuns, parseBlocks } from './site-docs.mjs';

const where = { label: 'doc', source: 'test.md' };
const blocks = (text: string, marks = ['strong', 'code', 'link'] as const) =>
  parseBlocks(text.split('\n'), { ...where, marks: [...marks] });

describe('the site document pipeline (ENG-031)', () => {
  it('reads the blocks a guide or a changelog entry is made of', () => {
    expect(
      blocks(
        [
          '## A heading',
          'A paragraph',
          'wrapped.',
          '',
          '- One',
          '  continued.',
          '',
          '- Two.',
          '1. First.',
          '',
          '```prompt',
          'A prompt',
          'wrapped.',
          '```',
        ].join('\n')
      )
    ).toEqual([
      { kind: 'heading', level: 2, text: 'A heading' },
      { kind: 'paragraph', text: 'A paragraph wrapped.' },
      { kind: 'list', ordered: false, items: ['One continued.', 'Two.'] },
      { kind: 'list', ordered: true, items: ['First.'] },
      { kind: 'code', lang: 'prompt', text: 'A prompt wrapped.' },
    ]);
  });

  it('keeps a shell block line by line', () => {
    expect(blocks('```sh\na\n  b\n```')).toEqual([
      { kind: 'code', lang: 'sh', text: 'a\n  b' },
    ]);
  });

  it('recognises only the marks a kind admits', () => {
    expect(inlineRuns('**a** `b` [c](/d)', { marks: ['strong'] })).toEqual([
      { text: 'a', strong: true },
      { text: ' `b` [c](/d)', strong: false },
    ]);
    expect(
      inlineRuns('**a** `b` [c](/d)', { marks: ['strong', 'code', 'link'] })
    ).toEqual([
      { text: 'a', strong: true },
      { text: ' ', strong: false },
      { text: 'b', strong: false, code: true },
      { text: ' ', strong: false },
      { text: 'c', strong: false, href: '/d' },
    ]);
  });

  it('refuses what it cannot render', () => {
    for (const text of [
      '<div>html</div>',
      '> a quote',
      '```js\nx\n```',
      '```sh\nnever closed',
      '- item\nlazy continuation',
      '    indented code',
      'An `unclosed code mark',
      'An **unclosed bold',
    ])
      expect(() => blocks(text), text).toThrow(/\[doc\] test\.md/u);
  });
});
