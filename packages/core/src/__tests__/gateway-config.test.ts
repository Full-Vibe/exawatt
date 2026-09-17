import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseGatewayConfigText,
  readGatewayConfig,
} from '../oc/gateway-config';

/**
 * OpenClaw parses `openclaw.json` as JSON5, so the file the Gateway actually
 * runs with may carry comments and trailing commas. Every fixture here is
 * invented; no token below is real.
 */
const FIXTURE_TOKEN = 'fixture-token-0001';

/** A hand-edited configuration, exactly as a JSON5 loader accepts it. */
const HAND_EDITED = `{
  // Gateway settings, edited by hand after install.
  gateway: {
    port: 4242, /* moved off the default */
    auth: { mode: 'token', token: '${FIXTURE_TOKEN}', },
  },
}
`;

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

function stateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-oc-config-'));
  dirs.push(dir);
  return dir;
}

describe('parseGatewayConfigText', () => {
  it('reads the JSON5 grammar OpenClaw itself accepts', () => {
    const parsed = parseGatewayConfigText(HAND_EDITED);
    expect(parsed).toEqual({
      gateway: { port: 4242, auth: { mode: 'token', token: FIXTURE_TOKEN } },
    });
  });

  it('still reads plain JSON, which is valid JSON5', () => {
    const plain = JSON.stringify({ gateway: { port: 1 } });
    expect(parseGatewayConfigText(plain)).toEqual({ gateway: { port: 1 } });
  });

  it('returns null, never throws, for text that is not a configuration', () => {
    for (const text of [
      '',
      'not json at all',
      '{ gateway: ',
      'null',
      '42',
      '"a string"',
      '[1, 2]',
    ]) {
      expect(parseGatewayConfigText(text)).toBeNull();
    }
    expect(parseGatewayConfigText(undefined)).toBeNull();
    expect(parseGatewayConfigText(12 as unknown as string)).toBeNull();
  });
});

describe('readGatewayConfig', () => {
  it('reads a hand-edited JSON5 file from the state directory', () => {
    const dir = stateDir();
    fs.writeFileSync(path.join(dir, 'openclaw.json'), HAND_EDITED);
    expect(readGatewayConfig(dir)).toEqual({
      gateway: { port: 4242, auth: { mode: 'token', token: FIXTURE_TOKEN } },
    });
  });

  it('returns null for a missing file', () => {
    expect(readGatewayConfig(stateDir())).toBeNull();
  });
});
