export const dynamic = 'force-static';

/**
 * The browser form of the distribution contract's ICNS source.
 *
 * `run-next-with-distribution.mjs` supplies the validated, digest-bound PNG
 * during build/dev startup. A direct Next invocation has no distribution
 * custody and fails instead of borrowing a checked-in Exawatt mark.
 */
export function GET(): Response {
  const encoded = process.env.EXAWATT_RESOLVED_WEB_ICON_BASE64;
  if (!encoded) {
    throw new Error(
      'Prepared distribution web icon is missing; run Next through the repository build/dev command.'
    );
  }
  const bytes = Buffer.from(encoded, 'base64');
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}
