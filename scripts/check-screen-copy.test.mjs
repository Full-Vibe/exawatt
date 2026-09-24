import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findScreenCopyDashes,
  productionFiles,
  unexpectedScreenCopyDashes,
} from './check-screen-copy.mjs';

const DASH = '—';
const texts = (source, file = 'src/components/panel.tsx') =>
  findScreenCopyDashes(source, file).map(finding => finding.text);

test('finds an em dash in JSX text, attributes, strings and template text', () => {
  assert.equal(
    texts(`
      const a = 'one ${DASH} two';
      const b = \`\${count} ${DASH} \${kind}\`;
      const node = (
        <p title="three ${DASH} four">
          five ${DASH} six
        </p>
      );
    `).length,
    4
  );
});

test('ignores comments, console output and the lone empty-value glyph', () => {
  assert.deepEqual(
    texts(`
      // one ${DASH} two is a comment
      /** three ${DASH} four */
      console.warn('five ${DASH} six');
      const empty = '${DASH}';
      const cell = <td>${DASH}</td>;
    `),
    []
  );
});

test('a template part that is only a separator still counts', () => {
  assert.equal(texts(`const label = \`\${a} ${DASH} \${b}\`;`).length, 1);
});

test('production is what a route reaches; studies, fixtures and tests are not', () => {
  const sources = new Map([
    ['src/app/page.tsx', `import { A } from '@/components/a';`],
    ['src/components/a.tsx', `import { m } from '@exawatt/ui-model';`],
    ['packages/ui-model/src/index.ts', `export * from './model';`],
    ['packages/ui-model/src/model.ts', `export const m = 1;`],
    [
      'src/app/hud-gallery/study/page.tsx',
      `import { S } from '@/components/study';`,
    ],
    ['src/components/study.tsx', `export const S = 1;`],
    ['src/components/a.test.tsx', `import { F } from './fixture';`],
    ['src/components/fixture.ts', `export const F = 1;`],
    ['src/proxy.ts', `export const proxy = 1;`],
    [
      'company/overlay/web/src/app/admin/page.tsx',
      `import { Form } from './form';`,
    ],
    ['company/overlay/web/src/app/admin/form.tsx', `export const Form = 1;`],
  ]);
  const composed = new Map([
    ['company/overlay/web/src/app/admin/page.tsx', 'src/app/admin/page.tsx'],
    ['company/overlay/web/src/app/admin/form.tsx', 'src/app/admin/form.tsx'],
  ]);
  assert.deepEqual([...productionFiles(sources, composed)].sort(), [
    'company/overlay/web/src/app/admin/form.tsx',
    'company/overlay/web/src/app/admin/page.tsx',
    'packages/ui-model/src/index.ts',
    'packages/ui-model/src/model.ts',
    'src/app/page.tsx',
    'src/components/a.tsx',
    'src/proxy.ts',
  ]);
});

test('an exception is capped per file, so a new em dash fails beside an old one', () => {
  const findings = findScreenCopyDashes(
    `const a = 'one ${DASH} two'; const b = 'three ${DASH} four';`,
    'src/components/panel.tsx'
  );
  const cap = max => ({
    'src/components/panel.tsx': { max, reason: 'fixture' },
  });
  assert.equal(unexpectedScreenCopyDashes(findings, cap(2)).length, 0);
  assert.equal(unexpectedScreenCopyDashes(findings, cap(1)).length, 2);
  assert.equal(unexpectedScreenCopyDashes(findings, {}).length, 2);
});
