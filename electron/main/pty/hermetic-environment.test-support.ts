import { LOGIN_ENVIRONMENT_KEYS } from './harness-state-variables';

/**
 * The variables an app-node test must not inherit from the operator
 * (BUG-298): those that point a shell at other startup files, and every
 * variable the login-environment resolver reads. The second half is the
 * product's own declaration (`LOGIN_ENVIRONMENT_KEYS`), so a harness
 * variable the product starts resolving is cleared in the same edit.
 */
const SHELL_STARTUP_VARIABLES = [
  'ZDOTDIR',
  'ENV',
  'BASH_ENV',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
] as const;

export const HERMETIC_VARIABLES: readonly string[] = [
  ...new Set([...SHELL_STARTUP_VARIABLES, ...LOGIN_ENVIRONMENT_KEYS]),
];

/**
 * The variables an Exawatt Session gives every process it starts: the bus
 * port and token and the Session id (`bus-ipc.ts`). Agents run this suite
 * inside a Session and CI does not, so a test that read them passed in one
 * and failed in the other (`session-launch-environment.test.ts` saw the
 * agent's own bus port, 2026-10-21).
 */
const SESSION_VARIABLE = /^EXAWATT_(?:BUS|SESSION)_/u;

/** The hermetic variables `env` holds now, a Session's included. */
export function hermeticKeys(env: NodeJS.ProcessEnv): string[] {
  return [
    ...new Set([
      ...HERMETIC_VARIABLES,
      ...Object.keys(env).filter(key => SESSION_VARIABLE.test(key)),
    ]),
  ];
}

/** Clear every hermetic variable in `env` and give it `home`. */
export function makeHermetic(env: NodeJS.ProcessEnv, home: string): void {
  for (const key of hermeticKeys(env)) delete env[key];
  env.HOME = home;
}
