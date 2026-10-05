/**
 * Safety controls (ENG-044): limits the operator sets on what the agents
 * Exawatt starts may do.
 *
 * Every control is declared here once, and both processes read it: Electron
 * main enforces a control only if it is declared, and Settings renders a row
 * for each declaration and for nothing else, so a control cannot exist without
 * its disclosure. Every control is off until the operator turns it on.
 *
 * A control is a Policy in the canon's sense (`docs/product/concepts.md`), and
 * the canon asks each limit to say which system enforces it. None of these
 * invents a second enforcement regime: each one runs inside its Agent Source's
 * own boundary (for Claude Code, a `PreToolUse` hook) and states that it does.
 *
 * A policy preview (`SAFETY_POLICY_PREVIEWS`) is a control that is shaped and
 * not built. It is declared beside the enforced controls so Settings shows
 * where it will live, and it is a different type on purpose: its id is not a
 * `SafetyControlId`, so it cannot be stored, written over IPC, or read by
 * enforcement, and it carries no `enforcedBy` or `takesEffect`, because
 * nothing enforces it and nothing takes effect.
 */
export type SafetyControlId = 'processKillGuard';

interface SafetyDeclaration {
  label: string;
  /** What it stops, in the operator's words. */
  purpose: string;
}

export interface SafetyControl extends SafetyDeclaration {
  id: SafetyControlId;
  enforcement: 'enforced';
  /** The agents it reaches today. */
  appliesTo: string;
  /** The system that stops the action. */
  enforcedBy: string;
  /** When turning it on reaches an agent. */
  takesEffect: string;
}

export const SAFETY_CONTROLS: readonly SafetyControl[] = [
  {
    id: 'processKillGuard',
    enforcement: 'enforced',
    label: 'Block broad process kills',
    purpose:
      'Stops a pkill, killall or kill that would also end other apps, system processes, other agents or Exawatt itself. The agent is told what it would have hit and how to stop only what it started.',
    appliesTo: 'Claude Code agents started in Exawatt',
    enforcedBy: 'Claude Code, before the command runs',
    takesEffect: 'Agents started or resumed after it is turned on',
  },
];

/** The next controls ENG-044 has shaped. None is built. */
export type SafetyPolicyPreviewId =
  | 'destructiveGitGuard'
  | 'credentialReadGuard'
  | 'networkEgressLimit'
  | 'allowedHarnessesAndModels';

interface SafetyPolicyPreview extends SafetyDeclaration {
  id: SafetyPolicyPreviewId;
  /** Nothing enforces a preview, so it has no enforcer and no switch. */
  enforcement: 'preview';
}

export const SAFETY_POLICY_PREVIEWS: readonly SafetyPolicyPreview[] = [
  {
    id: 'destructiveGitGuard',
    enforcement: 'preview',
    label: 'Block destructive git operations',
    purpose:
      'Stops a force push, a branch deletion or a history rewrite that would discard work.',
  },
  {
    id: 'credentialReadGuard',
    enforcement: 'preview',
    label: 'Block credential reads',
    purpose:
      'Stops reads of keychains, .env files, SSH keys and tokens the agent was not given.',
  },
  {
    id: 'networkEgressLimit',
    enforcement: 'preview',
    label: 'Limit network egress',
    purpose: 'Allows connections only to the hosts you list.',
  },
  {
    id: 'allowedHarnessesAndModels',
    enforcement: 'preview',
    label: 'Allow only listed harnesses and models',
    purpose: 'Starts agents only on the harnesses and models you list.',
  },
];

/** The operator's choices. An absent control is off. */
export type SafetyControlSettings = Partial<Record<SafetyControlId, boolean>>;

/**
 * One read of the operator's choices. `unreadable` is its own answer: a
 * settings file that could not be read says nothing about whether a control
 * is on, so no surface may show it as off.
 */
export type SafetyControlsRead =
  | { status: 'ready'; controls: SafetyControlSettings }
  | { status: 'unreadable' };

export function isSafetyControlId(value: unknown): value is SafetyControlId {
  return SAFETY_CONTROLS.some(control => control.id === value);
}

/** Off unless explicitly turned on: a safety limit is never applied silently. */
export function isSafetyControlEnabled(
  settings: SafetyControlSettings | undefined,
  id: SafetyControlId
): boolean {
  return settings?.[id] === true;
}
