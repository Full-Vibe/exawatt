import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  type DistributionContractV2,
} from '@exawatt/core/distribution';
import {
  DISTRIBUTION_WEB_ICON_URL,
  resolveDistributionWebIcon,
} from './web-brand';

const BRANDED_DISTRIBUTION: DistributionContractV2 = {
  ...COMMUNITY_DISTRIBUTION,
  brand: {
    appId: 'com.example.desktop',
    productName: 'Example Desktop',
    protocolScheme: 'example',
    iconPath: 'electron/resources/example.icns',
    updateChannel: 'stable',
  },
};

describe('distribution web mark', () => {
  it('uses the build-prepared asset for a community distribution', () => {
    const url = resolveDistributionWebIcon(COMMUNITY_DISTRIBUTION);

    expect(url).toBe(DISTRIBUTION_WEB_ICON_URL);
    expect(
      existsSync(
        path.join(process.cwd(), 'src', 'app', url.slice(1), 'route.ts')
      )
    ).toBe(true);
  });

  it('uses the same contract-owned projection for a branded distributor', () => {
    expect(resolveDistributionWebIcon(BRANDED_DISTRIBUTION)).toBe(
      DISTRIBUTION_WEB_ICON_URL
    );
  });
});
