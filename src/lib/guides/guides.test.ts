// @scans docs/product/guides/**
import { describe, expect, it } from 'vitest';
import { guidePath, parseGuides, publishedGuides } from './guides';

const guide = (
  slug: string,
  { front = '', body = 'A lead sentence.' }: { front?: string; body?: string }
) => ({ name: `${slug}.md`, text: `---\n${front}\n---\n\n${body}\n` });

const published = (name: string, order: number, body?: string) =>
  guide(name, {
    front: `title: ${name}\ndescription: About ${name}.\npublished: true\norder: ${order}`,
    body,
  });

const unpublished = (name: string, body?: string) =>
  guide(name, { front: `title: ${name}\npublished: false`, body });

describe('the guides (ENG-031 W26)', () => {
  it('reads every guide in the repository, and the published ones render', () => {
    const guides = publishedGuides();
    expect(guides.length).toBeGreaterThan(0);
    for (const each of guides) expect(each.blocks.length).toBeGreaterThan(0);
  });

  it('keeps the guide URLs other surfaces link to', () => {
    // The desktop app and the marketing plan link to these addresses.
    const paths = publishedGuides().map(each => guidePath(each.slug));
    expect(paths).toEqual(
      expect.arrayContaining([
        '/guides/agents-review-each-other',
        '/guides/gemini',
      ])
    );
  });

  it('publishes only what its front matter publishes, in order', () => {
    const guides = parseGuides([
      published('second', 2),
      unpublished(
        'internal',
        'Anything — even an em dash, or ../reference.md.'
      ),
      published('first', 1),
    ]);
    expect(guides.map(each => each.slug)).toEqual(['first', 'second']);
  });

  it('resolves a link to another published guide to its page', () => {
    const [first] = parseGuides([
      published('first', 1, 'See [the second](second.md).'),
      published('second', 2),
    ]);
    const block = first.blocks[0];
    expect(block.kind === 'paragraph' && block.runs[1]?.href).toBe(
      '/guides/second'
    );
  });

  it('refuses a guide that would render broken or off-voice', () => {
    // Each case names the reason it must fail for, so one refusal cannot
    // pass on another's account.
    const refusals: [ReturnType<typeof guide>[], RegExp][] = [
      [[guide('no-switch', { front: 'title: No switch' })], /published must/u],
      [
        [guide('typo', { front: 'title: x\npublished: yes' })],
        /published must/u,
      ],
      [[{ name: 'bare.md', text: '# No front matter\n' }], /front matter/u],
      [[guide('Bad_Name', { front: 'title: x\npublished: false' })], /named/u],
      [
        [guide('no-blurb', { front: 'title: x\npublished: true\norder: 1' })],
        /description/u,
      ],
      [[published('dash', 1, 'One — two.')], /em dash/u],
      [[published('title-twice', 1, '# Title again')], /## or ###/u],
      [[published('quote', 1, '> A quote.')], /quote/u],
      [
        [
          published('dead-link', 1, 'See [it](internal.md).'),
          unpublished('internal'),
        ],
        /not a published guide/u,
      ],
      [
        [published('repo-link', 1, 'See [it](../reference/x.md).')],
        /links to/u,
      ],
      [[published('bold', 1, 'An **unclosed mark.')], /unbalanced/u],
      [[published('a', 1), published('b', 1)], /shares order/u],
    ];
    for (const [files, reason] of refusals)
      expect(() => parseGuides(files), files[0].name).toThrow(reason);
  });
});
