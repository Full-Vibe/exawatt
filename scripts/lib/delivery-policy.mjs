import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { loadavg, tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Flake-aware reruns for the vitest checks (BUG-090).
 *
 * `test:related` on a module the whole app imports selects a large `app-dom`
 * set, and on a machine running four agent worktrees those tests fail by
 * TIMEOUT rather than by assertion. The failing identities changed between
 * runs on identical code — six one run, eight the next, two different ones on
 * a clean `origin/master` control — which is the proof that none of them was a
 * defect. The floor still reported them as named test failures, which reads to
 * the author as "your change broke these", and that misreport is the damage:
 * six landing attempts on a change that only set an icon path.
 *
 * The repair is to automate the diagnostic `docs/engineering/agent-delivery.md`
 * already prescribes: re-run the named files ALONE. A break is deterministic
 * and reproduces in isolation; contention does not. So a failed vitest check
 * re-runs exactly the files it named, once, in a single worker:
 *
 * - every named file passes alone → `flaked`. The floor CONTINUES and the
 *   result is reported and recorded as a suspected flake with the file
 *   identities, the failing test names, and the load average at both runs, so
 *   a real regression hiding behind flakiness stays findable across landings.
 * - any file fails again → the floor FAILS, naming what reproduced separately
 *   from what did not, so the author reads the deterministic half.
 * - the rerun did not actually run what it was asked to → `inconclusive`, and
 *   the original failure stands. A rerun that silently matched nothing must
 *   never read as proof of a flake.
 *
 * No timeout is raised anywhere. Decision `0030` keeps the suite bounded, and a
 * longer timeout would make every real failure slower to surface.
 */
const VITEST_RERUN = { kind: 'vitest', script: 'test:alone' };

/**
 * A rerun wider than this is a second full run, not a targeted one, and the
 * floor's job is to bound the load rather than double it. Above the cap the
 * original failure stands, which is also the right reading: dozens of files
 * failing at once is a break, not machine contention.
 */
const MAX_RERUN_FILES = 25;

/**
 * Surface gates (ENG-016 D51).
 *
 * This repository owns 31 eval gates and the changed-path floor routed to
 * exactly one of them. The reason is structural, not neglect: every browser
 * and Electron eval needs a dev server the floor does not own (`EXA_BASE`),
 * so it cannot simply run them. The consequence was that the most
 * motion-sensitive surfaces in the app — the ribbon, workspace chrome, the
 * navigation spine — could change and land with zero gates run, as long as
 * the author forgot. Forgetting was silent, which is the whole defect.
 *
 * So the floor does not run these; it REQUIRES them to be declared. Touch a
 * gated surface and the gate must appear in `--verify`, or be waived on
 * purpose with `--waive-gate <id>` (recorded, not hidden). The floor stays
 * cheap and unattended; the omission stops being invisible.
 *
 * Adding a gate is a data edit here, never a code edit at the call site.
 *
 * `quarantined` records a gate whose SURFACE still owes it but whose script
 * is currently red for reasons of its own — the first routing pass found two
 * that had been broken since D49 without anyone knowing, which is the same
 * disease one layer down. A quarantined gate is announced, never enforced,
 * and carries the backlog id that will repair it. Deleting the entry instead
 * would throw away the knowledge that the surface owes evidence at all.
 */
export const SURFACE_GATES = [
  {
    gate: 'eval:workspace:ribbon:bench',
    why: 'the Project ribbon is width/motion-sensitive and has a screenshot bench',
    match: file =>
      /^src\/components\/workspace\/(?:tab-strip|project-ribbon-[^/]*|natural-width)\.tsx?$/.test(
        file
      ),
  },
  {
    gate: 'eval:workspace:chrome',
    why: 'workspace chrome layout is height-sensitive; a shift resizes every terminal',
    match: file =>
      /^src\/components\/workspace\/(?:workspace-client|split-layout|terminal-pane)\.tsx?$/.test(
        file
      ),
  },
  {
    gate: 'eval:navigation',
    why: 'the command-altitude continuum owns cross-surface navigation',
    match: file =>
      /^src\/components\/nav\/(?:command-navigation-provider|command-altitude[^/]*|nav-history|surfaces)\.tsx?$/.test(
        file
      ),
  },
  {
    gate: 'eval:theme-system',
    why: 'appearance resolution decides every surface colour, including whether a default action still reads as one',
    match: file =>
      /^src\/lib\/appearance\/(?:color|resolve-appearance)\.ts$/.test(file) ||
      /^themes\/v1\/.+\.json$/.test(file),
  },
  {
    gate: 'eval:workspace:paused',
    why: 'a paused Agent must state how it ended and must not read its transcript to render',
    match: file =>
      /^src\/components\/workspace\/paused-agent-record\.tsx?$/.test(file) ||
      /^electron\/main\/pty\/(?:transcript-lines|transcript-window|scrollback-store|session-history-store)\.ts$/.test(
        file
      ),
  },
  {
    gate: 'eval:workspace:team',
    why: 'the Team altitude owns live re-sorting, its glide, and the stored order',
    match: file =>
      /^src\/components\/workspace\/(?:expose-overlay|team-order[^/]*|team-grid-nav|use-flip-tiles)\.tsx?$/.test(
        file
      ),
  },
  {
    gate: 'eval:navigation:spine',
    why: 'the native application menu is a cross-process surface: labels, accelerators and enablement only exist once Electron builds the real menu, and ⌘[/⌘] only traverse real history against a real router',
    // FIX-012: Resume had a chord and a palette row and no menu item, and no
    // gate noticed, because the menu template lived inside main.ts where
    // nothing exercised it. The template is now its own module, derived from
    // the command-verb manifest, and both files owe the eval that reads the
    // real Menu.getApplicationMenu().
    //
    // BUG-035 added the history owners. This gate is the only check that
    // presses ⌘[ and ⌘] against a real router round trip, and the defect it
    // caught lived in `nav-history.ts` — a file the map did not name, so the
    // change that could have broken it never had to declare this gate.
    //
    // BUG-045 is CLOSED (2026-08-17, ENG-030 WP2b-5A) and this gate is green
    // again. It had been waived per landing because the script stopped at a
    // `Quick feedback` dialog the DEFAULT community contract cannot open
    // (`openQuickCapture` refuses when `services.productFeedback` is null) —
    // the BUG-043 class one script further out. The repair is the same shape
    // BUG-043 chose: the script asks the resolved contract first and asserts
    // the OPPOSITE property where the capability is absent (the shortcut is
    // inert), so both distributions are pinned and neither is unchecked.
    // Quarantining was refused throughout, because it would have dropped this
    // surface's only real ⌘[/⌘] and application-menu coverage for every
    // distribution to route around a step that was wrong in one.
    //
    // BUG-058 adds the two files that own the ⌘⇧F step, which this gate has
    // asserted since F1 and never named. `product-feedback-provider.tsx` is
    // where `openQuickCapture` decides whether the dialog can open at all —
    // the exact function BUG-045 was about, cited three paragraphs up and
    // still absent from this list — and `ui/dialog.tsx` is the primitive that
    // gives that dialog the role and accessible name the script matches on
    // (`getByRole('dialog', { name: 'Quick feedback' })`). BUG-049 changed
    // both, and both branches of this step ride on them.
    //
    // The pattern is now named, not just patched. Three times in one day a
    // gate failed to name a file that owns its contract: `nav-history.ts`
    // here (BUG-035), `workspace-client.tsx` on `eval:electron:lifecycle`
    // (BUG-041), and these two (BUG-058). The map is written from the
    // SURFACE the gate is nominally about; the script asserts more than that
    // surface, and every extra assertion silently acquires an owner nobody
    // routes. When adding or widening an assertion in a gated eval, add the
    // file that can break it here in the same change.
    match: file =>
      file === 'electron/main/application-menu.ts' ||
      file === 'packages/core/src/shortcuts/command-verbs.ts' ||
      file === 'src/components/shortcuts/shortcut-provider.tsx' ||
      file === 'src/components/nav/nav-history.ts' ||
      file === 'src/components/nav/command-navigation-provider.tsx' ||
      file === 'src/components/feedback/product-feedback-provider.tsx' ||
      file === 'src/components/ui/dialog.tsx' ||
      // The gate's own script, for the reason `eval:electron:packaged` already
      // names `electron-packaged-smoke.mjs` and `eval:electron:project-agent`
      // names `lib/electron-eval.mjs`: a change to how a gate asserts must run
      // that gate. This one was the exception, so BUG-058's own hardening of
      // three steps would have been asked for nothing.
      file === 'scripts/electron-spine-eval.mjs',
  },
  {
    gate: 'eval:electron:packaged',
    why: 'only a packaged build runs the standalone renderer, and only running it distinguishes a renderer that serves from one that died',
    // BUG-036: `next` 16.2.9 → 16.3.1 arrived in a dependency-hardening commit
    // that touched package.json, pnpm-lock.yaml and three audit scripts. The
    // new @swc/helpers resolves under `module-sync` at runtime and under
    // `require` in the trace, so the standalone renderer exited 1 in every
    // packaged build and the app booted to `Command engine paused`. Nothing
    // routed there: no Electron path, no renderer path, no UI path changed.
    //
    // A LOCKFILE is therefore a first-class trigger here. So is anything that
    // decides what the renderer payload contains or how it is sealed. This is
    // the one Electron gate the floor can genuinely run unattended — it needs
    // no dev server, and the eval builds its own package when the worktree has
    // none — which is why it is enforced rather than quarantined.
    match: file =>
      file === 'pnpm-lock.yaml' ||
      file === 'next.config.ts' ||
      file === 'electron-builder.yml' ||
      file === 'scripts/prepare-electron-renderer.mjs' ||
      file === 'scripts/lib/renderer-archive.mjs' ||
      file === 'scripts/electron-packaged-smoke.mjs' ||
      // BUG-043: the gate resolves the bundle and the capabilities it owes from
      // the distribution contract. A change to that resolution changes what
      // every packaged eval launches.
      file === 'scripts/lib/packaged-app.mjs',
  },
  {
    gate: 'eval:workspace:launcher',
    why: 'the New Agent launcher has a deterministic state/interaction rig',
    // option-menu is the launcher's list renderer (decision `0033`, one menu
    // primitive) and is only ever seen through it. BUG-003 changed it and
    // ran no gate, which is how a menu that opened above the top of the
    // window shipped.
    match: file =>
      file.startsWith('src/components/workspace/launcher/') ||
      file === 'src/components/ui/option-menu.tsx' ||
      file === 'src/components/ui/option-menu-keyboard.ts',
  },
  {
    gate: 'eval:electron:project-agent',
    why: 'the composer owns the launcher\'s data, the setup drawer\'s axes and the "All engines and models" catalog, and nine evals drive all three through one shared helper',
    // BUG-014: `eval:workspace:launcher` gates the launcher COMPONENTS, and
    // the bench renders them from fixtures. Neither covered the composer that
    // adapts runtime truth into them, so D49 could leave a whole control row
    // behind `hidden` and nine scripts kept driving dead UI for two months.
    // `scripts/lib/electron-eval.mjs` is here for the same reason one layer
    // down: it is now the single owner of how an eval drives this surface, so
    // changing it must run something that uses it.
    match: file =>
      file === 'src/components/workspace/launch-controls.tsx' ||
      file === 'scripts/lib/electron-eval.mjs' ||
      file === 'scripts/lib/harness-probe-fixture.mjs',
  },
  {
    gate: 'eval:roadmap:rail',
    why: 'the roadmap lens is the Sessions altitude and its declare-at-launch path crosses the launcher',
    // The eval existed with NO package command at all, so no change could
    // declare it and nothing ever ran it (BUG-014). It is `eval:roadmap:rail`
    // now, and the surface it protects owes it. Born quarantined against
    // BUG-040 because its first run reported the designed empty state as
    // regressed; the empty state was healthy and the eval was reading a
    // DIFFERENT Project's rail, so the quarantine is lifted and the gate is
    // enforced. Every rail read now names the Project it is about.
    match: file =>
      file.startsWith('src/components/roadmap/') ||
      file.startsWith('electron/main/roadmap/'),
  },
  {
    gate: 'eval:electron:recents',
    why: 'the recent-conversation browser is the only route back into an exact provider Session',
    // Quarantined against BUG-038 because its last check reported a draft
    // surviving an exact resume. No draft survived: the check identified a
    // draft by its rendered copy, and `New agent` is the designed fallback
    // identity for any untitled Session, live or draft. Tabs state their
    // lifecycle now and the gate is enforced.
    match: file =>
      file === 'src/components/workspace/recent-conversations.tsx' ||
      file === 'electron/main/pty/conversation-catalog.ts',
  },
  {
    gate: 'eval:electron:agent-sources',
    why: 'the Agent Source registry decides which engines exist, whether they are launchable, and what models they publish',
    // Quarantined against BUG-039 because a launch verb summoned no composer.
    // Two product defects, both repaired: a launch moved the operator to
    // main's realpath of the working directory instead of to the Project group
    // holding the tab, and Grok classified a concrete model id as an account
    // default, which told the composer to omit the flag it was displaying.
    match: file =>
      file === 'src/components/workspace/agent-sources.ts' ||
      file === 'electron/main/agent-sources-ipc.ts' ||
      file === 'electron/main/pty/agent-models.ts',
  },
  {
    gate: 'eval:electron:lifecycle',
    why: 'the launcher composer is the only way to start a Session, and the whole PTY lifecycle — cancel, quit, corrupt history, restore, resume, crash — hangs off what it starts',
    // Routed for the FIRST time here. Nothing in this map named it, so no
    // change to the launcher or the session lifecycle has ever been made to
    // run it — the BUG-010/011/014 disease, one more instance, and the reason
    // its first real packaged run since BUG-036 found a live defect.
    //
    // It was born quarantined against BUG-041, whose defect it found on that
    // first run: from a Project with no tabs, changing the Engine axis closed
    // the setup drawer holding it. The cause was one render site too many —
    // `workspace-client` swapped AgentComposer between the empty-Project stage
    // and the draft pane, so materialising the tab REMOUNTED it. There is one
    // composer slot now (`resolveComposerSlot`), the gate is green, and the
    // quarantine is lifted.
    //
    // `workspace-client.tsx` joins the map for the same reason BUG-035 put
    // `nav-history.ts` on the spine gate: the file that actually broke was not
    // named here, so the change that broke it never had to run the eval that
    // catches it. The composer's render site is part of "the only way to start
    // a Session", whatever component the launcher itself lives in.
    match: file =>
      file === 'src/components/workspace/launcher/agent-launcher.tsx' ||
      file === 'src/components/workspace/launcher/setup-detail.tsx' ||
      file === 'src/components/workspace/workspace-client.tsx' ||
      file === 'electron/main/pty/session-manager.ts',
  },
  {
    gate: 'eval:electron:idempotency',
    why: 'rehydration must adopt each Session exactly once, and it starts them through the same launcher driver',
    // Same driver, same fixtures, same first-axis defect; BUG-041 repaired it
    // in `workspace-client` and this gate is enforced again.
    match: file =>
      file === 'src/components/workspace/launcher/agent-launcher.tsx' ||
      file === 'electron/main/pty/session-manager.ts',
  },
];

/**
 * Gates the change owes, minus the ones already declared. `declared` is the
 * caller's `--verify` list plus any explicit waivers.
 */
export function missingSurfaceGates(changedPaths, declared = []) {
  const satisfied = new Set(declared);
  return SURFACE_GATES.flatMap(entry => {
    if (entry.quarantined) return [];
    if (satisfied.has(entry.gate)) return [];
    const paths = [...new Set(changedPaths)].filter(entry.match);
    if (paths.length === 0) return [];
    return [{ gate: entry.gate, why: entry.why, paths: paths.sort() }];
  });
}

/** Gates this change would owe if their scripts were green. Announced so a
 *  quarantine cannot quietly become "this surface needs no evidence". */
export function quarantinedSurfaceGates(changedPaths) {
  return SURFACE_GATES.flatMap(entry => {
    if (!entry.quarantined) return [];
    const paths = [...new Set(changedPaths)].filter(entry.match);
    if (paths.length === 0) return [];
    return [
      {
        gate: entry.gate,
        why: entry.why,
        backlogId: entry.quarantined,
        paths: paths.sort(),
      },
    ];
  });
}

/** The refusal an agent reads when it skipped a gate its change owes. */
export function surfaceGateMessage(missing) {
  return [
    'This change touches surfaces that own eval gates, and none were declared.',
    ...missing.flatMap(entry => [
      `  ${entry.gate} — ${entry.why}`,
      ...entry.paths.map(file => `      ${file}`),
    ]),
    '',
    'Declaring a gate makes the floor RUN it on the exact tree being landed,',
    "so point it at this worktree's own dev server:",
    '  pnpm dev -p <free-port>',
    `  EXA_BASE=http://localhost:<port> pnpm agent:land -- ${missing
      .map(entry => `--verify ${entry.gate}`)
      .join(' ')}`,
    '',
    'If the gate genuinely does not apply, waive it on purpose:',
    `  pnpm agent:land -- ${missing.map(entry => `--waive-gate ${entry.gate}`).join(' ')}`,
  ].join('\n');
}

export function classifyDeliveryPolicy(changedPaths, extras = []) {
  const paths = [...new Set(changedPaths)].sort();
  const checks = [
    {
      id: 'open-source:paths:check',
      command: 'pnpm',
      args: ['run', 'open-source:paths:check'],
    },
    {
      id: 'content:scan',
      command: 'pnpm',
      args: ['run', 'content:scan', '--', ...paths],
    },
    { id: 'type-check', command: 'pnpm', args: ['run', 'type-check'] },
    {
      id: 'test:agent-delivery',
      command: 'pnpm',
      args: ['run', 'test:agent-delivery'],
    },
  ];

  const related = paths.filter(file => /\.(?:[cm]?[jt]sx?)$/.test(file));
  if (related.length > 0) {
    checks.push({
      id: 'vitest-related',
      command: 'pnpm',
      args: ['run', 'test:related', ...related],
      rerun: VITEST_RERUN,
    });
  }

  // BUG-042: the default community contract has no account service, and the
  // resolver blanks the legacy service variables AFTER ambient env on purpose,
  // so a route that demands that capability while Next prerenders it fails
  // every build path — CI, `pnpm electron:build:dogfood`, and the packaged
  // renderer. Two routes did, and the only evidence that would have caught it
  // is a build under the DEFAULT contract. Nothing ran one: CI's `pnpm build`
  // step passed Supabase secrets the resolver discards, and master's CI run is
  // cancelled by the next landing before it reaches the build (see incident
  // `0015`), so the seam commit itself was never proven.
  //
  // This is a changed-path check, not a SURFACE_GATES entry, precisely because
  // declaring is the part that got skipped. It runs unattended on the exact
  // tree being landed, and `verify:community-build` unsets any ambient
  // distribution config so an agent shell that exported one cannot make the
  // check quietly prove the official build instead.
  if (
    paths.some(
      file =>
        file.startsWith('src/app/') ||
        file.startsWith('src/lib/supabase/') ||
        file.startsWith('src/lib/distribution/') ||
        file.startsWith('packages/core/src/distribution/') ||
        file === 'next.config.ts' ||
        file === 'scripts/prepare-distribution.mjs' ||
        file === 'scripts/lib/distribution-build.mjs' ||
        file === 'scripts/lib/company-composition.mjs' ||
        file === 'scripts/run-next-with-distribution.mjs' ||
        // The build now composes the tree it builds, so a change to what the
        // overlay declares is a change to what a community build must NOT have.
        file === 'company/overlay-manifest.json'
    )
  ) {
    checks.push({
      id: 'verify:community-build',
      command: 'pnpm',
      args: ['run', 'verify:community-build'],
    });
  }

  // BUG-044: the runtime half of the same defect. A build that compiles still
  // 500s on the first REQUEST if a server action or route handler demands the
  // account capability, and `verify:community-build` cannot see that, because
  // those paths only execute when something calls them. The operator's
  // workspace logged two 500s per launch for exactly this reason while the
  // build was green.
  //
  // The check owns a CENSUS as well as a behaviour assertion: a newly written
  // server action or route handler fails it until its author declares what the
  // entrypoint does with no account service. That is what stops the class from
  // regrowing one 500 at a time. Separate from the build check above because
  // its path set is different and a shortcut-store edit should not pay for a
  // full `next build`.
  if (
    paths.some(
      file =>
        file.startsWith('src/app/') ||
        file.startsWith('src/lib/supabase/') ||
        file.startsWith('src/lib/distribution/') ||
        file.startsWith('src/lib/shortcuts/') ||
        file.startsWith('packages/core/src/distribution/') ||
        // ENG-030 WP3: the census spans the composition boundary, so an agent
        // adding a hosted route to the company overlay meets the same
        // obligation to declare what it does with no account service.
        file.startsWith('company/') ||
        file === 'scripts/distribution.official.example.json'
    )
  ) {
    checks.push({
      id: 'verify:community-runtime',
      command: 'pnpm',
      args: ['run', 'verify:community-runtime'],
    });
  }

  if (
    paths.some(
      file =>
        file.startsWith('electron/') ||
        file.startsWith('packages/core/') ||
        /^scripts\/(?:build-dogfood|install-dogfood|electron-)/.test(file) ||
        file === 'electron-builder.yml' ||
        file === 'electron-builder.release.yml'
    )
  ) {
    checks.push({
      id: 'electron:compile',
      command: 'pnpm',
      args: ['run', 'electron:compile'],
    });
  }

  if (
    paths.some(
      file => file.includes('qa-browser') || file.includes('playwright')
    )
  ) {
    checks.push({
      id: 'qa:browser:doctor',
      command: 'pnpm',
      args: ['run', 'qa:browser:doctor'],
    });
  }

  if (
    paths.some(
      file =>
        file.startsWith('src/components/fleet/spatial/') ||
        file.startsWith('scripts/r3f-eval/')
    )
  ) {
    checks.push({
      id: 'eval:r3f',
      command: 'pnpm',
      args: ['run', 'eval:r3f'],
    });
  }

  if (paths.some(file => file.startsWith('docs/engineering/'))) {
    checks.push({
      id: 'roadmap-contract',
      command: 'pnpm',
      args: [
        'exec',
        'vitest',
        'run',
        'packages/core/src/__tests__/roadmap-parse.test.ts',
        'packages/core/src/__tests__/roadmap-link.test.ts',
        '--maxWorkers=25%',
        '--passWithNoTests',
      ],
      rerun: VITEST_RERUN,
    });
  }

  for (const script of extras) {
    checks.push({ id: script, command: 'pnpm', args: ['run', script] });
  }

  const repositoryOwned = new Map();
  for (const check of checks) {
    if (!repositoryOwned.has(check.id)) repositoryOwned.set(check.id, check);
  }
  return [...repositoryOwned.values()];
}

/** The reporter pair every rerunnable vitest check runs under: the default
 *  reporter still prints for the human, and the JSON one is the machine
 *  channel. Human reporter text is never parsed. */
export function vitestReportArgs(reportPath) {
  return [
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${reportPath}`,
  ];
}

/**
 * The test files a vitest JSON report says failed, repository-relative, each
 * with the tests that failed inside it. The test names are what makes a
 * repeated flake distinguishable from a one-off in the metric stream.
 */
export function failedVitestFiles(report, root) {
  if (!Array.isArray(report?.testResults)) return [];
  return report.testResults
    .filter(result => result.status === 'failed')
    .map(result => ({
      file: repositoryRelative(result.name, root),
      tests: (result.assertionResults ?? [])
        .filter(assertion => assertion.status === 'failed')
        .map(assertion => assertion.fullName ?? assertion.title ?? '(unnamed)'),
    }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

/** Every test file a report covered, whatever its result. */
export function coveredVitestFiles(report, root) {
  if (!Array.isArray(report?.testResults)) return [];
  return report.testResults.map(result =>
    repositoryRelative(result.name, root)
  );
}

/**
 * What the isolated rerun proved. `reproduced` failed twice and is the
 * author's; `flaked` failed in the full selection and passed alone;
 * `notRun` means the rerun never exercised a file it was asked about, which
 * settles nothing and must not be read as a pass.
 */
export function rerunVerdict({ requested, report, root }) {
  const covered = new Set(coveredVitestFiles(report, root));
  const notRun = requested
    .map(entry => entry.file)
    .filter(file => !covered.has(file));
  const reproduced = failedVitestFiles(report, root);
  const failedFiles = new Set(reproduced.map(entry => entry.file));
  const flaked = requested.filter(entry => !failedFiles.has(entry.file));
  if (notRun.length > 0) return { status: 'inconclusive', notRun };
  if (reproduced.length > 0)
    return { status: 'reproduced', reproduced, flaked };
  return { status: 'flake', flaked };
}

function repositoryRelative(file, root) {
  if (typeof file !== 'string') return '(unnamed file)';
  if (!path.isAbsolute(file)) return file;
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') ? relative : file;
}

function fileLines(entries) {
  return entries.flatMap(entry => [
    `      ${entry.file}`,
    ...entry.tests.map(name => `          ${name}`),
  ]);
}

function loadLine(load) {
  return `      load average ${load.atFailure.toFixed(2)} at the failure, ${load.atRerun.toFixed(2)} at the rerun`;
}

/** What the author reads when the named files passed alone. Loud on purpose:
 *  a swallowed flake is how a real regression hides. */
export function suspectedFlakeReport({ checkId, flaked, load }) {
  return [
    `[agent-land] SUSPECTED FLAKE — ${checkId} named ${flaked.length} failing file(s), and every one passed when re-run alone.`,
    loadLine(load),
    ...fileLines(flaked),
    '      A break is deterministic. Failing in a large selection and passing in',
    '      isolation is the machine-contention signature in',
    '      docs/engineering/agent-delivery.md, not a defect in this change.',
    '      Recorded as a floor_check flake; the floor continues.',
  ].join('\n');
}

/** What the author reads when the rerun failed too. This is the right reason
 *  to fail: it failed twice, the second time with the machine to itself. */
export function reproducedFailureReport({ checkId, reproduced, flaked, load }) {
  return [
    `${checkId} failed, and ${reproduced.length} file(s) failed AGAIN when re-run alone in a single worker:`,
    ...fileLines(reproduced),
    loadLine(load),
    'A failure that survives isolation is deterministic. Fix these; they are not machine load.',
    ...(flaked.length > 0
      ? [
          `${flaked.length} other file(s) passed when run alone and are recorded as suspected flakes:`,
          ...fileLines(flaked),
        ]
      : []),
  ].join('\n');
}

/** The rerun answered nothing, so the first failure stands unqualified. */
export function inconclusiveRerunReport({ checkId, notRun }) {
  return [
    `${checkId} failed, and the isolated rerun never ran ${notRun.length} of the file(s) it named:`,
    ...notRun.map(file => `      ${file}`),
    'A rerun that matched nothing is not evidence of a flake, so the original failure stands.',
  ].join('\n');
}

/** The first known intermittent (agent-delivery.md): a non-zero exit with no
 *  failing test named is an unhandled error or a dead worker, and that
 *  distinction is the whole diagnosis. Nothing is re-run for it. */
export function unnamedFailureReport(checkId) {
  return [
    `${checkId} exited non-zero and named no failing test file.`,
    'That is an unhandled error or a dead worker, not a failing assertion, and',
    'no rerun can narrow it. Capture the FULL output, not the tail — see',
    '"A known intermittent" in docs/engineering/agent-delivery.md.',
  ].join('\n');
}

/** Above the cap the rerun would be a second full run. The floor bounds load;
 *  it does not double it. */
export function rerunTooWideReport(checkId, failures) {
  return [
    `${checkId} named ${failures.length} failing file(s), more than the ${MAX_RERUN_FILES} a targeted rerun covers.`,
    'Re-running them would be a second full run, which is the load this floor',
    'exists to bound. Dozens of files failing at once is a break, not contention.',
  ].join('\n');
}

async function spawnCheck(root, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
}

async function readReport(reportPath) {
  try {
    return JSON.parse(await readFile(reportPath, 'utf8'));
  } catch {
    // A crashed or killed run writes no report. That is the unnamed-failure
    // path, handled by the caller; it is never an error of its own.
    return null;
  }
}

function exitMessage(check, code) {
  return `${check.command} ${check.args.join(' ')} exited ${code}`;
}

async function runVitestCheck(root, check) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'exawatt-floor-'));
  try {
    const firstReport = path.join(workspace, 'selection.json');
    const code = await spawnCheck(root, check.command, [
      ...check.args,
      ...vitestReportArgs(firstReport),
    ]);
    if (code === 0) return { status: 'passed' };

    const atFailure = loadavg()[0];
    const failures = failedVitestFiles(await readReport(firstReport), root);
    // A failure carries its file identities into the metric stream too, so the
    // stream holds what was named at every outcome, not only at a flake.
    const failed = (message, detail = {}) => ({
      status: 'failed',
      message: `${exitMessage(check, code)}\n${message}`,
      detail: { loadAverageAtFailure: atFailure, ...detail },
    });
    if (failures.length === 0) return failed(unnamedFailureReport(check.id));
    if (failures.length > MAX_RERUN_FILES)
      return failed(rerunTooWideReport(check.id, failures), {
        failedFiles: failures,
      });

    console.log(
      `[agent-land] ${check.id} named ${failures.length} failing file(s); re-running them alone once (BUG-090).`
    );
    const rerunReport = path.join(workspace, 'isolated.json');
    await spawnCheck(root, check.command, [
      'run',
      check.rerun.script,
      ...failures.map(entry => entry.file),
      ...vitestReportArgs(rerunReport),
    ]);
    const load = { atFailure, atRerun: loadavg()[0] };
    const verdict = rerunVerdict({
      requested: failures,
      report: await readReport(rerunReport),
      root,
    });

    if (verdict.status === 'inconclusive')
      return failed(
        inconclusiveRerunReport({ checkId: check.id, notRun: verdict.notRun }),
        { failedFiles: failures, notRunFiles: verdict.notRun }
      );
    if (verdict.status === 'reproduced')
      return failed(
        reproducedFailureReport({ checkId: check.id, ...verdict, load }),
        {
          reproducedFiles: verdict.reproduced,
          flakedFiles: verdict.flaked,
          loadAverageAtRerun: load.atRerun,
        }
      );

    console.warn(
      suspectedFlakeReport({ checkId: check.id, flaked: verdict.flaked, load })
    );
    return {
      status: 'flaked',
      detail: {
        flakedFiles: verdict.flaked,
        loadAverageAtFailure: atFailure,
        loadAverageAtRerun: load.atRerun,
      },
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runOneCheck(root, check) {
  if (check.rerun?.kind === 'vitest') return runVitestCheck(root, check);
  const code = await spawnCheck(root, check.command, check.args);
  return code === 0
    ? { status: 'passed' }
    : { status: 'failed', message: exitMessage(check, code) };
}

export async function runDeliveryChecks(
  root,
  checks,
  { phase = 'candidate', onResult = async () => {} } = {}
) {
  const evidence = [];
  for (const check of checks) {
    const startedAt = Date.now();
    console.log(
      `[agent-land] ${phase} floor: ${check.command} ${check.args.join(' ')}`
    );
    let outcome;
    try {
      outcome = await runOneCheck(root, check);
    } catch (error) {
      outcome = { status: 'failed', message: error.message };
    }
    const result = {
      id: check.id,
      phase,
      status: outcome.status,
      durationMs: Date.now() - startedAt,
      completedAt: new Date().toISOString(),
      ...(outcome.detail ?? {}),
    };
    if (outcome.status === 'failed') {
      await onResult(result);
      throw new Error(outcome.message);
    }
    evidence.push(result);
    await onResult(result);
  }
  return evidence;
}
