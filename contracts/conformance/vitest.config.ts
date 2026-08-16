// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'compatibility-contracts',
    environment: 'node',
    include: ['contracts/conformance/**/*.test.ts'],
  },
});
