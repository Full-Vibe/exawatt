import { NextResponse } from 'next/server';

export async function GET() {
  // Kept as an explicit tombstone for old renderers/bookmarks. Authentication
  // is irrelevant: a web response is never an acceptable boundary for an
  // OS-local Agent Source credential. Electron main owns the replacement.
  return NextResponse.json(
    {
      error:
        'OpenClaw credentials are available only to the desktop capability',
    },
    {
      status: 410,
      headers: { 'cache-control': 'no-store' },
    }
  );
}
