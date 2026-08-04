import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  THEME_BOOTSTRAP_REGISTRY,
  type ThemeBootstrapId,
} from './generated-theme-bootstrap';
import {
  deleteLaunchConfiguration as deleteConfiguration,
  emptyLaunchConfigurationPool,
  parseLaunchConfigurationPool,
  recordLaunchConfigurationSuccess as recordConfigurationSuccess,
  renameLaunchConfiguration as renameConfiguration,
  saveNamedLaunchConfiguration as saveNamedConfiguration,
  setLaunchConfigurationPinned as setConfigurationPinned,
  type AgentLaunchConfigurationInput,
  type LaunchConfigurationPoolV1,
} from '@exawatt/core';

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
    /** macOS dock badge count + bounce for needs-you attention (D18):
     *  default off — ambient OS-level signals are opt-in. */
    dockBadge?: boolean;
  };
  conversationSummaries?: {
    /** Hosted Haiku labels for local conversation excerpts. Defaults on;
     * excerpts are secret-redacted before they leave the device. */
    hosted: boolean;
  };
  goalVisuals?: {
    /** Generated Team-tile imagery defaults on; false suppresses rendering
     * and future generation while preserving the private cache. */
    enabled: boolean;
  };
  agentSources?: {
    projectLastUsed: Record<string, string>;
    sourceRecency: Record<string, number>;
    projectPermissionModes: Record<string, Record<string, AgentPermissionMode>>;
  };
  launchConfigurations?: LaunchConfigurationPoolV1;
  appearance?: ElectronAppearancePreferencesV1;
}

export type ElectronAppearanceSelectionV1 =
  | { mode: 'manual'; themeId: ThemeBootstrapId }
  | {
      mode: 'auto';
      lightThemeId: ThemeBootstrapId;
      darkThemeId: ThemeBootstrapId;
    };

export interface ElectronAppearanceAutoPairV1 {
  lightThemeId: ThemeBootstrapId;
  darkThemeId: ThemeBootstrapId;
}

export interface ElectronAppearancePreferencesV1 {
  schemaVersion: 1;
  selection: ElectronAppearanceSelectionV1;
  autoPair?: ElectronAppearanceAutoPairV1;
  accentSource: 'theme' | 'system';
  interfaceFont: 'theme' | 'system' | 'geist';
  interfaceScale: 90 | 100 | 110 | 120;
  contrast: 'system' | 'enhanced';
  transparency: 'system' | 'reduced';
}

const DEFAULT_ELECTRON_AUTO_PAIR: ElectronAppearanceAutoPairV1 = {
  lightThemeId: 'exawatt-air-light',
  darkThemeId: 'exawatt-night-dark',
};

export const DEFAULT_ELECTRON_APPEARANCE_PREFERENCES: ElectronAppearancePreferencesV1 =
  {
    schemaVersion: 1,
    selection: { mode: 'auto', ...DEFAULT_ELECTRON_AUTO_PAIR },
    autoPair: DEFAULT_ELECTRON_AUTO_PAIR,
    accentSource: 'theme',
    interfaceFont: 'theme',
    interfaceScale: 100,
    contrast: 'system',
    transparency: 'system',
  };

export const CLASSIC_RECOVERY_ELECTRON_APPEARANCE_PREFERENCES: ElectronAppearancePreferencesV1 =
  {
    schemaVersion: 1,
    selection: { mode: 'manual', themeId: 'exawatt-classic-dark' },
    autoPair: DEFAULT_ELECTRON_AUTO_PAIR,
    accentSource: 'theme',
    interfaceFont: 'theme',
    interfaceScale: 100,
    contrast: 'system',
    transparency: 'system',
  };

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

