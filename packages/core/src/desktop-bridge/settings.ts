import type { AgentPermissionMode } from '../agent-sources';
import type { LaunchConfigurationPoolV1 } from '../launch-configurations';
import type { OperatorStatsSyncFailureRecord } from '../operator-stats/sync-state';
import type { KeyboardShortcutOverridesV1 } from '../shortcuts/keyboard-overrides';

/**
 * `userData/settings.json`, as main persists it and the renderer reads it
 * (ENG-015 S3). A settings write answers with the whole document, and every
 * change is pushed on `settings:changed`.
 *
 * `ThemeId` is a string on the wire. Main persists only ids its generated
 * theme registry knows, so it instantiates these shapes with that narrower
 * id; a renderer reads plain strings.
 */

export interface TerminalFontSettings {
  fontFamily?: string;
  fontSize?: number;
  /** xterm line-height multiplier; 1.0 = the font's own metrics (what
   *  Terminal.app uses; Meslo LG variants tune their gap internally). */
  lineHeight?: number;
  /** xterm cell-spacing adjustment. Native terminals often quantize a
   *  font's fractional advance differently from Chromium. */
  letterSpacing?: number;
  /** Subpixel emboldening for matching native rasterizers without swapping
   *  the configured font face for its bold variant. */
  fontStrokeWidth?: number;
}

export type AppearanceSelectionV1<ThemeId extends string = string> =
  | { mode: 'manual'; themeId: ThemeId }
  | { mode: 'auto'; lightThemeId: ThemeId; darkThemeId: ThemeId };

export interface AppearanceAutoPairV1<ThemeId extends string = string> {
  lightThemeId: ThemeId;
  darkThemeId: ThemeId;
}

/** The personal-taste escape hatch (S3). */
export interface AppearancePreferencesV1<ThemeId extends string = string> {
  schemaVersion: 1;
  selection: AppearanceSelectionV1<ThemeId>;
  /** The remembered Auto pair, independent of the active selection. Legacy
   *  V1 records omit it and are normalized at persistence boundaries. */
  autoPair?: AppearanceAutoPairV1<ThemeId>;
  accentSource: 'theme' | 'system';
  interfaceFont: 'theme' | 'system' | 'geist';
  interfaceScale: 90 | 100 | 110 | 120;
  contrast: 'system' | 'enhanced';
  transparency: 'system' | 'reduced';
}

export interface ExawattSettings<ThemeId extends string = string> {
  terminal?: TerminalFontSettings;
  notifications?: {
    attention: boolean;
    /** macOS dock badge count + bounce for needs-you attention (D18):
     *  default off; ambient OS-level signals are opt-in. */
    dockBadge?: boolean;
  };
  /**
   * ENG-030 OS1.5. The outbound-feature switches below are decision `0031`'s
   * independent user control for each outbound behavior. All default ON with
   * disclosure; `undefined` means default, never off, and nothing writes a
   * default back into the file. `src/lib/hosted-features/contract.ts`
   * carries the same shape for the Settings surface.
   */
  contextLabels?: {
    /** Hosted Session context labels. Off assembles no operator evidence and
     *  sends nothing; accepted and restored labels survive. */
    hosted: boolean;
  };
  conversationSummaries?: {
    /** Hosted labels for local conversation excerpts. Defaults on; excerpts
     *  are secret-redacted before they leave the device. */
    hosted: boolean;
  };
  goalVisuals?: {
    /** Generated Team-tile imagery defaults on; false suppresses rendering
     *  and future generation while preserving the private cache. */
    enabled: boolean;
  };
  reentryRecap?: {
    /** The "since you left" recap: recent scrollback piped to the operator's
     *  OWN local `claude` CLI, never Exawatt's servers. Off reads no
     *  scrollback and spawns nothing. */
    enabled: boolean;
  };
  claudePlanWindows?: {
    /** ENG-038: read-only plan-window fetch from the operator's own Claude
     *  account, under the credential Claude Code already holds. Defaults on;
     *  off constructs no request and serves no Claude plan windows. */
    enabled: boolean;
  };
  operatorProfile?: {
    /** ENG-035 automatic public-profile sync. The one outbound switch that
     *  defaults OFF: publishing is opt-in under decision `0029`, and turning
     *  it on IS the consent act. */
    autoPublish: boolean;
    /** Immutable first-consent boundary. */
    startedAt?: string;
    /** Cached hosted truth for an honest status surface across relaunches. */
    lastSyncedAt?: string;
    profileEnabled?: boolean;
    /** BUG-164 publication cursor: the last operator-local date a successful
     *  publication covered, and the Run derivation the hosted history
     *  reflects. Absent or stale means republish since consent. */
    publishedThrough?: string;
    publishedDerivation?: number;
    /** The last failed sync, until a sync succeeds. */
    lastFailure?: OperatorStatsSyncFailureRecord;
  };
  agentSources?: {
    projectLastUsed: Record<string, string>;
    sourceRecency: Record<string, number>;
    projectPermissionModes: Record<string, Record<string, AgentPermissionMode>>;
  };
  launchConfigurations?: LaunchConfigurationPoolV1;
  appearance?: AppearancePreferencesV1<ThemeId>;
  /**
   * Per-device keyboard overrides (BUG-044). Absent means this device has
   * never stored a choice, which is not the same as storing none.
   */
  keyboardShortcuts?: KeyboardShortcutOverridesV1;
}

/** What `settings:record-operator-profile-state` may write. */
export interface OperatorProfileStateUpdate {
  startedAt?: string;
  lastSyncedAt?: string;
  profileEnabled?: boolean;
}
