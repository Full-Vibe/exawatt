/**
 * Permissions (ENG-045): the grants Exawatt's happy paths consult before they
 * do something that needs the user's say-so.
 *
 * Every grant is declared here once, and both processes read it: Electron main
 * reads each one's status and raises each one's system prompt, and Settings
 * renders a row for each declaration and for nothing else. The registry
 * declares and explains a grant and names who enforces it; it enforces
 * nothing itself, and it adds no second enforcement regime to the Policy canon
 * (`docs/product/concepts.md`). macOS enforces `kind: 'os'` grants. A future
 * `kind: 'in-app'` grant names the Exawatt system that enforces it.
 *
 * The pattern is Apple's (HIG, "Accessing private data"): read the status
 * without prompting, show a first-party primer with one button that leads into
 * the system dialog, then make the call that raises it. No app can intercept
 * the system dialog itself.
 *
 * Shaped like `SAFETY_CONTROLS` (`./safety-controls.ts`) and
 * `OUTBOUND_CONTROLS` (`src/lib/hosted-features/contract.ts`).
 */
export type PermissionId = 'notifications';

export type PermissionKind = 'os' | 'in-app';

/**
 * Where a grant stands. `unknown` is its own answer: a status that could not
 * be read says nothing about whether the grant was given, so no surface may
 * show it as `denied`, and no code may act on it as if it were.
 */
export type PermissionState =
  | 'unknown'
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'needs-relaunch';

export interface PermissionDeclaration {
  id: PermissionId;
  kind: PermissionKind;
  /** The row's name in Settings and the subject of the primer. */
  label: string;
  /** One sentence: what the grant is for, in the user's words. */
  why: string;
  /** The first-party primer shown before the system prompt. */
  primer: {
    title: string;
    /** What Exawatt does once it is allowed. */
    will: string;
    /** What Exawatt keeps to, stated as what it does rather than what the
     *  user cannot do. */
    wont: string;
  };
  /** The system that enforces the grant. */
  enforcedBy: string;
  /** Where the user changes it by hand, as a person would say it. */
  settingsPath: string;
  /**
   * A deep link to the grant's own pane. Apple does not support these URLs, so
   * a caller that cannot open it opens System Settings generally.
   */
  settingsLink?: string;
  /** True when a grant only takes effect after Exawatt restarts. */
  needsRelaunch: boolean;
}

export const PERMISSIONS: readonly PermissionDeclaration[] = [
  {
    id: 'notifications',
    kind: 'os',
    label: 'Notifications',
    why: 'Tells you when an agent needs you while Exawatt is in the background.',
    primer: {
      title: 'Hear from your agents in the background',
      will: 'Each notification names the Session, and clicking it takes you straight there.',
      wont: 'Exawatt only ever notifies you about your own agents.',
    },
    enforcedBy: 'macOS',
    settingsPath: 'System Settings > Notifications > Exawatt',
    settingsLink:
      'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
    needsRelaunch: false,
  },
];

export function isPermissionId(value: unknown): value is PermissionId {
  return PERMISSIONS.some(permission => permission.id === value);
}

export function permissionDeclaration(id: PermissionId): PermissionDeclaration {
  const declaration = PERMISSIONS.find(permission => permission.id === id);
  if (!declaration) throw new Error(`Undeclared permission: ${id}`);
  return declaration;
}

/** One grant's state as the renderer sees it: read-only, never enforced. */
interface PermissionStatus {
  id: PermissionId;
  state: PermissionState;
  /** When the state was last read, in epoch ms; null when it never was. */
  checkedAt: number | null;
}

export type PermissionsSnapshot = readonly PermissionStatus[];

/**
 * One attempt to read a grant's status. A read that failed is not a read of
 * "denied": it carries no state at all, and `stateFromRead` turns it into
 * `unknown`.
 */
export type PermissionRead =
  | { ok: true; state: PermissionState }
  | { ok: false };

export function stateFromRead(read: PermissionRead): PermissionState {
  return read.ok ? read.state : 'unknown';
}

/** What a caller that needs a grant asks main for. */
export interface PermissionEnsureRequest {
  /**
   * One sentence on why the caller needs it right now, shown under the
   * primer's own explanation. Written for the user.
   */
  reason: string;
  /** The user pressed Continue on the primer. Only this raises the system
   *  prompt: without it, `ensure` answers `primer` and raises nothing. */
  primed?: boolean;
}

/**
 * What `ensure` tells the caller to do next:
 * - `ready`: the grant is given, go ahead.
 * - `primer`: show the first-party primer, then ask again with `primed`.
 * - `requested`: the system prompt is up; the answer arrives as a state change.
 * - `settings`: only System Settings can change it now.
 * - `relaunch`: given, and it takes effect when Exawatt restarts.
 */
type PermissionEnsureOutcome =
  | 'ready'
  | 'primer'
  | 'requested'
  | 'settings'
  | 'relaunch';

export interface PermissionEnsureResult {
  id: PermissionId;
  state: PermissionState;
  outcome: PermissionEnsureOutcome;
}

/** A caller's reason, announced by main when a moment of need arises while no
 *  window is in the user's hands (a notification the app would have posted). */
export interface PermissionPrimerRequest {
  id: PermissionId;
  reason: string;
}

/**
 * The state machine `ensure` runs, as one pure function so main, tests and the
 * renderer agree on it. `unknown` is treated like `not-determined` for the
 * purpose of asking (a primer and the one-time system prompt are harmless when
 * the grant already exists, because macOS does not re-ask), and never like
 * `denied`.
 */
export function ensureOutcome(
  state: PermissionState,
  primed: boolean
): Exclude<PermissionEnsureOutcome, 'requested'> | 'request' {
  switch (state) {
    case 'granted':
      return 'ready';
    case 'needs-relaunch':
      return 'relaunch';
    case 'denied':
    case 'restricted':
      return 'settings';
    case 'not-determined':
    case 'unknown':
      return primed ? 'request' : 'primer';
  }
}

/** How each state reads in Settings. */
export const PERMISSION_STATE_LABELS: Record<PermissionState, string> = {
  granted: 'Allowed',
  'not-determined': 'Not asked yet',
  denied: 'Off in macOS',
  restricted: 'Managed by your organization',
  'needs-relaunch': 'Restart Exawatt to finish',
  unknown: 'Status unavailable',
};

/** The action a state offers, or null when there is nothing to do here. */
type PermissionAction = 'allow' | 'open-settings';

export function permissionAction(
  state: PermissionState
): PermissionAction | null {
  switch (state) {
    case 'not-determined':
    case 'unknown':
      return 'allow';
    case 'denied':
      return 'open-settings';
    case 'restricted':
    case 'granted':
    case 'needs-relaunch':
      return null;
  }
}
