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
    'so point it at this worktree\'s own dev server:',
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
      args: [
        'run',
        'test:related',
        ...related,
      ],
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

  return [...new Map(checks.map(check => [check.id, check])).values()];
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
