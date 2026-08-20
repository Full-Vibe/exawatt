// Best-effort public-profile lookup for the /world hackathon toy. X's profile
// pages are a JS-rendered SPA behind a login wall for almost everything, but
// the server-rendered OpenGraph tags (meant for link-preview crawlers) often
// still carry the display name and bio. When they don't, callers must know
// that plainly rather than silently treating an empty result as "no hints" —
// the UI shows whether real hints were found or the persona was inferred.

const FETCH_TIMEOUT_MS = 4000;

export interface ProfileHints {
  handle: string;
  ogTitle: string | null;
  ogDescription: string | null;
}

export function extractHandle(input: string): string {
  const trimmed = input.trim().replace(/^@/, '');
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})/i
  );
  const handle = urlMatch ? urlMatch[1] : trimmed;
  return handle.replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
}

function metaContent(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]);
  }
  return null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function fetchProfileHints(
  handle: string
): Promise<ProfileHints | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://x.com/${handle}`, {
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; Twitterbot/1.0; +https://developer.twitter.com)',
        accept: 'text/html',
      },
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const html = await response.text();
    const ogTitle = metaContent(html, [
      /<meta\s+(?:property|name)="og:title"\s+content="([^"]*)"/i,
      /<meta\s+content="([^"]*)"\s+(?:property|name)="og:title"/i,
    ]);
    const ogDescription = metaContent(html, [
      /<meta\s+(?:property|name)="og:description"\s+content="([^"]*)"/i,
      /<meta\s+content="([^"]*)"\s+(?:property|name)="og:description"/i,
    ]);
    if (!ogTitle && !ogDescription) return null;
    return { handle, ogTitle, ogDescription };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
