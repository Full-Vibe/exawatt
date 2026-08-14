import { describe, expect, it } from 'vitest';
import os from 'os';
import {
  anonymizeHomePath,
  redactDiagnosticFields,
  redactDiagnosticText,
  redactDiagnosticValue,
} from './diagnostics-redaction';

describe('redactDiagnosticText', () => {
  it('redacts bearer tokens', () => {
    const out = redactDiagnosticText('Authorization: Bearer sk-abc.def-123');
    expect(out).toBe('Authorization: Bearer [REDACTED]');
  });

  it('redacts tokens in query strings and JSON', () => {
    expect(redactDiagnosticText('?code=xyz789&next=/a')).toContain(
      'code=[REDACTED]'
    );
    expect(redactDiagnosticText('{"access_token":"abc123"}')).toContain(
      '[REDACTED]'
    );
  });

  it('redacts JWTs anywhere in the string', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
    expect(redactDiagnosticText(`token is ${jwt} ok`)).toBe(
      'token is [REDACTED_JWT] ok'
    );
  });

  it('redacts long opaque values that match no known key', () => {
    expect(redactDiagnosticText(`v=${'a'.repeat(120)}`)).toContain(
      '[REDACTED_LONG_VALUE]'
    );
  });

  it('leaves ordinary diagnostic prose intact', () => {
    const message = 'update failed: ENOSPC, no space left on device';
    expect(redactDiagnosticText(message)).toBe(message);
  });

  it('truncates to the caller-supplied maximum', () => {
    expect(redactDiagnosticText('x'.repeat(50), 10)).toHaveLength(10);
  });
});

describe('anonymizeHomePath', () => {
  it('replaces the home directory with a tilde', () => {
    const home = os.homedir();
    expect(anonymizeHomePath(`${home}/Library/Logs/a.jsonl`)).toBe(
      '~/Library/Logs/a.jsonl'
    );
  });

  it('replaces every occurrence, not just the first', () => {
    const home = os.homedir();
    const out = anonymizeHomePath(`${home}/a and ${home}/b`);
    expect(out).toBe('~/a and ~/b');
    expect(out).not.toContain(home);
  });

  it('leaves a path outside home alone', () => {
    expect(anonymizeHomePath('/Applications/Exawatt.app')).toBe(
      '/Applications/Exawatt.app'
    );
  });
});

describe('redactDiagnosticValue', () => {
  it('walks nested objects and arrays', () => {
    const out = redactDiagnosticValue({
      outer: { inner: ['Authorization: Bearer secret-value'] },
    }) as { outer: { inner: string[] } };
    expect(out.outer.inner[0]).toBe('Authorization: Bearer [REDACTED]');
  });

  it('preserves numbers, booleans, null, and undefined', () => {
    expect(redactDiagnosticValue(7)).toBe(7);
    expect(redactDiagnosticValue(false)).toBe(false);
    expect(redactDiagnosticValue(null)).toBeNull();
    expect(redactDiagnosticValue(undefined)).toBeUndefined();
  });

  it('stops at the depth ceiling instead of recursing forever', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'too far' } } } } } };
    expect(JSON.stringify(redactDiagnosticValue(deep))).toContain('MAX_DEPTH');
  });

  it('caps array length', () => {
    const out = redactDiagnosticValue(
      Array.from({ length: 40 }, (_, index) => index)
    ) as number[];
    expect(out).toHaveLength(16);
  });
});

describe('redactDiagnosticFields', () => {
  it('redacts every field value', () => {
    const out = redactDiagnosticFields({
      safe: 'ok',
      risky: 'refresh_token=abc123',
    });
    expect(out.safe).toBe('ok');
    expect(String(out.risky)).toContain('[REDACTED]');
  });
});
