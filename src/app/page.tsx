import { HomeBands } from '@/components/site/bands/band-stack';

/**
 * The homepage is an ordered list of bands (ENG-031 W1). It holds no structure
 * of its own: the sequence is data in
 * `src/components/site/bands/manifest.ts`.
 */
export default function Home() {
  return <HomeBands />;
}
