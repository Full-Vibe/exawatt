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
 */
export type SafetyControlId = 'processKillGuard';

export interface SafetyControl {
  id: SafetyControlId;
  label: string;
  /** What it stops, in the operator's words. */
  purpose: string;
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
    label: 'Block broad process kills',
    purpose:
      'Stops a pkill, killall or kill that would also end other apps, system processes, other agents or Exawatt itself. The agent is told what it would have hit and how to stop only what it started.',
    appliesTo: 'Claude Code agents started in Exawatt',
    enforcedBy: 'Claude Code, before the command runs',
    takesEffect: 'Agents started or resumed after it is turned on',
  },
];

/** The operator's choices. An absent control is off. */
export type SafetyControlSettings = Partial<Record<SafetyControlId, boolean>>;

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
