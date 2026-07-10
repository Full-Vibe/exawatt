import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Electron packages this standalone server beside main/preload so the
  // privileged desktop renderer is one versioned local artifact. The hosted
  // deployment may use the same build output through its own delivery path.
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
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
