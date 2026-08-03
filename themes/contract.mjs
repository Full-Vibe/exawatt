import { z } from 'zod';

export const THEME_SCHEMA_VERSION = 1;
export const APPEARANCE_SCHEMA_VERSION = 1;

const color = z
  .string()
  .regex(/^#[0-9A-F]{6}([0-9A-F]{2})?$/, 'must be an uppercase sRGB hex color');
const opaqueColor = z
  .string()
  .regex(/^#[0-9A-F]{6}$/, 'must be an opaque uppercase sRGB hex color');
const safeLabel = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9 .&+-]+$/, 'contains unsupported characters');

const foundation = z.strictObject({
  canvas: opaqueColor,
  surface: opaqueColor,
  surfaceRaised: opaqueColor,
  overlay: opaqueColor,
  input: opaqueColor,
  text: opaqueColor,
  textMuted: opaqueColor,
  textFaint: opaqueColor,
  border: opaqueColor,
  borderStrong: opaqueColor,
  selection: opaqueColor,
  selectionText: opaqueColor,
  focus: opaqueColor,
  action: opaqueColor,
  actionHover: opaqueColor,
  actionText: opaqueColor,
  secondary: opaqueColor,
  secondaryText: opaqueColor,
  destructive: opaqueColor,
  destructiveText: opaqueColor,
});

const hud = z.strictObject({
  void: opaqueColor,
  deep: opaqueColor,
  panel: opaqueColor,
  panelFill: color,
  hazeTeal: opaqueColor,
  hazeIndigo: opaqueColor,
  hazeMagenta: opaqueColor,
  cyan: opaqueColor,
  cyan2: opaqueColor,
  cyanDim: opaqueColor,
  magenta: opaqueColor,
  amber: opaqueColor,
  red: opaqueColor,
  green: opaqueColor,
  idle: opaqueColor,
  text: opaqueColor,
  textDim: opaqueColor,
  textMono: opaqueColor,
  stroke: color,
  strokeSoft: color,
  strokeFaint: color,
  divider: color,
  surfaceInput: color,
  surfaceInputSoft: color,
  fill: color,
  fillHi: color,
});

const status = z.strictObject({
  off: opaqueColor,
  active: opaqueColor,
  result: opaqueColor,
  needsYou: opaqueColor,
  fault: opaqueColor,
});

const consumption = z.strictObject({
  calm: opaqueColor,
  mid: opaqueColor,
  warm: opaqueColor,
  hot: opaqueColor,
  track: color,
  trackLine: color,
  unknown: opaqueColor,
  unknownLine: color,
  panel: color,
  units: z.strictObject({
    cacheRead: opaqueColor,
    cacheWrite: opaqueColor,
    input: opaqueColor,
    output: opaqueColor,
    reasoning: opaqueColor,
  }),
});

const readiness = z.strictObject({
  neutral: opaqueColor,
  neutralSoft: color,
  surface: color,
});

const terminal = z.strictObject({
  background: opaqueColor,
  foreground: opaqueColor,
  cursor: opaqueColor,
  cursorAccent: opaqueColor,
  selectionBackground: color,
  selectionForeground: opaqueColor,
  black: opaqueColor,
  red: opaqueColor,
  green: opaqueColor,
  yellow: opaqueColor,
  blue: opaqueColor,
  magenta: opaqueColor,
  cyan: opaqueColor,
  white: opaqueColor,
  brightBlack: opaqueColor,
  brightRed: opaqueColor,
  brightGreen: opaqueColor,
  brightYellow: opaqueColor,
  brightBlue: opaqueColor,
  brightMagenta: opaqueColor,
  brightCyan: opaqueColor,
  brightWhite: opaqueColor,
});

const spatial = z.strictObject({
  canvas: opaqueColor,
  grid: opaqueColor,
  zone: opaqueColor,
  selection: opaqueColor,
  unit: opaqueColor,
  unitMuted: opaqueColor,
  label: opaqueColor,
  labelMuted: opaqueColor,
  emissive: opaqueColor,
  emissiveActive: opaqueColor,
  bloom: z.strictObject({
    threshold: z.number().min(0).max(1),
    strength: z.number().min(0).max(2),
    radius: z.number().min(0).max(1),
  }),
});

