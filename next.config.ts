import { createRequire } from 'node:module';
import path from 'node:path';

import type { NextConfig } from 'next';
import {
  distributionConnectSources,
  parseDistributionContractJson,
} from '@exawatt/core/distribution';

const distributionJson = process.env.EXAWATT_RESOLVED_DISTRIBUTION_JSON;
const distributionDigest = process.env.EXAWATT_RESOLVED_DISTRIBUTION_SHA256;
if (!distributionJson || !distributionDigest) {
  throw new Error(
    'Next must run through the distribution resolver (`pnpm dev`, `pnpm build`, or the resolved typegen command).'
  );
}
const distribution = parseDistributionContractJson(distributionJson);
const connectSources = distributionConnectSources(distribution).join(' ');

const require = createRequire(import.meta.url);

/**
 * Files the standalone trace resolves under a condition the RUNTIME does not
 * use, so tracing writes a payload the server cannot boot (BUG-036).
 *
 * `@swc/helpers` is `"type": "module"` with a conditional `exports` map, and
 * Next's compiled output requires its subpaths as `@swc/helpers/_/<helper>`.
 * `@vercel/nft` resolves that subpath under `require`/`default` and records
 * `cjs/<helper>.cjs`. Node 22 resolves the SAME request under `module-sync`
 * (its `require(esm)` support) and loads `esm/<helper>.js`, which the trace
 * never copied — so the packaged renderer died on its first require with
 * `MODULE_NOT_FOUND` from `next/dist/server/require-hook.js`, the app booted
 * to `Command engine paused`, and nothing in the build noticed.
 *
 * Resolved rather than globbed: pnpm's store path carries the version, so a
 * literal glob would silently stop matching on the next bump — the exact
 * failure mode this entry exists to prevent. The durable guard is not this
 * list: `scripts/lib/renderer-archive.mjs` boots the sealed archive before
 * `prepare-electron-renderer.mjs` writes its hash, and `assertRendererServes`
 * repeats the proof on the packed bundle, so the NEXT under-traced dependency
 * fails the build instead of the user's launch.
 *
 * It fails soft for that reason. An install layout this cannot resolve must not
 * turn config loading into a new failure mode; the boot proof already refuses
 * the payload that would result, with the missing file named.
 */
function tracedUnderTheWrongCondition(): string[] {
  try {
    const nextRoot = path.dirname(require.resolve('next/package.json'));
    const helpers = path.dirname(
      require.resolve('@swc/helpers/package.json', { paths: [nextRoot] })
    );
    const relative = path.relative(process.cwd(), helpers);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return [];
    return [`${relative}/esm/**`];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  // Electron packages this standalone server beside main/preload so the
  // privileged desktop renderer is one versioned local artifact.
  //
  // NOT on Vercel. Vercel runs its own output tracing, and asking Next for a
  // standalone build on top of it leaves the platform looking for a trace
  // manifest the standalone step did not put where it expects:
  // `ENOENT .next/next-server.js.nft.json`, which failed every production
  // deployment until 2026-08-16. The desktop artifact is unaffected because
  // VERCEL is only set inside Vercel's builder.
  output: process.env.VERCEL ? undefined : 'standalone',
  outputFileTracingIncludes: {
    '/**/*': tracedUnderTheWrongCondition(),
  },
  env: {
    NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON: distributionJson,
    NEXT_PUBLIC_EXAWATT_DISTRIBUTION_SHA256: distributionDigest,
  },
  // ENG-030 OS1.1 / decision `0034`: analytics reach PostHog only through this
  // Exawatt-owned rewrite, so the desktop app's sole analytics destination is
  // exawatt.ai and no third-party hostname appears in its outbound connections
  // (ENG-016 D17, incident `0002` — firewall identity must stay stable).
  //
  // The packaged renderer is served by a package-local standalone server on
  // 127.0.0.1, so it must NOT use a relative ingest path: `config.ts` resolves
  // the desktop api_host to the absolute hosted origin, which lands here.
  async rewrites() {
    if (!distribution.analytics) return [];
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  // PostHog's ingest paths are trailing-slash sensitive; Next's redirect would
  // turn a capture into a 308 the SDK does not follow.
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // React dev mode uses eval() for reconstructed callstacks;
              // without the dev-only allowance every surface logs a console
              // error that fails console-clean evals. Production stays strict.
              process.env.NODE_ENV === 'development'
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                : "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              `connect-src ${connectSources}`,
              "worker-src 'self' blob:",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self' https:",
            ].join('; '),
          },
        ],
      },
    ];
  },
  transpilePackages: ['@exawatt/core', '@exawatt/ui-model'],
  // the floating Next dev-tools badge occludes the workspace chrome in the
  // Electron app (operator, dogfood round 4)
  devIndicators: false,
};

export default nextConfig;
