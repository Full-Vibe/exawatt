import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true }))
  );
});

async function prepareIcon(icon: Buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), 'exawatt-web-icon-'));
  directories.push(directory);
  const iconPath = path.join(directory, 'icon.png');
  await writeFile(iconPath, icon);
  vi.stubEnv('EXAWATT_RESOLVED_WEB_ICON_PATH', iconPath);
  vi.stubEnv(
    'EXAWATT_RESOLVED_WEB_ICON_SHA256',
    createHash('sha256').update(icon).digest('hex')
  );
  return iconPath;
}

describe('distribution web icon route', () => {
  it('serves the prepared bytes as a cache-bounded PNG', async () => {
    const icon = Buffer.from('fixture-png-bytes');
    await prepareIcon(icon);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(icon.length));
    expect(response.headers.get('cache-control')).toContain('must-revalidate');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(icon);
  });

  it.each([
    'EXAWATT_RESOLVED_WEB_ICON_PATH',
    'EXAWATT_RESOLVED_WEB_ICON_SHA256',
  ])('fails loudly when prepared icon custody is missing %s', async name => {
    await prepareIcon(Buffer.from('fixture'));
    vi.stubEnv(name, undefined);

    await expect(GET()).rejects.toThrow(
      /Prepared distribution web icon is missing/
    );
  });

  it('refuses bytes replaced after the launcher validated the prepared artifact', async () => {
    const iconPath = await prepareIcon(Buffer.from('validated-icon'));
    await writeFile(iconPath, 'different-distributor-icon');

    await expect(GET()).rejects.toThrow(/web icon digest mismatch/);
  });

  it('fails when the prepared file disappears instead of serving fallback artwork', async () => {
    const iconPath = await prepareIcon(Buffer.from('validated-icon'));
    await rm(iconPath);

    await expect(GET()).rejects.toThrow(/ENOENT/);
  });
});
