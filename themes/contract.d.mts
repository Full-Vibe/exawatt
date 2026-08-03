import type { ZodType } from 'zod';
import type {
  AppearancePreferencesV1,
  ThemeDefinitionV1,
} from '../src/lib/appearance/types';

export declare const THEME_SCHEMA_VERSION: 1;
export declare const APPEARANCE_SCHEMA_VERSION: 1;
export declare const ThemeDefinitionSchema: ZodType<ThemeDefinitionV1>;
export declare const AppearancePreferencesSchema: ZodType<AppearancePreferencesV1>;
export declare function parseThemeDefinition(value: unknown): ThemeDefinitionV1;
export declare function parseAppearancePreferences(
  value: unknown
): AppearancePreferencesV1;
export declare function contrastRatio(
  foreground: string,
  background: string
): number;
export declare function validateThemeContrast(theme: ThemeDefinitionV1): string[];
