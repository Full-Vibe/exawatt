import { spawn } from 'node:child_process';

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
        'exec',
        'vitest',
        'related',
        ...related,
        '--run',
        '--maxWorkers=25%',
        '--passWithNoTests',
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
