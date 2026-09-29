export const dynamic = 'force-static';

/**
 * Browsers still request the conventional `/favicon.ico` at times despite the
 * declared icon link (Chromium did, intermittently, on the Fleet board). Answer
 * with the same prepared distribution icon the metadata declares, never a 404.
 */
export { GET } from '../exawatt-distribution/icon.png/route';