const materialRecipe = z.strictObject({
  tint: opaqueColor,
  opacity: z.number().min(0.5).max(1),
  blur: z.number().int().min(0).max(40),
  saturation: z.number().min(0.5).max(2),
  fallback: opaqueColor,
});

export const ThemeDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(THEME_SCHEMA_VERSION),
    id: z.string().regex(/^exawatt-[a-z0-9-]+$/).max(64),
    label: safeLabel,
    author: z.literal('Exawatt'),
    appearance: z.enum(['light', 'dark']),
    availability: z.enum(['production', 'gallery']),
    foundation,
    hud,
    status,
    consumption,
    readiness,
    terminal,
    spatial,
    typography: z.strictObject({
      profile: z.enum(['classic', 'air', 'night']),
    }),
    material: z.strictObject({
      chrome: materialRecipe,
      overlay: materialRecipe,
      raised: materialRecipe,
    }),
    bootstrap: z.strictObject({
      background: opaqueColor,
      foreground: opaqueColor,
      signal: opaqueColor,
      colorScheme: z.enum(['light', 'dark']),
    }),
  })
  .superRefine((theme, context) => {
    if (theme.bootstrap.colorScheme !== theme.appearance) {
      context.addIssue({
        code: 'custom',
        path: ['bootstrap', 'colorScheme'],
        message: 'must match appearance',
      });
    }
  });

const selection = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('manual'),
    themeId: z.string().regex(/^exawatt-[a-z0-9-]+$/),
  }),
  z.strictObject({
    mode: z.literal('auto'),
    lightThemeId: z.string().regex(/^exawatt-[a-z0-9-]+$/),
    darkThemeId: z.string().regex(/^exawatt-[a-z0-9-]+$/),
  }),
]);

export const AppearancePreferencesSchema = z.strictObject({
  schemaVersion: z.literal(APPEARANCE_SCHEMA_VERSION),
  selection,
  accentSource: z.enum(['theme', 'system']),
  interfaceFont: z.enum(['theme', 'system', 'geist']),
  interfaceScale: z.union([
    z.literal(90),
    z.literal(100),
    z.literal(110),
    z.literal(120),
  ]),
  contrast: z.enum(['system', 'enhanced']),
  transparency: z.enum(['system', 'reduced']),
});

export function parseThemeDefinition(value) {
  return ThemeDefinitionSchema.parse(value);
}

export function parseAppearancePreferences(value) {
  return AppearancePreferencesSchema.parse(value);
}

function channelLuminance(channel) {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(value) {
  const rgb = value.slice(1, 7);
  const red = Number.parseInt(rgb.slice(0, 2), 16);
  const green = Number.parseInt(rgb.slice(2, 4), 16);
  const blue = Number.parseInt(rgb.slice(4, 6), 16);
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

export function contrastRatio(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function validateThemeContrast(theme) {
  const checks = [
    ['foundation.canvas/text', theme.foundation.text, theme.foundation.canvas, 4.5],
    ['foundation.surface/text', theme.foundation.text, theme.foundation.surface, 4.5],
    ['foundation.overlay/text', theme.foundation.text, theme.foundation.overlay, 4.5],
    ['foundation.input/text', theme.foundation.text, theme.foundation.input, 4.5],
    ['foundation.action/actionText', theme.foundation.actionText, theme.foundation.action, 4.5],
    [
      'foundation.destructive/destructiveText',
      theme.foundation.destructiveText,
      theme.foundation.destructive,
      4.5,
    ],
    ['hud.void/text', theme.hud.text, theme.hud.void, 4.5],
    ['hud.panel/text', theme.hud.text, theme.hud.panel, 4.5],
    ['terminal.background/foreground', theme.terminal.foreground, theme.terminal.background, 4.5],
    ['bootstrap.background/foreground', theme.bootstrap.foreground, theme.bootstrap.background, 4.5],
  ];
  return checks.flatMap(([path, foreground, background, minimum]) => {
    const ratio = contrastRatio(foreground, background);
    return ratio >= minimum
      ? []
      : [`${path} contrast ${ratio.toFixed(2)} is below ${minimum}`];
  });
}
