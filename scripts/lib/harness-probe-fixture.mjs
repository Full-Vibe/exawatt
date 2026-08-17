// The answers every fixture harness owes the product, in ONE place.
//
// A fake CLI in an eval is a stand-in for a harness, and the product
// interrogates a harness before it will launch one: which version are you, are
// you signed in, and which models do you publish. Every eval used to hand-roll
// those answers inside its own heredoc, so every one drifted separately from
// what the product actually asks:
//
//   - a fixture that never exits on `--version` leaves the Agent Source
//     registry's probe hanging, so the source never becomes launchable, Start
//     stays disabled, and nothing on screen names why. It also leaks one
//     process per run (observed accumulating and degrading later runs).
//   - a fixture Codex answering `codex debug models` with silence publishes NO
//     model. Since D49 an engine without a model may not start at all — the
//     product refusing correctly, which read as an eval defect for two months
//     (BUG-014).
//
// So the probe answers live here, and a fixture CLI is only its own BEHAVIOUR
// after launch. When the product starts asking harnesses a new question, this
// file is the one place that has to learn the answer.
//
// Two emitters because the fixtures are written in two languages: `…Sh` for
// the `#!/bin/sh` fixtures, `…Js` for the `#!/usr/bin/env node` ones. Both
// answer the same questions from the same constants.

export const FIXTURE_CLAUDE_VERSION = '9.9.9-fixture (Claude Code)';
export const FIXTURE_CODEX_VERSION = 'codex-cli 9.9.9-fixture';

/** The SHAPE `parseClaudeAuthStatus` actually parses. Source truth fails
 *  closed, so an unparseable answer reads as "not signed in", the source goes
 *  degraded, and Start stays disabled forever with nothing naming the cause. */
export const FIXTURE_CLAUDE_AUTH_JSON = JSON.stringify({
  loggedIn: true,
  email: 'fixture@example.com',
  subscriptionType: 'max',
  authMethod: 'oauth',
});

export const FIXTURE_CODEX_MODEL_ID = 'fixture-codex-sol';
export const FIXTURE_CODEX_MODEL_LABEL = 'Fixture Codex Sol';

export const FIXTURE_CLAUDE_MODEL_ID = 'fixture-claude-sol';
export const FIXTURE_CLAUDE_MODEL_LABEL = 'Fixture Claude Sol';

/**
 * The SDK `initialize` control response Claude Code's catalog probe reads
 * (`readClaudeModelOptions` → `parseClaudeModelCatalog`), which the product
 * asks for as `claude --safe-mode --input-format stream-json … -p`.
 *
 * A fixture that does not answer it is not merely silent: `--safe-mode` is
 * `$1`, so the invocation falls straight through into the fixture's LAUNCH
 * behaviour, blocks on stdin, and lives until the product's 20s deadline kills
 * it. That is one leaked process per catalog read — the same failure the
 * `--version` note above describes, one probe further in, and it is what made
 * `eval:electron:lifecycle` report five dead processes after a CANCELLED quit
 * had left every Session running (BUG-041's landing).
 */
export const FIXTURE_CLAUDE_CATALOG_JSON = JSON.stringify({
  type: 'control_response',
  response: {
    subtype: 'success',
    request_id: 'exawatt-model-catalog',
    response: {
      models: [
        {
          value: 'default',
          displayName: 'Account default',
          description: 'Claude Code chooses the recommended model.',
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high'],
        },
        {
          value: FIXTURE_CLAUDE_MODEL_ID,
          displayName: FIXTURE_CLAUDE_MODEL_LABEL,
          description: 'Fixture model published by the eval Claude CLI.',
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high'],
        },
      ],
    },
  },
});

/** One model with three efforts: enough for the catalog to be LIVE and for
 *  effort selection to have something to select, without pretending to be a
 *  vendor catalog. Shape is `codex debug models`, parsed by
 *  `parseCodexModelCatalog`. */
