/**
 * Site documents: the one Markdown pipeline behind the website's written pages
 * (ENG-031). The changelog (`docs/product/changelog/<version>.md`, W25) and
 * the guides (`docs/product/guides/<slug>.md`, W26) are both a front matter
 * block and a small Markdown body, read here and rendered by
 * `src/components/site/docs/`. Each kind is a grammar over these parts: it
 * names its front matter keys, the blocks it admits and the inline marks it
 * renders, so the two cannot drift into two parsers.
 *
 * The body grammar is deliberately small:
 *
 *   ## Heading / ### Heading
 *   A paragraph, wrapped over any number of lines.
 *   - A bullet item, continued on indented lines.
 *   1. An ordered item, continued the same way.
 *   ```sh | ```text | ```prompt   a fenced block; `prompt` is prose to copy
 *
 *   Inline: **bold**, `code` and [a link](href), each only where the kind
 *   admits it.
 *
 * Anything else is refused with the file and the reason, so a malformed page
 * fails the landing that adds it instead of rendering half a page. Plain Node
 * built-ins only: the Next server reads it at build time and the release
 * scripts read the changelog from the tag's own checkout.
 */

const EM_DASH = '—';
const FENCE_KINDS = new Set(['sh', 'text', 'prompt']);

export class SiteDocError extends Error {
  constructor(label, source, message) {
    super(`[${label}] ${source}: ${message}`);
    this.name = 'SiteDocError';
  }
}

/** Public copy uses periods, commas or colons (marketing canon). */
export function refuseEmDash(text, { label, source }) {
  if (text.includes(EM_DASH)) {
    throw new SiteDocError(
      label,
      source,
      'contains an em dash; public copy uses periods, commas or colons'
    );
  }
}

/** Joins wrapped Markdown lines into one sentence-level string. */
function joinLines(lines) {
  return lines
    .map(line => line.trim())
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * The front matter block: `key: value` lines between two `---` lines, each
 * key one of `keys`, none repeated. Returns the values and the body's lines.
 */
export function readFrontMatter(text, { label, source, keys }) {
  if (typeof text !== 'string')
    throw new SiteDocError(label, source, 'not text');
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  if (lines[0] !== '---')
    throw new SiteDocError(
      label,
      source,
      'must open with a front matter block'
    );
  const close = lines.indexOf('---', 1);
  if (close < 0)
    throw new SiteDocError(label, source, 'front matter block is not closed');
  const front = {};
  for (const line of lines.slice(1, close)) {
    if (!line.trim()) continue;
    const match = /^([a-z]+):\s*(.*)$/u.exec(line);
    if (!match || !keys.includes(match[1]))
      throw new SiteDocError(
        label,
        source,
        `unknown front matter line "${line}"`
      );
    if (match[1] in front)
      throw new SiteDocError(label, source, `repeats "${match[1]}"`);
    front[match[1]] = match[2].trim();
  }
  return { front, body: lines.slice(close + 1) };
}

/**
 * Inline runs: `**bold**`, `` `code` `` and `[text](href)`, each recognised
 * only when `marks` names it, so a renderer never parses Markdown. `link`
 * resolves (or refuses) each href. Runs are `{ text, strong }`, plus `code` or
 * `href` when they apply.
 */
export function inlineRuns(
  text,
  { marks = ['strong'], link, label = 'site-docs', source = 'text' } = {}
) {
  const runs = [];
  let strong = false;
  let buffer = '';
  const flush = () => {
    if (buffer) runs.push({ text: buffer, strong });
    buffer = '';
  };
  let index = 0;
  while (index < text.length) {
    if (marks.includes('strong') && text.startsWith('**', index)) {
      flush();
      strong = !strong;
      index += 2;
      continue;
    }
    if (marks.includes('code') && text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end < 0)
        throw new SiteDocError(label, source, `unclosed \` in "${text}"`);
      flush();
      runs.push({ text: text.slice(index + 1, end), strong, code: true });
      index = end + 1;
      continue;
    }
    if (marks.includes('link') && text[index] === '[') {
      const match = /^\[([^\]]+)\]\(([^)\s]+)\)/u.exec(text.slice(index));
      if (match) {
        flush();
        const href = link ? link(match[2]) : match[2];
        runs.push({ text: match[1], strong, href });
        index += match[0].length;
        continue;
      }
    }
    buffer += text[index];
    index += 1;
  }
  flush();
  if (strong)
    throw new SiteDocError(label, source, `unbalanced ** in "${text}"`);
  return runs;
}

