// The answers every fixture harness owes the product, in ONE place, and the
// ONE way an eval makes a fake harness: `writeFakeHarness`.
//
// A fake CLI in an eval is a stand-in for a harness, and the product
// interrogates a harness before it will launch one: which version are you, are
// you signed in, and which models do you publish. Every eval used to hand-roll
// those answers inside its own heredoc, so every one drifted separately from
// what the product actually asks:
//
//   - a fixture that never exits on `--version` leaves the Agent Source
//     registry's probe hanging. Since the readiness fact model (2026-09-13)
//     that reads as `unobserved`, the row paints from memory or as unchecked
//     and Start stays live, so the eval no longer stalls on it; but the probe
//     still burns its whole deadline and leaks one process per run (observed
//     accumulating and degrading later runs). `eval:electron:resume` hung on
//     exactly this (BUG-217): its hand-rolled `claude` never answered.
//   - a fixture Codex answering `codex debug models` with silence publishes NO
//     model. Since D49 an engine without a model may not start at all — the
//     product refusing correctly, which read as an eval defect for two months
//     (BUG-014).
//
// So the probe QUESTIONS live here, per harness, and an eval may choose only
// the ANSWERS and its fixture's behaviour after launch. When the product starts
// asking harnesses a new question, `PROBES` below is the one place that has to
// learn it. Every file this writes carries `FAKE_HARNESS_MARKER`, and
// `withElectronApp` refuses to launch against a harness-named executable in a
// fixture bin that does not (`assertFixtureHarnesses`); the boundary test in
// `scripts/eval-boundaries.test.mjs` refuses a hand-rolled probe answer.

import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const FIXTURE_CLAUDE_VERSION = '9.9.9-fixture (Claude Code)';
export const FIXTURE_CODEX_VERSION = 'codex-cli 9.9.9-fixture';

/** The SHAPE `parseClaudeAuthStatus` actually parses. An unparseable answer
 *  reads as an unanswered authentication probe (`unknown`); a parseable
 *  `loggedIn:false` reads as a sign-in notice that informs but never blocks
 *  (incident 0021). Either way the fixture should answer the real shape so
 *  the eval exercises a `ready` source. */
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

const FIXTURE_OPENCODE_VERSION = '1.3.4';
const FIXTURE_GROK_VERSION = 'grok 1.0.3 (evalbuild)';
const FIXTURE_QWEN_VERSION = '0.24.4';
const FIXTURE_ANTIGRAVITY_VERSION = '1.2.17';
const FIXTURE_OPENCLAW_VERSION = 'OpenClaw 2026.8.0-eval';

/** The first line after the shebang of every fake harness this module writes.
 *  `assertFixtureHarnesses` reads it back; nothing else may write it. */
const FAKE_HARNESS_MARKER = 'exawatt-fake-harness';

/**
 * The questions the product asks each harness before, or instead of, a
 * launch, with the fixture's default answer to each. Keys are the answer
 * names an eval may override; `argv` is the leading arguments that identify
 * the question. Answers:
 *
 *   - a string, or an array of lines: printed, then exit 0;
 *   - `''`: exit 0 and print nothing (Codex's `app-server` handshake, which a
 *     fixture that is not a protocol server must decline, not block on);
 *   - `null`: exit 1, the question asked and refused (a signed-out source);
 *   - `false`: not answered here, because the fixture's own launch behaviour
 *     implements that question (the Codex protocol fixture's `app-server`).
 *
 * `raw` prints without a trailing newline.
 */