function isThemeId(value: unknown): value is ThemeBootstrapId {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(THEME_BOOTSTRAP_REGISTRY, value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

export function parseAppearancePreferences(
  raw: unknown
): ElectronAppearancePreferencesV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    (!hasExactKeys(candidate, [
      'schemaVersion',
      'selection',
      'accentSource',
      'interfaceFont',
      'interfaceScale',
      'contrast',
      'transparency',
    ]) &&
      !hasExactKeys(candidate, [
        'schemaVersion',
        'selection',
        'autoPair',
        'accentSource',
        'interfaceFont',
        'interfaceScale',
        'contrast',
        'transparency',
      ]))
  )
    return null;

  const rawSelection = candidate.selection;
  if (!rawSelection || typeof rawSelection !== 'object') return null;
  const selectionCandidate = rawSelection as Record<string, unknown>;
  let selection: ElectronAppearanceSelectionV1;
  if (
    selectionCandidate.mode === 'manual' &&
    isThemeId(selectionCandidate.themeId) &&
    hasExactKeys(selectionCandidate, ['mode', 'themeId'])
  ) {
    selection = {
      mode: 'manual',
      themeId: selectionCandidate.themeId,
    };
  } else if (
    selectionCandidate.mode === 'auto' &&
    isThemeId(selectionCandidate.lightThemeId) &&
    isThemeId(selectionCandidate.darkThemeId) &&
    hasExactKeys(selectionCandidate, ['mode', 'lightThemeId', 'darkThemeId']) &&
    THEME_BOOTSTRAP_REGISTRY[selectionCandidate.lightThemeId].appearance ===
      'light' &&
    THEME_BOOTSTRAP_REGISTRY[selectionCandidate.darkThemeId].appearance ===
      'dark'
  ) {
    selection = {
      mode: 'auto',
      lightThemeId: selectionCandidate.lightThemeId,
      darkThemeId: selectionCandidate.darkThemeId,
    };
  } else {
    return null;
  }

  let autoPair: ElectronAppearanceAutoPairV1;
  const rawAutoPair = candidate.autoPair;
  if (rawAutoPair === undefined) {
    autoPair =
      selection.mode === 'auto'
        ? {
            lightThemeId: selection.lightThemeId,
            darkThemeId: selection.darkThemeId,
          }
        : { ...DEFAULT_ELECTRON_AUTO_PAIR };
  } else if (rawAutoPair && typeof rawAutoPair === 'object') {
    const pair = rawAutoPair as Record<string, unknown>;
    if (
      !hasExactKeys(pair, ['lightThemeId', 'darkThemeId']) ||
      !isThemeId(pair.lightThemeId) ||
      !isThemeId(pair.darkThemeId) ||
      THEME_BOOTSTRAP_REGISTRY[pair.lightThemeId].appearance !== 'light' ||
      THEME_BOOTSTRAP_REGISTRY[pair.darkThemeId].appearance !== 'dark' ||
      (selection.mode === 'auto' &&
        (pair.lightThemeId !== selection.lightThemeId ||
          pair.darkThemeId !== selection.darkThemeId))
    )
      return null;
    autoPair = {
      lightThemeId: pair.lightThemeId,
      darkThemeId: pair.darkThemeId,
    };
  } else {
    return null;
  }

  const accentSource = candidate.accentSource;
  const interfaceFont = candidate.interfaceFont;
  const interfaceScale = candidate.interfaceScale;
  const contrast = candidate.contrast;
  const transparency = candidate.transparency;
  if (
    (accentSource !== 'theme' && accentSource !== 'system') ||
    (interfaceFont !== 'theme' &&
      interfaceFont !== 'system' &&
      interfaceFont !== 'geist') ||
    (interfaceScale !== 90 &&
      interfaceScale !== 100 &&
      interfaceScale !== 110 &&
      interfaceScale !== 120) ||
    (contrast !== 'system' && contrast !== 'enhanced') ||
    (transparency !== 'system' && transparency !== 'reduced')
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    selection,
    autoPair,
    accentSource,
    interfaceFont,
    interfaceScale,
    // The manual accessibility toggles were retired after the first rollout.
    // Accept their V1 values for backward compatibility, then persist only
    // OS-managed behavior so an operator cannot remain stuck on a hidden flag.
    contrast: 'system',
    transparency: 'system',
  };
}

export function isPersistableAppearancePreferences(
  preferences: ElectronAppearancePreferencesV1
): boolean {
  const ids =
    preferences.selection.mode === 'manual'
      ? [preferences.selection.themeId]
      : [preferences.selection.lightThemeId, preferences.selection.darkThemeId];
  const autoPairIds = preferences.autoPair
    ? [preferences.autoPair.lightThemeId, preferences.autoPair.darkThemeId]
    : [];
  return [...ids, ...autoPairIds].every(
    id => THEME_BOOTSTRAP_REGISTRY[id].availability === 'production'
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
    const candidate = notifications as {
      attention?: unknown;
      dockBadge?: unknown;
    };
    const parsed: NonNullable<ExawattSettings['notifications']> = {
      attention:
        typeof candidate.attention === 'boolean' ? candidate.attention : false,
    };
    if (typeof candidate.dockBadge === 'boolean')
      parsed.dockBadge = candidate.dockBadge;
    if (
      typeof candidate.attention === 'boolean' ||
      typeof candidate.dockBadge === 'boolean'
    )
      settings.notifications = parsed;
  }
  const conversationSummaries = (raw as { conversationSummaries?: unknown })
    .conversationSummaries;
  if (conversationSummaries && typeof conversationSummaries === 'object') {
    const hosted = (conversationSummaries as { hosted?: unknown }).hosted;
    if (typeof hosted === 'boolean') {
      settings.conversationSummaries = { hosted };
    }
  }
  const goalVisuals = (raw as { goalVisuals?: unknown }).goalVisuals;
  if (goalVisuals && typeof goalVisuals === 'object') {
    const enabled = (goalVisuals as { enabled?: unknown }).enabled;
    if (typeof enabled === 'boolean') settings.goalVisuals = { enabled };
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
  if (Object.prototype.hasOwnProperty.call(raw, 'launchConfigurations')) {
    settings.launchConfigurations = parseLaunchConfigurationPool(
      (raw as { launchConfigurations?: unknown }).launchConfigurations
    );
  }
  const appearance = parseAppearancePreferences(
    (raw as { appearance?: unknown }).appearance
  );
  if (appearance) settings.appearance = appearance;
  return settings;
}

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): ExawattSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {};
    }
    return {
      appearance: structuredClone(
        CLASSIC_RECOVERY_ELECTRON_APPEARANCE_PREFERENCES
      ),
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      appearance: structuredClone(
        CLASSIC_RECOVERY_ELECTRON_APPEARANCE_PREFERENCES
      ),
    };
  }
  const settings = parseSettings(raw);
  if (
    Object.prototype.hasOwnProperty.call(raw, 'appearance') &&
    !settings.appearance
  ) {
    settings.appearance = structuredClone(
      CLASSIC_RECOVERY_ELECTRON_APPEARANCE_PREFERENCES
    );
  }
  return settings;
}

