import { NextResponse } from 'next/server';

// Import server-side OC utilities from the server subpath
// This avoids bundling Node.js 'fs' module into browser code
import { readGatewayToken, readGatewayConfig } from '@exawatt/core/server';

/**
 * The local OpenClaw gateway token.
 *
 * This route used to demand an Exawatt account before handing back a
 * credential that belongs to the machine, which was wrong independently of the
 * distribution split (recorded in the open-source readiness inventory: "a
 * local credential read must never require a hosted session. Fix the
 * authorization model here, do not merely null-guard it."). In a community
 * build there is no account service at all, so the check turned the operator's
 * own OpenClaw connection into a 500 (BUG-044).
 *
 * What actually authorizes this read is LOCALITY, not identity.
 * `readGatewayToken()` reads `~/.openclaw/openclaw.json` on the host serving
 * the request:
 *
 * - Packaged desktop: that host is the operator's own machine and the renderer
 *   server is bound to `127.0.0.1`. Any local process that could call this
 *   could read the same file directly, so requiring a session bought nothing
 *   and cost the whole feature.
 * - Hosted (`www.exawatt.ai`): the function's home directory has no
 *   `.openclaw`, so there is nothing to serve and never was. The response is
 *   the same 404 it already produced.
 *
 * No account service is consulted, in any distribution.
 */
export async function GET() {
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
