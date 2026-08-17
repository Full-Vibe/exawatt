import { describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  type DistributionContractV1,
} from '@exawatt/core/distribution';
import {
  fetchDesktopBuild,
  formatBuildSize,
  formatReleaseDate,
  parseLatestMacFeed,
} from './desktop-build';

const FEED_URL = 'https://updates.example.test/macos/arm64';
const UPDATE_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  updates: { feedUrl: FEED_URL },
} satisfies DistributionContractV1;

// Verbatim shape published by electron-builder for v0.1.7.
const FEED = `version: 0.1.7
files:
  - url: Exawatt-0.1.7-arm64-mac.zip
    sha512: HmXE3ROULCaJmx5G7HR6YCitqnVFHjy9cKTMVi6wMiqcePwhtggmlbJ9BwqY/5NoPvllNs6yDhIx0lFKuRDS0w==
    size: 149464646
  - url: Exawatt-0.1.7-arm64.dmg
    sha512: pnS8bXl1Rlh2JYxX2j4rKWMpFeB1rBEi6Ppu3ADffKryNfbpAUZH7NGWbdoEzJ7xQPmG7LbG+VnG6HsRVEgy8A==
    size: 151228341
path: Exawatt-0.1.7-arm64-mac.zip
sha512: HmXE3ROULCaJmx5G7HR6YCitqnVFHjy9cKTMVi6wMiqcePwhtggmlbJ9BwqY/5NoPvllNs6yDhIx0lFKuRDS0w==
releaseDate: '2026-07-22T17:47:25.929Z'
`;

describe('desktop build feed', () => {
  it('offers the DMG a person installs, not the updater zip', () => {
    const build = parseLatestMacFeed(FEED, FEED_URL);
    expect(build).toEqual({
      version: '0.1.7',
      releaseDate: '2026-07-22T17:47:25.929Z',
      fileName: 'Exawatt-0.1.7-arm64.dmg',
      downloadUrl:
        'https://updates.example.test/macos/arm64/Exawatt-0.1.7-arm64.dmg',
      size: 151228341,
    });
  });

  it('returns null when the feed carries no installable image', () => {
    expect(parseLatestMacFeed('version: 0.1.7\nfiles:\n', FEED_URL)).toBeNull();
    expect(parseLatestMacFeed('nonsense', FEED_URL)).toBeNull();
  });

  it('degrades to null rather than throwing when the feed is unreachable', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchDesktopBuild(UPDATE_DISTRIBUTION, failing)).toBeNull();
    const notFound = (async () =>
      new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchDesktopBuild(UPDATE_DISTRIBUTION, notFound)).toBeNull();
  });

  it('uses the distribution feed for metadata and install artifacts', async () => {
    const requestedUrls: string[] = [];
    const request = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(FEED, { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      fetchDesktopBuild(UPDATE_DISTRIBUTION, request)
    ).resolves.toMatchObject({
      downloadUrl:
        'https://updates.example.test/macos/arm64/Exawatt-0.1.7-arm64.dmg',
    });
    expect(request).toHaveBeenCalledOnce();
    expect(requestedUrls).toEqual([
      'https://updates.example.test/macos/arm64/latest-mac.yml',
    ]);
  });

  it('does not issue a feed request when updates are absent', async () => {
    const request = vi.fn();

    await expect(
      fetchDesktopBuild(
        COMMUNITY_DISTRIBUTION,
        request as unknown as typeof fetch
      )
    ).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('formats size and date for people', () => {
    expect(formatBuildSize(151228341)).toBe('151 MB');
    expect(formatBuildSize(2_400_000_000)).toBe('2.40 GB');
    expect(formatBuildSize(null)).toBeNull();
    expect(formatReleaseDate('2026-07-22T17:47:25.929Z')).toBe('July 22, 2026');
    expect(formatReleaseDate('nope')).toBeNull();
  });
});
