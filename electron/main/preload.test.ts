import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Preload runs sandboxed (`sandbox: true` in `window.ts`): it may `require`
 * `electron` and nothing else, so a value import of the bridge contract, or
 * of any local module, would compile and then fail in the packaged app. The
 * contract reaches preload as types only.
 */
describe('preload', () => {
  const source = readFileSync(path.join(__dirname, 'preload.ts'), 'utf8');
  const imports = [
    ...source.matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+'([^']+)';/gm),
  ];

  it('imports values from electron alone', () => {
    const valueImports = imports
      .filter(([, typeOnly]) => !typeOnly)
      .map(([, , specifier]) => specifier);
    expect(valueImports).toEqual(['electron']);
  });
});
