export type WindowLaunchMode = 'foreground' | 'inactive' | 'hidden';

interface WindowLaunchModeInput {
  isDevelopment: boolean;
  isTest: boolean;
  override?: string;
}

const WINDOW_LAUNCH_MODES = new Set<WindowLaunchMode>([
  'foreground',
  'inactive',
  'hidden',
]);

/**
 * Production is always foreground-safe: a leaked development environment
 * variable must never make the installed app disappear. Development and test
 * launches may opt into another mode, while defaulting to non-activating
 * behavior so agent-driven checks cannot interrupt the operator.
 */
export function resolveWindowLaunchMode({
  isDevelopment,
  isTest,
  override,
}: WindowLaunchModeInput): WindowLaunchMode {
  if (!isDevelopment && !isTest) return 'foreground';

  if (override && WINDOW_LAUNCH_MODES.has(override as WindowLaunchMode)) {
    return override as WindowLaunchMode;
  }

  return isTest ? 'hidden' : 'inactive';
}
