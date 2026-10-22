import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRoadmap } from '../roadmap/parse';

// @scans packages/core/src/__tests__/fixtures/roadmaps/**

/*
 * Golden parses of real roadmaps (BUG-128). Each fixture is a frozen copy of
 * a published roadmap: an excerpt of Exawatt's own public roadmap (v2) and a
 * Demo Mode Project's roadmap (v1). Each `.parsed.json` was written by the
 * regex parser this tokenizer replaced, so a pass means the tokenizer reads
 * these files exactly as it did. A deliberate grammar change regenerates the
 * expected files with `vitest -u`, and the diff is the change's evidence.
 */
const FIXTURES = new URL('./fixtures/roadmaps/', import.meta.url);

describe.each(['exawatt-public-roadmap-excerpt', 'dispatch-engine-v1'])(
  'golden roadmap %s',
  name => {
    it('parses to its recorded document', async () => {
      const text = readFileSync(new URL(`${name}.md`, FIXTURES), 'utf8');
      const doc = parseRoadmap(text, {
        projectDir: '/repo',
        file: `${name}.md`,
        now: () => 0,
      });
      expect(doc.items.length).toBeGreaterThan(0);
      await expect(`${JSON.stringify(doc, null, 2)}\n`).toMatchFileSnapshot(
        `./fixtures/roadmaps/${name}.parsed.json`
      );
    });
  }
);
