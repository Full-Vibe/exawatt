'use client';

import { createContext, useContext } from 'react';
import type { ThemeDefinitionV1 } from '@/lib/appearance/types';

/**
 * The theme painting this tree, published by `AppearanceProvider` on its own
 * narrow context. Presentation that must resolve paint against the active
 * ground (`AgentSourceMark`) reads this instead of the whole appearance
 * value, so it re-renders only when the theme changes and works unchanged
 * where a test replaces the provider module.
 */
export const ActiveThemeContext = createContext<ThemeDefinitionV1 | null>(null);

/** The active theme, or null outside an `AppearanceProvider` (an isolated
 *  test or specimen): the caller then renders its theme-independent paint. */
export function useActiveTheme(): ThemeDefinitionV1 | null {
  return useContext(ActiveThemeContext);
}
