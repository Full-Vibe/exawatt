import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findColorLiteralsInSource,
  isProductionThemeSource,
  unexpectedThemeLiterals,
} from './check-production-theme-literals.mjs';

test('scans production TS/TSX but not gallery, eval, generated, or tests', () => {
  assert.equal(isProductionThemeSource('src/components/panel.tsx'), true);
  assert.equal(isProductionThemeSource('src/app/hud-gallery/page.tsx'), false);
  assert.equal(isProductionThemeSource('src/app/eval/theme/page.tsx'), false);
  assert.equal(
    isProductionThemeSource('src/generated/theme-registry.ts'),
    false
  );
  assert.equal(isProductionThemeSource('src/components/panel.test.tsx'), false);
});

test('finds color strings and Tailwind arbitrary values while ignoring comments', () => {
  const findings = findColorLiteralsInSource(
    `
      // '#ffffff' is documentation, not paint.
      const fill = 'rgba(1, 2, 3, 0.4)';
      const node = <div className="bg-[#0a0b0c]" />;
    `,
    'src/components/panel.tsx'
  );
  assert.deepEqual(
    findings.map(finding => finding.literal.toLowerCase()),
    ['rgba(', '#0a0b0c']
  );
});

test('accepts generated theme roles with local fallbacks', () => {
  const findings = findColorLiteralsInSource(
    `const color = 'var(--exa-foundation-text, #f4f4f4)';`,
    'src/components/panel.tsx'
  );
  assert.deepEqual(findings, []);
});

test('caps every file exception so new raw paint fails the ratchet', () => {
  const findings = findColorLiteralsInSource(
    `const a = '#111111'; const b = 'hsl(10, 20%, 30%)';`,
    'src/components/panel.tsx'
  );
  const exceptions = {
    'src/components/panel.tsx': { max: 1, reason: 'bounded fixture' },
  };
  assert.equal(unexpectedThemeLiterals(findings, exceptions).length, 2);
});
