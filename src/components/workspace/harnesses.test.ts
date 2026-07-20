import { describe, expect, it } from 'vitest';
import { isDefaultHarnessTitle } from './harnesses';

describe('isDefaultHarnessTitle', () => {
  it('recognizes unrenamed harness labels and legacy id fallbacks', () => {
    expect(isDefaultHarnessTitle('codex', 'Codex')).toBe(true);
    expect(isDefaultHarnessTitle('codex', 'codex')).toBe(true);
    expect(isDefaultHarnessTitle('claude', 'Claude Code')).toBe(true);
    expect(isDefaultHarnessTitle('shell', ' Shell ')).toBe(true);
  });

  it('treats operator renames as real titles', () => {
    expect(isDefaultHarnessTitle('codex', 'Adopt Apple Silicon')).toBe(false);
    expect(isDefaultHarnessTitle('claude', 'Codex')).toBe(false);
  });
});
