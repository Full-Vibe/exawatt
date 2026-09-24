import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The contract is imported by the renderer, so it must never reach Electron,
 * Node, or the renderer's own tree. A module specifier here is either
 * relative and inside core, or it is a leak.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_SRC = path.resolve(HERE, '..');

function contractModules(): string[] {
  return readdirSync(HERE).filter(
    file => file.endsWith('.ts') && !file.endsWith('.test.ts')
  );
}

function specifiers(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map(match => match[1]);
}

describe('desktop bridge contract boundary', () => {
  it('imports nothing outside core', () => {
    const leaks: string[] = [];
    for (const file of contractModules()) {
      const source = readFileSync(path.join(HERE, file), 'utf8');
      for (const specifier of specifiers(source)) {
        const resolved = specifier.startsWith('.')
          ? path.resolve(HERE, specifier)
          : null;
        if (!resolved || !resolved.startsWith(CORE_SRC + path.sep)) {
          leaks.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('reads at least one module, so an empty directory cannot pass', () => {
    expect(contractModules()).toContain('channels.ts');
  });
});
