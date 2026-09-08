import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const dynamic = 'force-static';

/**
 * The browser form of the distribution contract's ICNS source.
 *
 * `run-next-with-distribution.mjs` supplies the validated PNG path and digest.
 * Next prerenders its bytes into the static route during production builds;
 * the packaged server does not need the preparation file.
 * A direct Next invocation has no distribution custody and fails instead of
 * borrowing a checked-in Exawatt mark.
 */
export async function GET(): Promise<Response> {
  const iconPath = process.env.EXAWATT_RESOLVED_WEB_ICON_PATH;
  const expectedDigest = process.env.EXAWATT_RESOLVED_WEB_ICON_SHA256;
  if (!iconPath || !expectedDigest) {
    throw new Error(
      'Prepared distribution web icon is missing; run Next through the repository build/dev command.'
    );
  }
  const bytes = await readFile(iconPath);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest) {
    throw new Error('Prepared distribution web icon digest mismatch.');
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}
