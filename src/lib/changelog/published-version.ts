import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readDesktopBuild } from '@/lib/desktop-release/desktop-build';
import { resolvedDistribution } from '@/lib/distribution/resolved';

type PublishedVersionRead =
  | { status: 'known'; version: string }
  | { status: 'unknown'; reason: string };

/**
 * The newest published version: the one `/download` offers, read from the
 * same update feed (decision 0009). A distribution without a feed publishes
 * the tree it is built from. An unreadable feed is `unknown`, never a version:
 * a guess would either hide shipped releases or announce an unshipped one.
 */
export async function readPublishedVersion(
  init?: RequestInit
): Promise<PublishedVersionRead> {
  // The request itself is desktop-build's, the declared outbound call site.
  const read = await readDesktopBuild(resolvedDistribution(), undefined, init);
  if (read.status === 'published') {
    return { status: 'known', version: read.build.version };
  }
  if (read.status === 'unreadable') {
    return { status: 'unknown', reason: read.reason };
  }
  const { version } = JSON.parse(
    readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  ) as { version: string };
  return { status: 'known', version };
}
