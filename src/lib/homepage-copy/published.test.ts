import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, distribution, from, select, eq, maybeSingle } =
  vi.hoisted(() => ({
    createClient: vi.fn(),
    distribution: {
      account: null as null | {
        supabaseUrl: string;
        supabaseAnonKey: string;
      },
    },
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  }));

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distribution,
}));

import { HOMEPAGE_COPY_BASELINE } from './contract';
import { readPublishedHomepageCopy } from './published';

describe('public homepage copy read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    distribution.account = null;
    createClient.mockReturnValue({ from });
    from.mockReturnValue({ select });
    select.mockReturnValue({ eq });
    eq.mockReturnValue({ maybeSingle });
  });

  it('uses the checked-in document without touching hosted services in Community', async () => {
    expect(await readPublishedHomepageCopy()).toEqual({
      document: HOMEPAGE_COPY_BASELINE,
      publicationId: null,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('reads only the complete published singleton', async () => {
    distribution.account = {
      supabaseUrl: 'https://account.example.test',
      supabaseAnonKey: 'public-key',
    };
    const document = {
      ...HOMEPAGE_COPY_BASELINE,
      scenes: {
        ...HOMEPAGE_COPY_BASELINE.scenes,
        landing: {
          ...HOMEPAGE_COPY_BASELINE.scenes.landing,
          headline: ['A published promise.'],
        },
      },
    };
    maybeSingle.mockResolvedValue({
      data: { publication_id: 'publication-1', document },
      error: null,
    });

    expect(await readPublishedHomepageCopy()).toEqual({
      document,
      publicationId: 'publication-1',
    });
    expect(from).toHaveBeenCalledWith('homepage_copy_current');
    expect(select).toHaveBeenCalledWith('publication_id,document');
    expect(eq).toHaveBeenCalledWith('singleton', true);
  });

  it('serves the checked-in document, without an error, before the first publish', async () => {
    // the singleton row exists from the migration on, empty until a publish
    distribution.account = {
      supabaseUrl: 'https://account.example.test',
      supabaseAnonKey: 'public-key',
    };
    maybeSingle.mockResolvedValue({
      data: { publication_id: null, document: null },
      error: null,
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(await readPublishedHomepageCopy()).toEqual({
        document: HOMEPAGE_COPY_BASELINE,
        publicationId: null,
      });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('never renders an invalid hosted snapshot', async () => {
    distribution.account = {
      supabaseUrl: 'https://account.example.test',
      supabaseAnonKey: 'public-key',
    };
    maybeSingle.mockResolvedValue({
      data: { publication_id: 'bad', document: { version: 1 } },
      error: null,
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(await readPublishedHomepageCopy()).toEqual({
        document: HOMEPAGE_COPY_BASELINE,
        publicationId: null,
      });
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
