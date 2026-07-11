import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * User settings (ENG-015 S3): a plain JSON file in userData — the escape
 * hatch for personal taste the DEFAULTS deliberately don't encode (the
 * genericize rule: defaults are platform-native; YOUR terminal font goes
 * here). No settings UI yet; the file is the interface:
 *
 *   <userData>/settings.json
 *   { "terminal": { "fontFamily": "\"MesloLGS For Powerline\", Menlo, monospace",
 *                   "fontSize": 14, "lineHeight": 1.0,
 *                   "letterSpacing": -1, "fontStrokeWidth": 0.15 } }
 *
 * Renderers fetch via settings:get on mount and after window refocus;
 * tolerant of a missing/invalid file.
 */

export interface TerminalFontSettings {
  fontFamily?: string;
  fontSize?: number;
  /** xterm line-height multiplier; 1.0 = the font's own metrics (what
   *  Terminal.app uses — Meslo LG variants tune their gap internally) */
  lineHeight?: number;
  /** xterm cell-spacing adjustment. Native terminals often quantize a
   *  font's fractional advance differently from Chromium. */
  letterSpacing?: number;
  /** Subpixel emboldening for matching native rasterizers without swapping
   *  the configured font face for its bold variant. */
  fontStrokeWidth?: number;
}

export interface ExawattSettings {
  terminal?: TerminalFontSettings;
  notifications?: {
    attention: boolean;
  };
}

export function parseSettings(raw: unknown): ExawattSettings {
  if (!raw || typeof raw !== 'object') return {};
  const settings: ExawattSettings = {};
  {
    const t = (raw as { terminal?: unknown }).terminal;
    if (t && typeof t === 'object') {
      const {
        fontFamily,
        fontSize,
        lineHeight,
        letterSpacing,
        fontStrokeWidth,
      } = t as Record<string, unknown>;
      const terminal: TerminalFontSettings = {};
      if (typeof fontFamily === 'string' && fontFamily.trim()) {
        terminal.fontFamily = fontFamily.trim();
      }
      if (typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize >= 8 && fontSize <= 32) terminal.fontSize = fontSize;
      if (typeof lineHeight === 'number' && Number.isFinite(lineHeight) && lineHeight >= 0.8 && lineHeight <= 2) terminal.lineHeight = lineHeight;
      if (typeof letterSpacing === 'number' && Number.isFinite(letterSpacing) && letterSpacing >= -5 && letterSpacing <= 20) terminal.letterSpacing = letterSpacing;
      if (typeof fontStrokeWidth === 'number' && Number.isFinite(fontStrokeWidth) && fontStrokeWidth >= 0 && fontStrokeWidth <= 1) terminal.fontStrokeWidth = fontStrokeWidth;
      if (Object.keys(terminal).length > 0) settings.terminal = terminal;
    }
  }
  const notifications = (raw as { notifications?: unknown }).notifications;
  if (notifications && typeof notifications === 'object') {
    const attention = (notifications as { attention?: unknown }).attention;
    if (typeof attention === 'boolean') settings.notifications = { attention };
  }
  return settings;
}

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): ExawattSettings {
  try {
    return parseSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch {
    return {}; // no file / bad JSON → pure defaults
  }
}

export function setAttentionNotifications(enabled: boolean): ExawattSettings {
  const settings = loadSettings();
  settings.notifications = { attention: enabled };
  const file = settingsFile();
  const staging = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(staging, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(staging, file);
  return settings;
}