const PROBES = Object.freeze({
  claude: {
    version: { argv: ['--version'], answer: FIXTURE_CLAUDE_VERSION },
    authStatus: { argv: ['auth', 'status'], answer: FIXTURE_CLAUDE_AUTH_JSON },
    catalog: { argv: ['--safe-mode'], answer: FIXTURE_CLAUDE_CATALOG_JSON },
    context: { argv: ['-p'], answer: 'fixture context', raw: true },
  },
  codex: {
    version: { argv: ['--version'], answer: FIXTURE_CODEX_VERSION },
    loginStatus: {
      argv: ['login', 'status'],
      answer: 'Logged in as fixture@example.com',
    },
    catalog: { argv: ['debug', 'models'], answer: FIXTURE_CODEX_CATALOG_JSON },
    appServer: { argv: ['app-server'], answer: '' },
  },
  opencode: {
    version: { argv: ['--version'], answer: FIXTURE_OPENCODE_VERSION },
    authList: {
      argv: ['auth', 'list'],
      answer: [
        '┌  Credentials',
        '│',
        '●  Fixture Provider api',
        '│',
        '└  1 credential',
      ],
    },
    models: {
      argv: ['models', '--verbose'],
      answer: [
        'fixture/fixture-model',
        '{',
        '  "id": "fixture-model",',
        '  "providerID": "fixture",',
        '  "name": "Fixture Open Model",',
        '  "family": "fixture",',
        '  "variants": {"low": {}, "high": {}}',
        '}',
      ],
    },
  },
  grok: {
    version: { argv: ['--version'], answer: FIXTURE_GROK_VERSION },
    models: {
      argv: ['models'],
      answer: [
        'You are logged in with grok.com.',
        '',
        'Default model: fixture-grok',
        '',
        'Available models:',
        '  * fixture-grok (default)',
      ],
    },
  },
  qwen: {
    version: { argv: ['--version'], answer: FIXTURE_QWEN_VERSION },
  },
  // Antigravity's binary is `agy`; the product resolves the fixture by that
  // name for its probes and by the harness name for a launch, so an eval
  // writes this fixture once and copies it to both names.
  antigravity: {
    version: { argv: ['--version'], answer: FIXTURE_ANTIGRAVITY_VERSION },
    models: {
      argv: ['models'],
      answer: [
        'Fetching available models...',
        'fixture-flash-medium\tFixture Flash (Medium)',
        'fixture-sonnet\tFixture Sonnet (Thinking)',
      ],
    },
  },
  openclaw: {
    version: { argv: ['--version'], answer: FIXTURE_OPENCLAW_VERSION },
  },
});

/** Every harness a fixture can stand in for. The boundary test holds this to
 *  every local CLI in `contracts/agent-sources.json`. */
export const FAKE_HARNESSES = Object.freeze(Object.keys(PROBES));

/** A harness whose binary is not named after it. The product resolves every
 *  source by its binary (`harnessDescriptor(...).source.executable`), so the
 *  fixture is written under that name. */
const EXECUTABLES = Object.freeze({ antigravity: 'agy' });

/** The file name a fake `harness` is written as. */
function fakeHarnessExecutable(harness) {
  return EXECUTABLES[harness] ?? harness;
}

const HARNESS_BY_EXECUTABLE = new Map(
  FAKE_HARNESSES.map(harness => [fakeHarnessExecutable(harness), harness])
);

const shQuote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;

function resolvedProbes(harness, answers) {
  const questions = PROBES[harness];
  if (!questions) {
    throw new Error(
      `No fixture probes for harness "${harness}". Teach PROBES in ` +
        'scripts/lib/harness-probe-fixture.mjs what the product asks it.'
    );
  }
  for (const key of Object.keys(answers)) {
    if (!Object.hasOwn(questions, key)) {
      throw new Error(
        `The product asks ${harness} no "${key}" question; it asks: ` +
          Object.keys(questions).join(', ')
      );
    }
  }
  return Object.entries(questions)
    .map(([key, probe]) => ({
      ...probe,
      answer: Object.hasOwn(answers, key) ? answers[key] : probe.answer,
    }))
    .filter(probe => probe.answer !== false);
}

function probeSh({ argv, answer, raw }) {
  const condition = argv
    .map((arg, index) => `[ "$${index + 1}" = ${shQuote(arg)} ]`)
    .join(' && ');
  if (answer === null) return `if ${condition}; then exit 1; fi`;
  const lines = Array.isArray(answer) ? answer : [answer];
  const print =
    lines.length === 1 && lines[0] === ''
      ? ''
      : raw
        ? `printf '%s' ${lines.map(shQuote).join(' ')}; `
        : `printf '%s\\n' ${lines.map(shQuote).join(' ')}; `;
  return `if ${condition}; then ${print}exit 0; fi`;
}

