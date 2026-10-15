import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { sourceCommandLine } from './source-command';

describe('sourceCommandLine', () => {
  it('quotes literals and carries free text in the environment, unaltered by any shell', () => {
    const text = `it's "quoted" $HOME \\\\ back\nslash; rm -rf /`;
    const line = sourceCommandLine('codex', [
      'queue',
      '--thread',
      '0199a1b2-c3d4',
      '--message',
      { env: 'EXAWATT_BUS_MESSAGE', value: text },
    ]);
    expect(line.env).toEqual({ EXAWATT_BUS_MESSAGE: text });
    expect(line.command).toBe(
      `'codex' 'queue' '--thread' '0199a1b2-c3d4' '--message' "$EXAWATT_BUS_MESSAGE"`
    );
    // The argument a real shell hands the program is the text, byte for byte.
    const echoed = execFileSync(
      '/bin/sh',
      [
        '-c',
        line.command
          .replace(`'codex'`, `printf '%s'`)
          .replace(/'queue'.*'--message' /, ''),
      ],
      { env: { ...process.env, ...line.env } }
    ).toString();
    expect(echoed).toBe(text);
  });

  it('refuses a variable name that is not one', () => {
    expect(() =>
      sourceCommandLine('codex', [{ env: 'X; rm', value: 'v' }])
    ).toThrow();
  });
});
