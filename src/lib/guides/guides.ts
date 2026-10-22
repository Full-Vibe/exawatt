import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cache } from 'react';
import {
  inlineRuns,
  parseBlocks,
  readFrontMatter,
  refuseEmDash,
  SiteDocError,
  type InlineOptions,
  type InlineRun,
} from '@/lib/site-docs/site-docs.mjs';

/**
 * The guides on the website (ENG-031 W26): one Markdown file per guide under
 * `docs/product/guides/`, rendered at `/guides/<file name>` through the same
 * document pipeline as the changelog.
 *
 *   ---
 *   title: Run Gemini in Exawatt
 *   description: One sentence for the index and search results.
 *   published: true
 *   order: 2
 *   ---
 *
 * `published` is the only switch. A guide marked `published: false` stays a
 * repository document: its front matter is checked, its body is not, and it
 * has no page, no index row and no sitemap line. A published guide is public
 * copy, so its whole file must pass the grammar: no em dash, `##` and `###`
 * headings under the title, and links only to the web or to other published
 * guides (`other-guide.md`, which becomes `/guides/other-guide`).
 */

const LABEL = 'guides';
const FRONT_KEYS = ['title', 'description', 'published', 'order'] as const;
const GUIDE_MARKS = ['strong', 'code', 'link'] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GUIDE_LINK = /^(?:\.\/)?([a-z0-9-]+)\.md$/u;

export function guidePath(slug: string): string {
  return `/guides/${slug}`;
}

type GuideBlock =
  | { kind: 'heading'; level: 2 | 3; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'list'; ordered: boolean; items: InlineRun[][] }
  | { kind: 'code'; lang: 'sh' | 'text' | 'prompt'; text: string };

export interface Guide {
  slug: string;
  title: string;
  description: string;
  order: number;
  blocks: GuideBlock[];
}

interface GuideFile {
  /** The file's name, `<slug>.md`. */
  name: string;
  text: string;
}

function fail(source: string, message: string): never {
  throw new SiteDocError(LABEL, source, message);
}

/**
 * The published guides among `files`, in their `order`. Every file's front
 * matter is checked, so a typo in the switch fails loudly instead of quietly
 * unpublishing a page.
 */
export function parseGuides(files: readonly GuideFile[]): Guide[] {
  const candidates = files.map(({ name, text }) => {
    const slug = name.replace(/\.md$/u, '');
    if (!name.endsWith('.md') || !SLUG.test(slug))
      fail(name, 'a guide is named <lowercase-words>.md');
    const where = { label: LABEL, source: name };
    const { front, body } = readFrontMatter(text, {
      ...where,
      keys: FRONT_KEYS,
    });
    if (!front.title) fail(name, 'title is empty');
    if (front.published !== 'true' && front.published !== 'false')
      fail(name, 'published must be true or false');
    return { slug, name, text, front, body };
  });

  const published = candidates.filter(file => file.front.published === 'true');
  const slugs = new Set(published.map(file => file.slug));
  const orders = new Map<number, string>();

  const guides = published.map(({ slug, name, text, front, body }) => {
    refuseEmDash(text, { label: LABEL, source: name });
    if (!front.description) fail(name, 'a published guide needs a description');
    const order = Number(front.order);
    if (!Number.isInteger(order) || order < 1)
      fail(name, 'a published guide needs an order of 1 or more');
    if (orders.has(order))
      fail(name, `shares order ${order} with ${orders.get(order)}`);
    orders.set(order, name);

    const options: InlineOptions & { label: string; source: string } = {
      label: LABEL,
      source: name,
      marks: GUIDE_MARKS,
      link: href => {
        if (/^https:\/\/\S+$/u.test(href) || /^\/[\w./?=&#-]*$/u.test(href))
          return href;
        const target = GUIDE_LINK.exec(href)?.[1];
        if (target && slugs.has(target)) return guidePath(target);
        return fail(
          name,
          target
            ? `links to ${href}, which is not a published guide`
            : `links to "${href}"; use https://, a site path or another-guide.md`
        );
      },
    };
    const runs = (value: string) => inlineRuns(value, options);
    const blocks = parseBlocks(body, options).map((block): GuideBlock => {
      switch (block.kind) {
        case 'heading':
          if (block.level !== 2 && block.level !== 3)
            fail(
              name,
              `headings are ## or ### under the title: "${block.text}"`
            );
          return {
            kind: 'heading',
            level: block.level,
            runs: runs(block.text),
          };
        case 'paragraph':
          return { kind: 'paragraph', runs: runs(block.text) };
        case 'list':
          return {
            kind: 'list',
            ordered: block.ordered,
            items: block.items.map(runs),
          };
        case 'code':
          return block;
      }
    });
    if (!blocks.length) fail(name, 'a published guide has a body');
    return {
      slug,
      title: front.title,
      description: front.description,
      order,
      blocks,
    };
  });

  return guides.sort((a, b) => a.order - b.order);
}

/** Where every guide is written. Read at build time: a guide ships with its
 *  deploy, like a changelog entry. */
const GUIDES_DIRECTORY = path.join(process.cwd(), 'docs/product/guides');

function readGuideFiles(directory = GUIDES_DIRECTORY): GuideFile[] {
  return readdirSync(directory)
    .filter(name => name.endsWith('.md'))
    .map(name => ({
      name,
      text: readFileSync(path.join(directory, name), 'utf8'),
    }));
}

/** Every published guide, in order: the index, the pages and the sitemap. */
export const publishedGuides = cache((): Guide[] =>
  parseGuides(readGuideFiles())
);
