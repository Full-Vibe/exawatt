const HEX_COLOR = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseHexColor(value: string): RgbaColor | null {
  const match = HEX_COLOR.exec(value);
  if (!match) return null;
  const rgb = match[1];
  return {
    r: Number.parseInt(rgb.slice(0, 2), 16),
    g: Number.parseInt(rgb.slice(2, 4), 16),
    b: Number.parseInt(rgb.slice(4, 6), 16),
    a: match[2] ? Number.parseInt(match[2], 16) / 255 : 1,
  };
}

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(value: string): number {
  const color = parseHexColor(value);
  if (!color) throw new Error(`Expected an sRGB hex color, received ${value}`);
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function mixHexColors(
  first: string,
  second: string,
  amount: number
): string {
  const a = parseHexColor(first);
  const b = parseHexColor(second);
  if (!a || !b) throw new Error('mixHexColors accepts sRGB hex colors only');
  const t = Math.max(0, Math.min(1, amount));
  const channel = (left: number, right: number) =>
    Math.round(left + (right - left) * t)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

/**
 * Keep a requested system accent when it is readable; otherwise move it only
 * as far toward black or white as needed. If neither direction can satisfy the
 * target, use the authored fallback instead of creating an unreadable action.
 */
export function correctAccentContrast(
  accent: string,
  foreground: string,
  fallback: string,
  minimum = 4.5
): string {
  if (!isHexColor(accent) || !isHexColor(foreground)) return fallback;
  if (contrastRatio(accent, foreground) >= minimum) return accent.toUpperCase();

  const candidates: Array<{ color: string; distance: number }> = [];
  for (const target of ['#000000', '#FFFFFF'] as const) {
    for (let step = 1; step <= 20; step += 1) {
      const distance = step / 20;
      const color = mixHexColors(accent, target, distance);
      if (contrastRatio(color, foreground) >= minimum) {
        candidates.push({ color, distance });
        break;
      }
    }
  }
  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.color ?? fallback;
}