export const FIXTURE_CODEX_CATALOG_JSON = JSON.stringify({
  models: [
    {
      slug: FIXTURE_CODEX_MODEL_ID,
      display_name: FIXTURE_CODEX_MODEL_LABEL,
      description: 'Fixture model published by the eval Codex CLI.',
      visibility: 'list',
      priority: 1,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low', description: 'Fast fixture reasoning.' },
        { effort: 'medium', description: 'Balanced fixture reasoning.' },
        { effort: 'high', description: 'Deep fixture reasoning.' },
      ],
    },
  ],
});

/** POSIX-sh probe answers for a fake `claude`. Place at the TOP of the
 *  fixture, before any launch behaviour. */
export function claudeProbeSh() {
  return [
    `if [ "$1" = "--version" ]; then printf '${FIXTURE_CLAUDE_VERSION}\\n'; exit 0; fi`,
    `if [ "$1" = "auth" ]; then printf '%s\\n' '${FIXTURE_CLAUDE_AUTH_JSON}'; exit 0; fi`,
    `if [ "$1" = "--safe-mode" ]; then printf '%s\\n' '${FIXTURE_CLAUDE_CATALOG_JSON}'; exit 0; fi`,
    `if [ "$1" = "-p" ]; then printf 'fixture context'; exit 0; fi`,
  ].join('\n');
}

/** POSIX-sh probe answers for a fake `codex`. */
export function codexProbeSh() {
  return [
    `if [ "$1" = "--version" ]; then printf '${FIXTURE_CODEX_VERSION}\\n'; exit 0; fi`,
    `if [ "$1" = "login" ]; then printf 'Logged in as fixture@example.com\\n'; exit 0; fi`,
    `if [ "$1" = "debug" ] && [ "$2" = "models" ]; then printf '%s\\n' '${FIXTURE_CODEX_CATALOG_JSON}'; exit 0; fi`,
    // `codex app-server --stdio` is a SERVER handshake, not a launch. A
    // fixture that is not one has to decline and exit; falling through means
    // it blocks on stdin as if it were a Session and leaks a process.
    `if [ "$1" = "app-server" ]; then exit 0; fi`,
  ].join('\n');
}

/** Node probe answers for a fake `claude`. */
export function claudeProbeJs() {
  return [
    `{`,
    `  const probeArgv = process.argv.slice(2);`,
    `  if (probeArgv.includes('--version')) {`,
    `    process.stdout.write(${JSON.stringify(`${FIXTURE_CLAUDE_VERSION}\n`)});`,
    `    process.exit(0);`,
    `  }`,
    `  if (probeArgv[0] === 'auth') {`,
    `    process.stdout.write(${JSON.stringify(`${FIXTURE_CLAUDE_AUTH_JSON}\n`)});`,
    `    process.exit(0);`,
    `  }`,
    `  if (probeArgv[0] === '--safe-mode') {`,
    `    process.stdout.write(${JSON.stringify(`${FIXTURE_CLAUDE_CATALOG_JSON}\n`)});`,
    `    process.exit(0);`,
    `  }`,
    `  if (probeArgv.includes('-p')) process.exit(0);`,
    `}`,
  ].join('\n');
}

/** Node probe answers for a fake `codex`. */
export function codexProbeJs() {
  return [
    `{`,
    `  const probeArgv = process.argv.slice(2);`,
    `  if (probeArgv.includes('--version')) {`,
    `    process.stdout.write(${JSON.stringify(`${FIXTURE_CODEX_VERSION}\n`)});`,
    `    process.exit(0);`,
    `  }`,
    `  if (probeArgv[0] === 'login') {`,
    `    process.stdout.write('Logged in as fixture@example.com\\n');`,
    `    process.exit(0);`,
    `  }`,
    `  if (probeArgv[0] === 'debug' && probeArgv[1] === 'models') {`,
    `    process.stdout.write(${JSON.stringify(`${FIXTURE_CODEX_CATALOG_JSON}\n`)});`,
    `    process.exit(0);`,
    `  }`,
    `  if (probeArgv[0] === 'app-server') process.exit(0);`,
    `}`,
  ].join('\n');
}
