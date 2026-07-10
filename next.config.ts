import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@exawatt/core', '@exawatt/ui-model'],
  // the floating Next dev-tools badge occludes the workspace chrome in the
  // Electron app (operator, dogfood round 4)
  devIndicators: false,
};

export default nextConfig;