function writeSettings(settings: ExawattSettings): void {
  const file = settingsFile();
  const staging = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(staging, `${JSON.stringify(settings, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(staging, file);
  } finally {
    try {
      fs.unlinkSync(staging);
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
  }
}

function launchConfigurationPool(
  settings: ExawattSettings
): LaunchConfigurationPoolV1 {
  return settings.launchConfigurations ?? emptyLaunchConfigurationPool();
}

export function recordLaunchConfigurationSuccess(
  projectDir: string,
  rawTarget: unknown,
  launchedAt = Date.now()
): ExawattSettings {
  const settings = loadSettings();
  settings.launchConfigurations = recordConfigurationSuccess(
    launchConfigurationPool(settings),
    projectDir,
    rawTarget as AgentLaunchConfigurationInput | { kind: 'shell' },
    launchedAt
  );
  writeSettings(settings);
  return settings;
}

export function saveNamedLaunchConfiguration(
  rawConfiguration: unknown,
  name: unknown,
  savedAt = Date.now()
): ExawattSettings {
  const settings = loadSettings();
  settings.launchConfigurations = saveNamedConfiguration(
    launchConfigurationPool(settings),
    rawConfiguration as AgentLaunchConfigurationInput,
    name as string,
    savedAt
  );
  writeSettings(settings);
  return settings;
}

export function renameLaunchConfiguration(
  id: unknown,
  name: unknown
): ExawattSettings {
  if (typeof id !== 'string')
    throw new Error('Invalid Launch Configuration id');
  const settings = loadSettings();
  settings.launchConfigurations = renameConfiguration(
    launchConfigurationPool(settings),
    id,
    name as string
  );
  writeSettings(settings);
  return settings;
}

export function deleteLaunchConfiguration(id: unknown): ExawattSettings {
  if (typeof id !== 'string')
    throw new Error('Invalid Launch Configuration id');
  const settings = loadSettings();
  settings.launchConfigurations = deleteConfiguration(
    launchConfigurationPool(settings),
    id
  );
  writeSettings(settings);
  return settings;
}

export function setLaunchConfigurationPinned(
  projectDir: string,
  id: unknown,
  pinned: unknown
): ExawattSettings {
  if (typeof id !== 'string' || typeof pinned !== 'boolean') {
    throw new Error('Invalid Launch Configuration pin');
  }
  const settings = loadSettings();
  settings.launchConfigurations = setConfigurationPinned(
    launchConfigurationPool(settings),
    projectDir,
    id,
    pinned
  );
  writeSettings(settings);
  return settings;
}

export function setAttentionNotifications(enabled: boolean): ExawattSettings {
  const settings = loadSettings();
  settings.notifications = { ...settings.notifications, attention: enabled };
  writeSettings(settings);
  return settings;
}

export function setDockBadge(enabled: boolean): ExawattSettings {
  const settings = loadSettings();
  settings.notifications = {
    attention: settings.notifications?.attention ?? false,
    dockBadge: enabled,
  };
  writeSettings(settings);
  return settings;
}

export function setHostedConversationSummaries(
  enabled: boolean
): ExawattSettings {
  const settings = loadSettings();
  settings.conversationSummaries = { hosted: enabled };
  writeSettings(settings);
  return settings;
}

export function setGoalVisualsEnabled(enabled: boolean): ExawattSettings {
  const settings = loadSettings();
  settings.goalVisuals = { enabled };
  writeSettings(settings);
  return settings;
}

export function setAppearancePreferences(raw: unknown): ExawattSettings {
  const appearance = parseAppearancePreferences(raw);
  if (!appearance || !isPersistableAppearancePreferences(appearance)) {
    throw new Error('Invalid or unavailable appearance preference');
  }
  const settings = loadSettings();
  settings.appearance = appearance;
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
