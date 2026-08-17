import { spawn } from 'node:child_process';

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
    // NOT quarantined despite BUG-045, on purpose. Under the DEFAULT community
    // contract the script stops at a `Quick feedback` dialog that build cannot
    // open (`openQuickCapture` refuses when `services.productFeedback` is
    // null) — reproduced identically on a clean `origin/master` baseline, so
    // it is the gate's assumption, the BUG-043 class one script further out.
    // But the failure is contract-shaped, not universal: quarantining would
    // drop this surface's only real ⌘[/⌘] and application-menu coverage for
    // every distribution, to route around a step that is wrong in one. It
    // stays enforced and is waived per landing until BUG-045 makes the script
    // ask the contract what it may assert.
    match: file =>
      file === 'electron/main/application-menu.ts' ||
      file === 'packages/core/src/shortcuts/command-verbs.ts' ||
      file === 'src/components/shortcuts/shortcut-provider.tsx' ||
      file === 'src/components/nav/nav-history.ts' ||
      file === 'src/components/nav/command-navigation-provider.tsx',
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
      file === 'electron/main/pty/agent-models.ts' ||
      file.startsWith('electron/main/agents/'),
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
        file === 'scripts/run-next-with-distribution.mjs'
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
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(check.command, check.args, {
          cwd: root,
          stdio: 'inherit',
          env: process.env,
        });
        child.once('error', reject);
        child.once('exit', code =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  `${check.command} ${check.args.join(' ')} exited ${code}`
                )
              )
        );
      });
      const result = {
        id: check.id,
        phase,
        status: 'passed',
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString(),
      };
      evidence.push(result);
      await onResult(result);
    } catch (error) {
      const result = {
        id: check.id,
        phase,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString(),
      };
      await onResult(result);
      throw error;
    }
  }
  return evidence;
}
