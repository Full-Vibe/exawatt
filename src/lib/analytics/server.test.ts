import { describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  parseDistributionContract,
} from '@exawatt/core/distribution';
import { captureServerEvent } from './server';

const OFFICIAL = parseDistributionContract({
  ...COMMUNITY_DISTRIBUTION,
  analytics: {
    ingestOrigin: 'https://ingest.example.test/ingest/',
    projectKey: 'official-public-key',
  },
});
const VISITOR = '0b8e4f5e-3c1d-4a2b-9f6e-7d8c9b0a1e2f';
const DOWNLOAD = {
  name: 'download_requested',
  surface: 'web',
  platform: 'darwin',
  arch: 'arm64',
} as const;

describe('download_requested, recorded by the server', () => {
  it('is keyed by the visitor and anonymous, like the stream it joins', async () => {
    const send = vi.fn(async () => true);
    await expect(
      captureServerEvent(DOWNLOAD, VISITOR, {
        distribution: OFFICIAL,
        nodeEnv: 'production',
        send,
      })
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      {
        apiHost: 'https://ingest.example.test/ingest',
        key: 'official-public-key',
      },
      [
        {
          event: 'download_requested',
          distinctId: VISITOR,
          properties: {
            allowlist_version: 1,
            surface: 'web',
            platform: 'darwin',
            arch: 'arm64',
            $lib: 'exawatt-server',
            $process_person_profile: false,
          },
        },
      ]
    );
  });

  it('records nothing without a visitor id, which an opted-out browser never sends', async () => {
    const send = vi.fn(async () => true);
    for (const visitor of [null, '', 'not-an-id', '../etc/passwd']) {
      await expect(
        captureServerEvent(DOWNLOAD, visitor, {
          distribution: OFFICIAL,
          nodeEnv: 'production',
          send,
        })
      ).resolves.toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('records nothing in a community build or outside production', async () => {
    const send = vi.fn(async () => true);
    await captureServerEvent(DOWNLOAD, VISITOR, {
      distribution: COMMUNITY_DISTRIBUTION,
      nodeEnv: 'production',
      send,
    });
    await captureServerEvent(DOWNLOAD, VISITOR, {
      distribution: OFFICIAL,
      nodeEnv: 'development',
      send,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
