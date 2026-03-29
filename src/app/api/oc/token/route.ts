import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Import server-side OC utilities from the server subpath
// This avoids bundling Node.js 'fs' module into browser code
import { readGatewayToken, readGatewayConfig } from '@exawatt/core/server';

export async function GET() {
  // Require authentication
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const token = readGatewayToken();
    const config = readGatewayConfig();

    if (!token) {
      return NextResponse.json(
        { error: 'OC not installed or gateway token not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      token,
      host: config?.gateway?.host ?? '127.0.0.1',
      port: config?.gateway?.port ?? 18789,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to read gateway config' },
      { status: 500 }
    );
  }
}
