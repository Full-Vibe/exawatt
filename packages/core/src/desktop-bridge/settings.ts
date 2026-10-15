import type { DeviceKeepAwakePolicy } from './app';
import type { AgentPermissionMode } from '../agent-sources';
import type { LaunchConfigurationPoolV1 } from '../launch-configurations';
import type { OperatorStatsSyncFailureRecord } from '../operator-stats/sync-state';
import type { KeyboardShortcutOverridesV1 } from '../shortcuts/keyboard-overrides';
import type { SafetyControlSettings } from '../safety-controls';

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
  /** This device's Exawatt-owned assertion policy; absent defaults to AC only. */
  power?: { keepAwake: DeviceKeepAwakePolicy };

  terminal?: TerminalFontSettings;
  notifications?: {
    attention: boolean;
    /** macOS dock badge count + bounce for needs-you attention (D18):
     *  default off; ambient OS-level signals are opt-in. */
    dockBadge?: boolean;
    /** ENG-008 E17: a notification when a plan window goes on course to run
     *  out before its reset. Absent means ON (the operator's pick). */
    usageAlerts?: boolean;
    /** Minutes before the projected run-out for a second alert; null turns
     *  it off; absent means `USAGE_ALERT_POLICY.defaultLeadMinutes`. */
    usageAlertLeadMinutes?: number | null;
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
  codexPlanWindows?: {
    /** ENG-038 slice 2: the account's windows, credits and banked resets,
     *  asked of the operator's own `codex` app-server under its own sign-in.
     *  Defaults on; off starts no app-server and serves no account read. */
    enabled: boolean;
  };
  googlePlanWindows?: {
    /** ENG-038 slice 4: the Google account's weekly limits per model group,
     *  asked of the operator's own `agy` (`/usage`) under its own sign-in.
     *  Defaults on; off starts no process and serves no account read. */
    enabled: boolean;
  };
  /** ENG-044 safety controls, declared in `SAFETY_CONTROLS`. Every control
   *  defaults OFF: only an explicit true applies a limit to an agent. */
  safety?: SafetyControlSettings;
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
  presentation?: PresentationPreferencesV1;
  /**
   * Per-device keyboard overrides (BUG-044). Absent means this device has
   * never stored a choice, which is not the same as storing none.
   */
  keyboardShortcuts?: KeyboardShortcutOverridesV1;
  /**
   * Product analytics on this device (BUG-171): the runtime opt-out and the
   * anonymous installation id, held by main so a launch that serves from a
   * fallback port neither forgets the opt-out nor mints a new id. Absent
   * means analytics have never asked; it never means opted out.
   */
  analytics?: AnalyticsDeviceRecord;
}

/** BUG-171: main's record of this device's product analytics identity. */
export interface AnalyticsDeviceRecord {
  /** Decision `0031`'s runtime opt-out. */
  optedOut: boolean;
  /** Anonymous, generated on this device, held only while opted in. */
  installationId?: string;
}

/**
 * What the renderer learns about analytics identity. `unavailable` is a read
 * that failed (the settings file is unreadable or a new id could not be
 * kept), which is never the same answer as "opted in with no id yet": the
 * renderer starts no analytics for that launch.
 */
export type AnalyticsIdentityRead =
  | { status: 'ready'; optedOut: boolean; installationId: string | null }
  | { status: 'unavailable' };

/**
 * The renderer-origin values a desktop install kept before BUG-171, offered
 * once so main can adopt them. Untrusted input: main validates both.
 */
export interface AnalyticsLegacyIdentity {
  optedOut: boolean;
  installationId: string | null;
}

export interface AnalyticsIdentityRequest {
  legacy: AnalyticsLegacyIdentity | null;
  /** Mint an id when none is held. Only a starting analytics client asks;
   *  reading the switch's state must not create identity. */
  ensureId: boolean;
}

const ANALYTICS_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An anonymous analytics id is a lowercase UUID, and nothing else. */
export function isAnalyticsId(value: unknown): value is string {
  return typeof value === 'string' && ANALYTICS_ID_PATTERN.test(value);
}

/** Total over `unknown`: a record without an explicit opt-out is absent. */
export function parseAnalyticsDeviceRecord(
  raw: unknown
): AnalyticsDeviceRecord | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.optedOut !== 'boolean') return undefined;
  const record: AnalyticsDeviceRecord = { optedOut: candidate.optedOut };
  if (!candidate.optedOut && isAnalyticsId(candidate.installationId)) {
    record.installationId = candidate.installationId;
  }
  return record;
}

/** What `settings:record-operator-profile-state` may write. */
export interface OperatorProfileStateUpdate {
  startedAt?: string;
  lastSyncedAt?: string;
  profileEnabled?: boolean;
}

/** Device-local presentation choices are independent of theme and data source. */
export type FleetView = 'v1' | 'v2';
/** Pure material catalog shared by Settings and the renderer; no Three import. */
export const FLEET_MATERIALS = [
  { id: 'matte', name: 'Matte', note: 'Soft painted ceramic.' },
  { id: 'glazed', name: 'Glazed', note: 'Glossy ceramic with a clear glaze.' },
  {
    id: 'gummy',
    name: 'Gummy',
    note: 'Soft translucent color and rounded edges.',
  },
  {
    id: 'acrylic',
    name: 'Acrylic',
    note: 'Satin colored slabs on frosted ground.',
  },
  {
    id: 'anodized',
    name: 'Anodized',
    note: 'Brushed metal with an inlaid status light.',
  },
] as const;
export type FleetMaterial = (typeof FLEET_MATERIALS)[number]['id'];
export interface PresentationPreferencesV1 {
  schemaVersion: 1;
  fleetView?: FleetView;
  fleetMaterial?: FleetMaterial;
}

/** Unknown versions and malformed records are absent, never a store failure. */
export function parsePresentationPreferences(
  raw: unknown
): PresentationPreferencesV1 | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return undefined;
  if (
    candidate.fleetView !== undefined &&
    candidate.fleetView !== 'v1' &&
    candidate.fleetView !== 'v2'
  )
    return undefined;
  const material = FLEET_MATERIALS.find(
    item => item.id === candidate.fleetMaterial
  );
  if (candidate.fleetMaterial !== undefined && !material) return undefined;
  return {
    schemaVersion: 1,
    ...(candidate.fleetView === undefined
      ? {}
      : { fleetView: candidate.fleetView }),
    ...(material ? { fleetMaterial: material.id } : {}),
  };
}
