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
}

export function loadSettings(): ExawattSettings {
  try {
    const file = path.join(app.getPath('userData'), 'settings.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const t = (raw as { terminal?: unknown }).terminal;
    if (!t || typeof t !== 'object') return {};
    const {
      fontFamily,
      fontSize,
      lineHeight,
      letterSpacing,
      fontStrokeWidth,
    } = t as {
      fontFamily?: unknown;
      fontSize?: unknown;
      lineHeight?: unknown;
      letterSpacing?: unknown;
      fontStrokeWidth?: unknown;
    };
    const terminal: TerminalFontSettings = {};
    if (typeof fontFamily === 'string' && fontFamily.trim()) {
      terminal.fontFamily = fontFamily.trim();
    }
    if (
      typeof fontSize === 'number' &&
      Number.isFinite(fontSize) &&
      fontSize >= 8 &&
      fontSize <= 32
    ) {
      terminal.fontSize = fontSize;
    }
    if (
      typeof lineHeight === 'number' &&
      Number.isFinite(lineHeight) &&
      lineHeight >= 0.8 &&
      lineHeight <= 2
    ) {
      terminal.lineHeight = lineHeight;
    }
    if (
      typeof letterSpacing === 'number' &&
      Number.isFinite(letterSpacing) &&
      letterSpacing >= -5 &&
      letterSpacing <= 20
    ) {
      terminal.letterSpacing = letterSpacing;
    }
    if (
      typeof fontStrokeWidth === 'number' &&
      Number.isFinite(fontStrokeWidth) &&
      fontStrokeWidth >= 0 &&
      fontStrokeWidth <= 1
    ) {
      terminal.fontStrokeWidth = fontStrokeWidth;
    }
    return Object.keys(terminal).length > 0 ? { terminal } : {};
  } catch {
    return {}; // no file / bad JSON → pure defaults
  }
}
