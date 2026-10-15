import { createClient } from '@supabase/supabase-js';
import { cache } from 'react';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import {
  HOMEPAGE_COPY_BASELINE,
  parseHomepageCopyDocument,
  type HomepageCopyDocument,
} from './contract';

interface PublishedHomepageCopy {
  document: HomepageCopyDocument;
  publicationId: string | null;
}

const baseline: PublishedHomepageCopy = {
  document: HOMEPAGE_COPY_BASELINE,
  publicationId: null,
};

/** One request-scoped read for page HTML and metadata. Public RLS reveals
 * only this complete publication; alternatives and history remain private. */
export const readPublishedHomepageCopy = cache(
  async (): Promise<PublishedHomepageCopy> => {
    const account = resolvedDistribution().account;
    if (!account) return baseline;

    try {
      const client = createClient(
        account.supabaseUrl,
        account.supabaseAnonKey,
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) =>
              fetch(input, {
                ...init,
                cache: 'no-store',
                signal: init?.signal
                  ? AbortSignal.any([init.signal, AbortSignal.timeout(5_000)])
                  : AbortSignal.timeout(5_000),
              }),
          },
        }
      );
      const { data, error } = await client
        .from('homepage_copy_current')
        .select('publication_id,document')
        .eq('singleton', true)
        .maybeSingle();
      if (error) throw error;
      // the singleton row always exists; until a first publish it holds no
      // document, which is the baseline, not a broken snapshot
      if (!data || (data.publication_id === null && data.document === null))
        return baseline;
      return {
        publicationId: data.publication_id,
        document: parseHomepageCopyDocument(data.document),
      };
    } catch (error) {
      console.error('Unable to read the published homepage copy', error);
      return baseline;
    }
  }
);
