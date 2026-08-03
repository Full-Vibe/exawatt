export const CLASSIC_THEME_ID = 'exawatt-classic-dark' as const;
export const AIR_THEME_ID = 'exawatt-air-light' as const;
export const NIGHT_THEME_ID = 'exawatt-night-dark' as const;

export const BUILT_IN_THEME_IDS = [
  CLASSIC_THEME_ID,
  AIR_THEME_ID,
  NIGHT_THEME_ID,
] as const;

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];
export type ThemeAppearance = 'light' | 'dark';
export type ThemeAvailability = 'production' | 'gallery';
export type ThemeTypographyProfile = 'classic' | 'air' | 'night';

export interface ThemeFoundationV1 {
  canvas: string;
  surface: string;
  surfaceRaised: string;
  overlay: string;
  input: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  selection: string;
  selectionText: string;
  focus: string;
  action: string;
  actionHover: string;
  actionText: string;
  secondary: string;
  secondaryText: string;
  destructive: string;
  destructiveText: string;
}

export interface ThemeHudV1 {
  void: string;
  deep: string;
  panel: string;
  panelFill: string;
  hazeTeal: string;
  hazeIndigo: string;
  hazeMagenta: string;
  cyan: string;
  cyan2: string;
  cyanDim: string;
  magenta: string;
  amber: string;
  red: string;
  green: string;
  idle: string;
  text: string;
  textDim: string;
  textMono: string;
  stroke: string;
  strokeSoft: string;
  strokeFaint: string;
  divider: string;
  surfaceInput: string;
  surfaceInputSoft: string;
  fill: string;
  fillHi: string;
}

export interface ThemeStatusV1 {
  off: string;
  active: string;
  result: string;
  needsYou: string;
  fault: string;
}

export interface ThemeConsumptionV1 {
  calm: string;
  mid: string;
  warm: string;
  hot: string;
  track: string;
  trackLine: string;
  unknown: string;
  unknownLine: string;
  panel: string;
  units: {
    cacheRead: string;
    cacheWrite: string;
    input: string;
    output: string;
    reasoning: string;
  };
}

export interface ThemeReadinessV1 {
  neutral: string;
  neutralSoft: string;
  surface: string;
}

export interface ThemeTerminalV1 {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemeSpatialV1 {
  canvas: string;
  grid: string;
  zone: string;
  selection: string;
  unit: string;
  unitMuted: string;
  label: string;
  labelMuted: string;
  emissive: string;
  emissiveActive: string;
  bloom: {
    threshold: number;
    strength: number;
    radius: number;
  };
}

export interface ThemeMaterialRecipeV1 {
  tint: string;
  opacity: number;
  blur: number;
  saturation: number;
  fallback: string;
}

export interface ThemeMaterialV1 {
  chrome: ThemeMaterialRecipeV1;
  overlay: ThemeMaterialRecipeV1;
  raised: ThemeMaterialRecipeV1;
}

export interface ThemeDefinitionV1 {
  schemaVersion: 1;
  id: string;
  label: string;
  author: 'Exawatt';
  appearance: ThemeAppearance;
  availability: ThemeAvailability;
  foundation: ThemeFoundationV1;
  hud: ThemeHudV1;
  status: ThemeStatusV1;
  consumption: ThemeConsumptionV1;
  readiness: ThemeReadinessV1;
  terminal: ThemeTerminalV1;
  spatial: ThemeSpatialV1;
  typography: {
    profile: ThemeTypographyProfile;
  };
  material: ThemeMaterialV1;
  bootstrap: {
    background: string;
    foreground: string;
    signal: string;
    colorScheme: ThemeAppearance;
  };
}

export type AppearanceSelectionV1 =
  | { mode: 'manual'; themeId: string }
  | {
      mode: 'auto';
      lightThemeId: string;
      darkThemeId: string;
    };

export interface AppearancePreferencesV1 {
  schemaVersion: 1;
  selection: AppearanceSelectionV1;
  accentSource: 'theme' | 'system';
  interfaceFont: 'theme' | 'system' | 'geist';
  interfaceScale: 90 | 100 | 110 | 120;
  contrast: 'system' | 'enhanced';
  transparency: 'system' | 'reduced';
}

export interface AppearanceOsSignals {
  dark: boolean;
  highContrast: boolean;
  forcedColors: boolean;
  invertedColors: boolean;
  reducedTransparency: boolean;
  systemAccent?: string;
  /** One-launch recovery override supplied by Electron's --safe-theme flag. */
  safeTheme?: boolean;
}

export interface AppearancePreview {
  themeId?: string;
}

export interface ResolvedAppearance {
  themeId: string;
  appearance: ThemeAppearance;
  theme: ThemeDefinitionV1;
  interfaceFont: AppearancePreferencesV1['interfaceFont'];
  interfaceScale: AppearancePreferencesV1['interfaceScale'];
  enhancedContrast: boolean;
  reducedTransparency: boolean;
  preview: boolean;
}

export type ThemeRegistry = Readonly<Record<string, ThemeDefinitionV1>>;