function probeJs({ argv, answer, raw }) {
  const condition = argv
    .map((arg, index) => `probeArgv[${index}] === ${JSON.stringify(arg)}`)
    .join(' && ');
  if (answer === null) return `  if (${condition}) process.exit(1);`;
  const lines = Array.isArray(answer) ? answer : [answer];
  const text =
    lines.length === 1 && lines[0] === ''
      ? ''
      : raw
        ? lines.join('')
        : `${lines.join('\n')}\n`;
  // `writeSync` on fd 1, not `process.stdout.write`: stdout to a pipe is
  // asynchronous on macOS, so a write followed by `process.exit` can reach the
  // product as an empty answer.
  return [
    `  if (${condition}) {`,
    ...(text
      ? [`    require('node:fs').writeSync(1, ${JSON.stringify(text)});`]
      : []),
    `    process.exit(0);`,
    `  }`,
  ].join('\n');
}

/**
 * Write a fake `harness` executable into `bin` and return its path. The file
 * answers every question the product asks that harness (`PROBES`), from the
 * fixture's defaults or the eval's `answers`, and only then runs `launch`,
 * the fixture's own behaviour: POSIX sh by default, Node with
 * `runtime: 'node'`.
 *
 * Point the product at `bin` with `EXAWATT_TEST_HARNESS_BIN`, which resolves
 * every source from that directory and nothing else, so an operator's real
 * CLIs are never probed and a harness the eval did not write reads as absent.
 */
export function writeFakeHarness(
  bin,
  harness,
  { answers = {}, launch, runtime = 'sh' } = {}
) {
  const probes = resolvedProbes(harness, answers);
  // With no behaviour of its own, a fixture refuses a launch rather than
  // pretending to be a Session.
  const behaviour =
    launch ?? (runtime === 'node' ? 'process.exit(1);' : 'exit 1');
  let source;
  if (runtime === 'sh') {
    source = [
      '#!/bin/sh',
      `# ${FAKE_HARNESS_MARKER} ${harness}`,
      ...probes.map(probeSh),
      behaviour,
      '',
    ].join('\n');
  } else if (runtime === 'node') {
    source = [
      '#!/usr/bin/env node',
      `// ${FAKE_HARNESS_MARKER} ${harness}`,
      '{',
      '  const probeArgv = process.argv.slice(2);',
      ...probes.map(probeJs),
      '}',
      behaviour,
      '',
    ].join('\n');
  } else {
    throw new Error(`Unknown fake harness runtime "${runtime}"`);
  }
  const executable = join(bin, fakeHarnessExecutable(harness));
  writeFileSync(executable, source);
  chmodSync(executable, 0o755);
  return executable;
}

/**
 * Refuse a launch whose fixture bin carries a harness this module did not
 * write. `withElectronApp` calls it with the launch environment, so every eval
 * is held to it: the bin `EXAWATT_TEST_HARNESS_BIN` names, and every PATH entry
 * inside the temp directory (where `eval:electron:resume` used to put its
 * hand-rolled `claude`). An operator's own CLIs outside the temp directory
 * are never inspected.
 */
export function assertFixtureHarnesses(env = {}) {
  const temp = resolve(tmpdir());
  const directories = new Set();
  if (env.EXAWATT_TEST_HARNESS_BIN) {
    directories.add(resolve(env.EXAWATT_TEST_HARNESS_BIN));
  }
  for (const entry of String(env.PATH ?? '').split(':')) {
    if (entry && resolve(entry).startsWith(`${temp}/`)) {
      directories.add(resolve(entry));
    }
  }
  for (const directory of directories) {
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      const harness = HARNESS_BY_EXECUTABLE.get(name);
      if (!harness) continue;
      const head = readFileSync(join(directory, name), 'utf8').slice(0, 256);
      if (!head.split('\n')[1]?.includes(`${FAKE_HARNESS_MARKER} ${harness}`)) {
        throw new Error(
          `${join(directory, name)} is a fake ${name} that writeFakeHarness ` +
            'did not write, so nothing guarantees it answers the questions the ' +
            'product asks before a launch. Make it with writeFakeHarness from ' +
            'scripts/lib/harness-probe-fixture.mjs.'
        );
      }
    }
  }
}
