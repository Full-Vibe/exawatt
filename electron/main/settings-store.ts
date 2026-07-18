import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type AgentPermissionMode = 'prompt' | 'auto' | 'unrestricted';

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
 * Terminal settings still use the file directly; launch preferences are
 * written through validated IPC. Renderers fetch via settings:get on mount and
 * after window refocus, tolerant of a missing/invalid file.
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
  agentSources?: {
    projectLastUsed: Record<string, string>;
    sourceRecency: Record<string, number>;
    projectPermissionModes: Record<string, Record<string, AgentPermissionMode>>;
  };
}

const AGENT_PERMISSION_MODES = new Set<AgentPermissionMode>([
  'prompt',
  'auto',
  'unrestricted',
]);

function isSafeSourceId(value: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(value);
}

function isAgentPermissionMode(value: unknown): value is AgentPermissionMode {
  return (
    typeof value === 'string' &&
    AGENT_PERMISSION_MODES.has(value as AgentPermissionMode)
  );
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
      if (
        typeof fontSize === 'number' &&
        Number.isFinite(fontSize) &&
        fontSize >= 8 &&
        fontSize <= 32
      )
        terminal.fontSize = fontSize;
      if (
        typeof lineHeight === 'number' &&
        Number.isFinite(lineHeight) &&
        lineHeight >= 0.8 &&
        lineHeight <= 2
      )
        terminal.lineHeight = lineHeight;
      if (
        typeof letterSpacing === 'number' &&
        Number.isFinite(letterSpacing) &&
        letterSpacing >= -5 &&
        letterSpacing <= 20
      )
        terminal.letterSpacing = letterSpacing;
      if (
        typeof fontStrokeWidth === 'number' &&
        Number.isFinite(fontStrokeWidth) &&
        fontStrokeWidth >= 0 &&
        fontStrokeWidth <= 1
      )
        terminal.fontStrokeWidth = fontStrokeWidth;
      if (Object.keys(terminal).length > 0) settings.terminal = terminal;
    }
  }
  const notifications = (raw as { notifications?: unknown }).notifications;
  if (notifications && typeof notifications === 'object') {
    const attention = (notifications as { attention?: unknown }).attention;
    if (typeof attention === 'boolean') settings.notifications = { attention };
  }
  const agentSources = (raw as { agentSources?: unknown }).agentSources;
  if (agentSources && typeof agentSources === 'object') {
    const candidate = agentSources as {
      projectLastUsed?: unknown;
      sourceRecency?: unknown;
      projectPermissionModes?: unknown;
    };
    const projectLastUsed: Record<string, string> = {};
    const sourceRecency: Record<string, number> = {};
    const projectPermissionModes: Record<
      string,
      Record<string, AgentPermissionMode>
    > = {};
    if (
      candidate.projectLastUsed &&
      typeof candidate.projectLastUsed === 'object'
    ) {
      for (const [projectDir, source] of Object.entries(
        candidate.projectLastUsed
      )) {
        if (
          projectDir &&
          projectDir.length <= 4096 &&
          typeof source === 'string' &&
          isSafeSourceId(source)
        ) {
          projectLastUsed[projectDir] = source;
        }
      }
    }
    if (
      candidate.sourceRecency &&
      typeof candidate.sourceRecency === 'object'
    ) {
      for (const [source, timestamp] of Object.entries(
        candidate.sourceRecency
      )) {
        if (
          isSafeSourceId(source) &&
          typeof timestamp === 'number' &&
          Number.isFinite(timestamp) &&
          timestamp >= 0
        ) {
          sourceRecency[source] = timestamp;
        }
      }
    }
    if (
      candidate.projectPermissionModes &&
      typeof candidate.projectPermissionModes === 'object'
    ) {
      for (const [projectDir, sourceModes] of Object.entries(
        candidate.projectPermissionModes
      )) {
        if (
          !projectDir ||
          projectDir.length > 4096 ||
          !sourceModes ||
          typeof sourceModes !== 'object'
        ) {
          continue;
        }
        const parsed: Record<string, AgentPermissionMode> = {};
        for (const [source, permissionMode] of Object.entries(sourceModes)) {
          if (isSafeSourceId(source) && isAgentPermissionMode(permissionMode)) {
            parsed[source] = permissionMode;
          }
        }
        if (Object.keys(parsed).length > 0) {
          projectPermissionModes[projectDir] = parsed;
        }
      }
    }
    settings.agentSources = {
      projectLastUsed,
      sourceRecency,
      projectPermissionModes,
    };
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

function writeSettings(settings: ExawattSettings): void {
  const file = settingsFile();
  const staging = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(staging, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(staging, file);
}

export function setAttentionNotifications(enabled: boolean): ExawattSettings {
  const settings = loadSettings();
  settings.notifications = { attention: enabled };
  writeSettings(settings);
  return settings;
}

export function recordAgentSourceUse(
  projectDir: string,
  source: string,
  usedAt: number
): ExawattSettings {
  if (
    typeof projectDir !== 'string' ||
    !projectDir ||
    projectDir.includes('\0') ||
    projectDir.length > 4096 ||
    typeof source !== 'string' ||
    !/^[a-z0-9-]{1,64}$/.test(source) ||
    !Number.isFinite(usedAt) ||
    usedAt < 0
  ) {
    throw new Error('Invalid Agent Source preference');
  }
  const settings = loadSettings();
  const current = settings.agentSources ?? {
    projectLastUsed: {},
    sourceRecency: {},
    projectPermissionModes: {},
  };
  settings.agentSources = {
    projectLastUsed: { ...current.projectLastUsed, [projectDir]: source },
    sourceRecency: { ...current.sourceRecency, [source]: usedAt },
    projectPermissionModes: current.projectPermissionModes,
  };
  writeSettings(settings);
  return settings;
}

export function setAgentPermissionMode(
  projectDir: string,
  source: string,
  permissionMode: AgentPermissionMode
): ExawattSettings {
  if (
    typeof projectDir !== 'string' ||
    !projectDir ||
    projectDir.includes('\0') ||
    projectDir.length > 4096 ||
    typeof source !== 'string' ||
    !isSafeSourceId(source) ||
    !isAgentPermissionMode(permissionMode)
  ) {
    throw new Error('Invalid Agent permission preference');
  }
  const settings = loadSettings();
  const current = settings.agentSources ?? {
    projectLastUsed: {},
    sourceRecency: {},
    projectPermissionModes: {},
  };
  settings.agentSources = {
    projectLastUsed: current.projectLastUsed,
    sourceRecency: current.sourceRecency,
    projectPermissionModes: {
      ...current.projectPermissionModes,
      [projectDir]: {
        ...current.projectPermissionModes[projectDir],
        [source]: permissionMode,
      },
    },
  };
  writeSettings(settings);
  return settings;
}
