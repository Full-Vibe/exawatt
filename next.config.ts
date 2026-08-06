import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Electron packages this standalone server beside main/preload so the
  // privileged desktop renderer is one versioned local artifact. The hosted
  // deployment may use the same build output through its own delivery path.
  output: 'standalone',
  // ENG-030 OS1.1 / decision `0034`: analytics reach PostHog only through this
  // Exawatt-owned rewrite, so the desktop app's sole analytics destination is
  // exawatt.ai and no third-party hostname appears in its outbound connections
  // (ENG-016 D17, incident `0002` — firewall identity must stay stable).
  //
  // The packaged renderer is served by a package-local standalone server on
  // 127.0.0.1, so it must NOT use a relative ingest path: `config.ts` resolves
  // the desktop api_host to the absolute hosted origin, which lands here.
  async rewrites() {
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
              "connect-src 'self' https: wss:",
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
