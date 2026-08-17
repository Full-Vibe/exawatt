# Repository scripts

`package.json` is the stable command interface. Files in this directory are
implementation entrypoints, hooks, workers, diagnostics, and shared support;
callers should prefer `pnpm <command>` whenever a command exists.

The top level remains deliberately flat for single-file entrypoints. Moving the
existing inventory into cosmetic folders would churn package commands,
delivery policy, build configuration, workflows, and engineering evidence
without changing behavior. A script family earns a directory when it has
multiple cooperating files or fixtures, as `r3f-eval/` does.

## Find the right command

Run `pnpm run` for the complete command registry. Its namespaces carry the
operating contract:

| Prefix                                     | Purpose                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `agent:*`, `worktree:*`                    | isolated agent setup and queued delivery                  |
| `test:*`, `type-check`, `lint`             | repository verification                                   |
| `qa:*`                                     | browser-environment diagnosis and smoke checks            |
| `eval:*`                                   | bounded product or architecture evaluators                |
| `electron:*`                               | Electron development, compilation, packaging, and dogfood |
| `open-source:*`, `content:*`, `security:*` | publication and safety checks                             |
| `theme:*`, `icon:*`, `agent-sources:*`     | generated-source maintenance                              |
| `feedback:*`                               | product-feedback ingestion and triage                     |

An evaluator is not automatically a landing gate. Surface-to-gate ownership is
declared in `lib/delivery-policy.mjs`; adding a package command does not add it
to that policy.

## Layout contract

| Location or suffix                   | Contract                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `scripts/*.mjs`, `scripts/*.cjs`     | one-file entrypoints, build hooks, or workers                                     |
| `scripts/*-eval.mjs`                 | bounded evaluators; repeatable current evaluators use an `eval:*` package command |
| `scripts/*.test.mjs`                 | Node tests; every root test must be reachable through a package command           |
| `scripts/lib/`                       | importable shared implementation, not a public command surface                    |
| `scripts/r3f-eval/`                  | a cohesive multi-file evaluator with its own README                               |
| `.artifacts/`, temporary directories | generated reports and screenshots; never add report output beneath `scripts/`     |

`pnpm test:scripts-layout` enforces the mechanical part of this contract: all
script paths named by package commands must exist, every root Node test must be
package-backed, and every top-level file must be either package-backed or an
intentional exception below. New top-level directories must declare a cohesive
multi-file role.

## Intentional non-package entrypoints

Some files are invoked by a configuration or another process rather than by a
human-facing package command:

| File                                 | Owner / consumer                                          |
| ------------------------------------ | --------------------------------------------------------- |
| `agent-stop-check.mjs`               | `.codex/hooks.json` one-shot advisory                     |
| `app-update-config.cjs`              | release `afterPack` composition                           |
| `distribution.official.example.json` | placeholder-only official distribution test/build fixture |
| `ci-batch-worker.mjs`                | detached queue-drain hosted-CI dispatcher                 |
| `dogfood-worker.mjs`                 | detached dogfood queue worker                             |
| `macos-atomic-swap.c`                | native helper compiled by `lib/macos-atomic-swap.mjs`     |
| `open-source-paths.manifest.json`    | fail-closed publication path classifier                   |
| `prepare-release-metadata.mjs`       | macOS release workflow                                    |
| `production-audit-baseline.json`     | production dependency audit input                         |
| `publish-supabase-updates.mjs`       | macOS release workflow publisher                          |
| `release-after-pack.cjs`             | release Electron Builder hook                             |
| `sign-renderer-archive.cjs`          | dogfood Electron Builder hook                             |

The following are deliberately direct-use research, capture, or historical
diagnostic tools. They are not standing gates and should not be presented as
such without first revalidating their fixture and owner:

- `fathom-transcript.mjs`
- `pace-opportunity-shot.mjs`
- `palette-projects-eval.mjs`
- `registry-e2e-eval.mjs`
- `renderer-session-lifecycle-leak-probe.mjs`
- `session-lifecycle-leak-probe.mjs`
- `terminal-cost-probe.mjs`
- `transcript-replay-probe.mjs`

## Adding or changing a script

- Put a repeatable human- or automation-facing command in `package.json` and
  keep that command name stable when implementation paths later move.
- Name product evaluators `*-eval.mjs` and document prerequisites at the top of
  the file. Electron/browser evaluators must use the repository harness and the
  worktree's own `EXA_BASE`.
- Put reusable logic in `lib/`; keep entrypoints focused on orchestration and
  reporting.
- Give a genuinely multi-file family its own directory and README. Do not
  create a directory for one script merely to reduce the root file count.
- Write output to an ignored artifact or temporary directory, never beside the
  implementation.
- Update package commands, external consumers, the open-source path manifest,
  documentation references, and `script-layout.test.mjs` together when a path
  changes.

Physical reorganization should preserve package command names and happen only
when substantive work already needs to change a coherent family. That keeps
clerical cleanup from becoming a repository-wide compatibility migration.
