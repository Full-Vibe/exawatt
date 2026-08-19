// ENG-022 H13. ONE owner for the question "what checkout does this dev server
// serve?".
//
// The question had two owners with different rules. The eval harness asked it
// properly (`assertDevServerServesTree`, ENG-022 H2) and refused a mismatch.
// `electron-dev.mjs` did not ask at all: it adopted whatever answered a bare
// GET / on 7000/7090/3000, so with parallel agent worktrees `pnpm electron:dev`
// could silently drive ANOTHER checkout's renderer — the same class of defect
// H2 was built to stop, on the path H2 did not cover.
//
// Reading identity and JUDGING it are separated here on purpose: the harness
// needs an assertion that throws with a remedy, the launcher needs a query it
// can answer with "not this one, try the next port". One reader, two callers.
import { realpathSync } from 'node:fs';
import net from 'node:net';

/** A read either identified the server, proved it cannot be identified, or
 *  failed. These are distinct outcomes: an unreachable port and a port serving
 *  an unverifiable server must never collapse into the same value, or a caller
 *  adopts a server it never confirmed. */
export const DEV_IDENTITY = {
  UNREACHABLE: 'unreachable',
  UNVERIFIABLE: 'unverifiable',
  UNHEALTHY: 'unhealthy',
  IDENTIFIED: 'identified',
};

export async function readDevServerIdentity(
  origin,
  { fetchImpl = fetch, timeoutMs = 15_000 } = {}
) {
  let response;
  try {
    // Generous: `next dev` compiles the route on first hit.
    response = await fetchImpl(`${origin}/api/dev-identity`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { kind: DEV_IDENTITY.UNREACHABLE };
  }
  if (response.status === 404) {
    // An older tree without the route, or a production server. Legitimately
    // unverifiable rather than wrong.
    return { kind: DEV_IDENTITY.UNVERIFIABLE, status: 404 };
  }
  if (!response.ok) {
    return { kind: DEV_IDENTITY.UNHEALTHY, status: response.status };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { kind: DEV_IDENTITY.UNHEALTHY, status: response.status };
  }
  return {
    kind: DEV_IDENTITY.IDENTIFIED,
    repoRoot: body?.repoRoot ?? null,
    distributionDigest: body?.distributionDigest ?? null,
  };
}

/** True ONLY for a server that positively identified itself as this checkout.
 *  Unverifiable is not a yes: adopting a server that could not name its tree is
 *  exactly how an eval or a launcher ends up driving the wrong code. */
export function servesCheckout(identity, checkoutRoot, { realpath = realpathSync } = {}) {
  if (identity?.kind !== DEV_IDENTITY.IDENTIFIED) return false;
  if (!identity.repoRoot) return false;
  try {
    return realpath(identity.repoRoot) === realpath(checkoutRoot);
  } catch {
    return false;
  }
}

/** Is this port free to bind? Used to choose where to START a server, which is
 *  a different question from whether a server there is OURS.
 *
 *  Both the wildcard AND loopback must bind, because either alone lies in one
 *  direction: `next dev` holds `*:<port>` and a 127.0.0.1 probe succeeds beside
 *  it on macOS dual-stack (caught live against a foreign server on 7000), while
 *  a server bound only to 127.0.0.1 leaves the wildcard probe free even though
 *  every `localhost` connection the launcher makes would reach it. A port is
 *  free only when nothing can be reached on it. */
function bindSucceeds(options) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(options);
  });
}

export async function isPortFree(port) {
  if (!(await bindSucceeds({ port, exclusive: true }))) return false;
  return bindSucceeds({ port, host: '127.0.0.1', exclusive: true });
}

/** Walk candidate ports and return the first that positively serves this
 *  checkout, plus the reason each rejected port was rejected — callers print
 *  that instead of silently starting a second server beside a usable one. */
export async function findServerForCheckout(
  ports,
  checkoutRoot,
  {
    read = readDevServerIdentity,
    portOrigin = port => `http://localhost:${port}`,
    realpath = realpathSync,
  } = {}
) {
  const rejected = [];
  for (const port of ports) {
    const identity = await read(portOrigin(port));
    if (servesCheckout(identity, checkoutRoot, { realpath })) {
      return { port, identity, rejected };
    }
    if (identity.kind !== DEV_IDENTITY.UNREACHABLE) {
      rejected.push({ port, kind: identity.kind, repoRoot: identity.repoRoot ?? null });
    }
  }
  return { port: null, identity: null, rejected };
}

/** First candidate nothing is listening on, so a launcher that could not adopt
 *  starts beside the foreign server instead of colliding with it. */
export async function firstFreePort(ports, { free = isPortFree } = {}) {
  for (const port of ports) {
    if (await free(port)) return port;
  }
  return null;
}