/**
 * The body's blocks, in order: `{ kind: 'heading', level, text }`,
 * `{ kind: 'paragraph', text }`, `{ kind: 'list', ordered, items }` and
 * `{ kind: 'code', lang, text }` (a `prompt` block's text is its paragraphs
 * joined, so the site can reflow it and a copy pastes clean). Each text is
 * checked with `inlineRuns` under the same options, so a bad mark fails here.
 */
export function parseBlocks(lines, options) {
  const { label, source } = options;
  const fail = message => {
    throw new SiteDocError(label, source, message);
  };
  const blocks = [];
  let paragraph = null;
  // An open list: its items, the item being read, and whether a blank line
  // has passed since that item (the next line must then start an item).
  let list = null;

  const closeItem = () => {
    if (list?.item) list.items.push(joinLines(list.item));
    if (list) list.item = null;
  };
  const flush = () => {
    if (paragraph)
      blocks.push({ kind: 'paragraph', text: joinLines(paragraph) });
    paragraph = null;
    closeItem();
    if (list)
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  let fence = null;
  for (const line of lines) {
    if (fence) {
      if (line.trim() === '```') {
        const text =
          fence.lang === 'prompt'
            ? fence.lines
                .join('\n')
                .split(/\n\s*\n/u)
                .map(part => joinLines(part.split('\n')))
                .filter(Boolean)
                .join('\n\n')
            : fence.lines.join('\n').replace(/\n+$/u, '');
        if (!text) fail(`a \`\`\`${fence.lang} block is empty`);
        blocks.push({ kind: 'code', lang: fence.lang, text });
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (!line.trim()) {
      if (list) {
        closeItem();
        list.gap = true;
      } else flush();
      continue;
    }
    const opening = /^```(\S*)\s*$/u.exec(line);
    if (opening) {
      flush();
      if (!FENCE_KINDS.has(opening[1]))
        fail(
          `a fenced block names one of ${[...FENCE_KINDS].join(', ')}: "${line}"`
        );
      fence = { lang: opening[1], lines: [] };
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
      });
      continue;
    }
    if (/^#/u.test(line)) fail(`a heading needs a space: "${line}"`);
    if (/^\s*</u.test(line)) fail(`HTML is not part of the grammar: "${line}"`);
    if (/^\s*>/u.test(line))
      fail(`a quote is not part of the grammar: "${line}"`);
    const marker = /^(?:([-*])|\d+\.) (.+)$/u.exec(line);
    if (marker) {
      const ordered = !marker[1];
      if (paragraph || (list && list.ordered !== ordered)) flush();
      list = list ?? { ordered, items: [], item: null, gap: false };
      closeItem();
      list.item = [marker[2]];
      list.gap = false;
      continue;
    }
    if (list && !list.gap) {
      if (/^\s+\S/u.test(line)) {
        list.item.push(line);
        continue;
      }
      fail(`a list item continues on an indented line: "${line.trim()}"`);
    }
    if (list) flush();
    if (/^\s/u.test(line)) fail(`an indented line outside a list: "${line}"`);
    paragraph = paragraph ?? [];
    paragraph.push(line);
  }
  if (fence) fail(`a \`\`\`${fence.lang} block is not closed`);
  flush();

  for (const block of blocks) {
    if (block.kind === 'code') continue;
    for (const text of block.kind === 'list' ? block.items : [block.text])
      inlineRuns(text, options);
  }
  return blocks;
}
