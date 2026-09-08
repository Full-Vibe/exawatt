import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { parseExactPublicArguments } from './exact-public-recertification.mjs';
import {
  EXACT_PUBLIC_GATES,
  buildExactPublicEnvironment,
  certifyExactPublicCandidate,
  runRecertificationProcess,
  runExactPublicRecertification,
} from './lib/exact-public-recertification.mjs';

const execFileAsync = promisify(execFile);
const GIT_ENV = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: process.env.HOME ?? tmpdir(),
  LANG: 'en_US.UTF-8',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Exact Public Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Exact Public Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
};

async function git(root, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    env: GIT_ENV,
  });
  return stdout.trim();
}

async function write(root, relative, contents) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

function fixtureGate(id) {
  return Object.freeze({
    id,
    command: 'fixture-gate',
    args: Object.freeze([id]),
    proves: Object.freeze([`proof-${id}`]),
  });
}

async function createFixture() {
  const parent = await mkdtemp(path.join(tmpdir(), 'exawatt-recertify-test-'));
  const temporaryRoot = path.join(parent, 'temporary');
  const makeProject =
    ({ environmentFile = null, reportedSha = null } = {}) =>
    async ({ destination }) => {
      await mkdir(destination, { recursive: true });
      await git(destination, ['init', '--quiet', '--initial-branch=master']);
      await write(
        destination,
        'package.json',
        `${JSON.stringify(
          {
            name: 'exact-public-fixture',
            private: true,
            packageManager: 'pnpm@10.30.1',
          },
          null,
          2
        )}\n`
      );
      await write(destination, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
      await write(
        destination,
        'scripts/open-source-paths.manifest.json',
        '{"schemaVersion":1}\n'
      );
      await write(destination, 'README.md', '# exact public fixture\n');
      if (environmentFile) {
        await write(destination, environmentFile, 'PRIVATE=value\n');
      }
      await git(destination, ['add', '--all']);
      await git(destination, ['commit', '--quiet', '-m', 'public fixture']);
      const publicSha = await git(destination, ['rev-parse', 'HEAD']);
      return {
        sourceSha: '1'.repeat(40),
        publicSha: reportedSha ?? publicSha,
        planDigest: '2'.repeat(64),
        unrenderedOutputs: [],
        projectedPaths: [
          'README.md',
          'package.json',
          'pnpm-lock.yaml',
          'scripts/open-source-paths.manifest.json',
          ...(environmentFile ? [environmentFile] : []),
        ],
      };
    };

  async function clone(source, destination) {
    await execFileAsync(
      'git',
      [
        'clone',
        '--quiet',
        '--no-hardlinks',
        '--no-local',
        '--no-tags',
        '--branch',
        'master',
        source,
        destination,
      ],
      { env: GIT_ENV }
    );
  }

  return {
    parent,
    temporaryRoot,
    makeProject,
    clone,
    async createTemporaryRoot() {
      await mkdir(temporaryRoot);
      return temporaryRoot;
    },
    cleanup: () => rm(parent, { recursive: true, force: true }),
  };
}

function makeRunner({
  failGate = null,
  observedPnpmVersion = '10.30.1',
  onGate = async () => {},
} = {}) {
  const gateCalls = [];
  const environments = [];
  return {
    gateCalls,
    environments,
    async run(command, args, options = {}) {
      if (command === 'git') {
        const { stdout } = await execFileAsync(command, args, {
          cwd: options.cwd,
          env: options.env,
        });
        return options.capture ? stdout : '';
      }
      if (command === 'pnpm' && args[0] === '--version') {
        return `${observedPnpmVersion}\n`;
      }
      const id = args[0];
      gateCalls.push(id);
      environments.push(options.env);
      if (id === failGate) throw new Error(`fixture failure at ${id}`);
      await onGate(id, options);
      return '';
    },
  };
}

test('the gate sequence leaves composite publication policy with its owner', () => {
  assert.equal(EXACT_PUBLIC_GATES[0].id, 'frozen-install');
  assert.equal(EXACT_PUBLIC_GATES[1].id, 'publication');
  assert.equal(EXACT_PUBLIC_GATES.at(-1).id, 'packaged-network');
  assert.equal(
    new Set(EXACT_PUBLIC_GATES.map(gate => gate.id)).size,
    EXACT_PUBLIC_GATES.length,
    'gate ids must stay unique evidence keys'
  );
  assert.deepEqual(EXACT_PUBLIC_GATES[1].proves, [
    'classification',
    'content',
    'production-audit',
    'licenses',
    'asset-provenance',
    'community-policy',
    'publication-tests',
  ]);
  assert.deepEqual(
    EXACT_PUBLIC_GATES.map(gate => gate.args[0]),
    [
      'install',
      'publication:check',
      'icon:check',
      'lint',
      'type-check',
      'electron:compile',
      'test:ci',
      'test:agent-delivery',
      'verify:community-build',
      'verify:community-runtime',
      'test:contracts',
      'electron:build:dir',
      'eval:electron:packaged',
      'eval:community:network',
    ]
  );
});

test('the child environment is an allowlist with clean disposable custody', () => {
  const environment = buildExactPublicEnvironment(
    {
      PATH: '/fixture/bin',
      LANG: 'en_US.UTF-8',
      HOME: '/operator',
      EXAWATT_DISTRIBUTION_CONFIG_JSON: '{"official":true}',
      EXAWATT_DISTRIBUTION_PROFILE: 'official',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'secret',
      GITHUB_TOKEN: 'secret',
      AWS_SECRET_ACCESS_KEY: 'secret',
      NODE_OPTIONS: '--require=/operator/hook.cjs',
    },
    { cleanHome: '/tmp/clean-home', cleanTemp: '/tmp/clean-tmp' }
  );

  assert.equal(environment.PATH, '/fixture/bin');
  assert.equal(environment.HOME, '/tmp/clean-home');
  assert.equal(environment.TMPDIR, '/tmp/clean-tmp');
  assert.equal(environment.CI, '1');
  for (const forbidden of [
    'EXAWATT_DISTRIBUTION_CONFIG_JSON',
    'EXAWATT_DISTRIBUTION_PROFILE',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'GITHUB_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'NODE_OPTIONS',
  ]) {
    assert.equal(environment[forbidden], undefined);
  }
});

test('the CLI accepts a source selector and an explicit local public anchor', () => {
  assert.deepEqual(parseExactPublicArguments([]), {
    help: false,
    sourceSha: 'HEAD',
  });
  assert.deepEqual(parseExactPublicArguments(['--source', 'abc123']), {
    help: false,
    sourceSha: 'abc123',
  });
  assert.deepEqual(parseExactPublicArguments(['--', '--source', 'abc123']), {
    help: false,
    sourceSha: 'abc123',
  });
  assert.deepEqual(parseExactPublicArguments(['--help']), { help: true });
  assert.deepEqual(
    parseExactPublicArguments([
      '--source',
      'abc123',
      '--public-anchor',
      './captured-public',
    ]),
    {
      help: false,
      sourceSha: 'abc123',
      publicAnchor: path.resolve('./captured-public'),
    }
  );
  for (const remote of [
    'https://github.com/example/public.git',
    'git@github.com:example/public.git',
  ]) {
    assert.throws(
      () => parseExactPublicArguments(['--public-anchor', remote]),
      /local repository/u
    );
  }
  assert.throws(
    () => parseExactPublicArguments(['--public-anchor']),
    /requires a local repository/u
  );

  assert.throws(
    () => parseExactPublicArguments(['--source']),
    /--source requires a commit/u
  );
  assert.throws(
    () => parseExactPublicArguments(['--skip-network']),
    /unknown argument --skip-network/u,
    'an expensive proof must not acquire a quiet weakening flag'
  );
});

test('a successful run binds both SHAs, strips secrets, and removes all temp state', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const runner = makeRunner();
  const logs = [];
  const gates = [fixtureGate('first'), fixtureGate('second')];

  const evidence = await runExactPublicRecertification({
    sourceRepo: fixture.parent,
    sourceSha: 'source-under-review',
    project: fixture.makeProject(),
    clone: fixture.clone,
    createTemporaryRoot: fixture.createTemporaryRoot,
    run: runner.run,
    gates,
    ambientEnv: {
      PATH: process.env.PATH,
      EXAWATT_DISTRIBUTION_CONFIG_JSON: 'official secret',
      GITHUB_TOKEN: 'github secret',
    },
    now: () => new Date('2026-08-20T12:00:00.000Z'),
    log: line => logs.push(line),
  });

  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.sourceSha, '1'.repeat(40));
  assert.match(evidence.publicSha, /^[0-9a-f]{40}$/u);
  assert.equal(evidence.planDigest, '2'.repeat(64));
  assert.equal(evidence.projectedPathCount, 4);
  assert.deepEqual(evidence.packageManager, {
    declared: 'pnpm@10.30.1',
    observedVersion: '10.30.1',
  });
  assert.equal(evidence.unrenderedOutputCount, 0);
  assert.deepEqual(runner.gateCalls, ['first', 'second']);
  for (const environment of runner.environments) {
    assert.equal(environment.EXAWATT_DISTRIBUTION_CONFIG_JSON, undefined);
    assert.equal(environment.GITHUB_TOKEN, undefined);
    assert.equal(environment.HOME, path.join(fixture.temporaryRoot, 'home'));
  }
  assert.ok(logs.some(line => line.includes('"status":"passed"')));
  assert.equal(existsSync(fixture.temporaryRoot), false);
});

test('an already-materialized candidate runs the same clean-room floor', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const candidateRepo = path.join(fixture.parent, 'candidate');
  const projection = await fixture.makeProject()({
    destination: candidateRepo,
  });
  const runner = makeRunner();
  const logs = [];

  const evidence = await certifyExactPublicCandidate({
    candidateRepo,
    expectedPublicSha: projection.publicSha,
    sourceSha: projection.sourceSha,
    planDigest: projection.planDigest,
    projectedPaths: projection.projectedPaths,
    unrenderedOutputs: projection.unrenderedOutputs,
    clone: fixture.clone,
    createTemporaryRoot: fixture.createTemporaryRoot,
    run: runner.run,
    gates: [fixtureGate('candidate-floor')],
    log: line => logs.push(line),
  });

  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.sourceSha, projection.sourceSha);
  assert.equal(evidence.publicSha, projection.publicSha);
  assert.equal(evidence.planDigest, projection.planDigest);
  assert.deepEqual(runner.gateCalls, ['candidate-floor']);
  assert.ok(logs[0].includes('certifying materialized candidate'));
  assert.equal(existsSync(fixture.temporaryRoot), false);
});

test('a materialized candidate must match its expected immutable SHA', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const candidateRepo = path.join(fixture.parent, 'candidate');
  const projection = await fixture.makeProject()({
    destination: candidateRepo,
  });
  const runner = makeRunner();

  await assert.rejects(
    certifyExactPublicCandidate({
      candidateRepo,
      expectedPublicSha: 'f'.repeat(40),
      sourceSha: projection.sourceSha,
      planDigest: projection.planDigest,
      projectedPaths: projection.projectedPaths,
      unrenderedOutputs: projection.unrenderedOutputs,
      clone: fixture.clone,
      createTemporaryRoot: fixture.createTemporaryRoot,
      run: runner.run,
      gates: [fixtureGate('must-not-run')],
      log: () => {},
    }),
    /clone HEAD [0-9a-f]{40} does not match projection f{40}/u
  );
  assert.deepEqual(runner.gateCalls, []);
  assert.equal(existsSync(fixture.temporaryRoot), false);
});

test('a failed gate stops the sequence, records its SHA pair, and cleans', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const runner = makeRunner({ failGate: 'second' });
  const logs = [];

  await assert.rejects(
    runExactPublicRecertification({
      sourceRepo: fixture.parent,
      project: fixture.makeProject(),
      clone: fixture.clone,
      createTemporaryRoot: fixture.createTemporaryRoot,
      run: runner.run,
      gates: [
        fixtureGate('first'),
        fixtureGate('second'),
        fixtureGate('must-not-run'),
      ],
      log: line => logs.push(line),
    }),
    /second failed for public [0-9a-f]{40}: fixture failure/u
  );

  assert.deepEqual(runner.gateCalls, ['first', 'second']);
  const failure = logs.find(line => line.includes('"status":"failed"'));
  assert.match(
    failure,
    /"sourceSha":"1111111111111111111111111111111111111111"/u
  );
  assert.match(failure, /"publicSha":"[0-9a-f]{40}"/u);
  assert.match(failure, /"failedGate":"second"/u);
  assert.equal(existsSync(fixture.temporaryRoot), false);
});

test('every Next environment basename fails before install and still cleans', async t => {
  for (const basename of [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
    '.env.test',
    '.env.test.local',
  ]) {
    await t.test(basename, async () => {
      const fixture = await createFixture();
      t.after(fixture.cleanup);
      const runner = makeRunner();

      await assert.rejects(
        runExactPublicRecertification({
          sourceRepo: fixture.parent,
          project: fixture.makeProject({ environmentFile: basename }),
          clone: fixture.clone,
          createTemporaryRoot: fixture.createTemporaryRoot,
          run: runner.run,
          gates: [fixtureGate('must-not-run')],
          log: () => {},
        }),
        new RegExp(
          `public clone carries environment custody at ${basename.replaceAll('.', '\\.')}`,
          'u'
        )
      );
      assert.deepEqual(runner.gateCalls, []);
      assert.equal(existsSync(fixture.temporaryRoot), false);
    });
  }
});

test('an install-created environment file stops later gates', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const runner = makeRunner({
    onGate: async (id, options) => {
      if (id === 'install') {
        await write(options.cwd, '.env.production.local', 'SECRET=value\n');
      }
    },
  });

  await assert.rejects(
    runExactPublicRecertification({
      sourceRepo: fixture.parent,
      project: fixture.makeProject(),
      clone: fixture.clone,
      createTemporaryRoot: fixture.createTemporaryRoot,
      run: runner.run,
      gates: [fixtureGate('install'), fixtureGate('must-not-run')],
      log: () => {},
    }),
    /install failed.*environment custody at \.env\.production\.local/u
  );
  assert.deepEqual(runner.gateCalls, ['install']);
  assert.equal(existsSync(fixture.temporaryRoot), false);
});

test('a clone/projection SHA mismatch fails before gates and still cleans', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const runner = makeRunner();

  await assert.rejects(
    runExactPublicRecertification({
      sourceRepo: fixture.parent,
      project: fixture.makeProject({ reportedSha: 'f'.repeat(40) }),
      clone: fixture.clone,
      createTemporaryRoot: fixture.createTemporaryRoot,
      run: runner.run,
      gates: [fixtureGate('must-not-run')],
      log: () => {},
    }),
    /clone HEAD [0-9a-f]{40} does not match projection f{40}/u
  );
  assert.deepEqual(runner.gateCalls, []);
  assert.equal(existsSync(fixture.temporaryRoot), false);
});

test('missing or nonempty unrendered outputs fail before clone and install', async t => {
  for (const unrenderedOutputs of [
    undefined,
    [
      {
        path: '.github/workflows/private.yml',
        recipe: 'missing-public-recipe',
      },
    ],
  ]) {
    await t.test(String(unrenderedOutputs?.length ?? 'missing'), async () => {
      const fixture = await createFixture();
      t.after(fixture.cleanup);
      const baseProject = fixture.makeProject();
      const runner = makeRunner();
      let cloned = false;

      await assert.rejects(
        runExactPublicRecertification({
          sourceRepo: fixture.parent,
          project: async options => ({
            ...(await baseProject(options)),
            unrenderedOutputs,
          }),
          clone: async (...args) => {
            cloned = true;
            return fixture.clone(...args);
          },
          createTemporaryRoot: fixture.createTemporaryRoot,
          run: runner.run,
          gates: [fixtureGate('must-not-run')],
          log: () => {},
        }),
        unrenderedOutputs === undefined
          ? /projector returned no unrenderedOutputs result/u
          : /projector omitted unrendered output \.github\/workflows\/private\.yml.*missing-public-recipe/u
      );
      assert.equal(cloned, false);
      assert.deepEqual(runner.gateCalls, []);
    });
  }
});

test('a pnpm version mismatch stops before install', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const runner = makeRunner({ observedPnpmVersion: '9.99.0' });

  await assert.rejects(
    runExactPublicRecertification({
      sourceRepo: fixture.parent,
      project: fixture.makeProject(),
      clone: fixture.clone,
      createTemporaryRoot: fixture.createTemporaryRoot,
      run: runner.run,
      gates: [fixtureGate('must-not-run')],
      log: () => {},
    }),
    /packageManager declares pnpm@10\.30\.1, but pnpm --version returned 9\.99\.0/u
  );
  assert.deepEqual(runner.gateCalls, []);
});

test('a gate cannot replace the projected HEAD with another clean commit', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const runner = makeRunner({
    onGate: async (id, options) => {
      if (id !== 'mutate-head') return;
      await write(options.cwd, 'README.md', '# replacement commit\n');
      await git(options.cwd, ['add', 'README.md']);
      await git(options.cwd, ['commit', '--quiet', '-m', 'replace head']);
    },
  });
  const logs = [];

  await assert.rejects(
    runExactPublicRecertification({
      sourceRepo: fixture.parent,
      project: fixture.makeProject(),
      clone: fixture.clone,
      createTemporaryRoot: fixture.createTemporaryRoot,
      run: runner.run,
      gates: [fixtureGate('mutate-head')],
      log: line => logs.push(line),
    }),
    /public gates changed HEAD from [0-9a-f]{40} to [0-9a-f]{40}/u
  );
  assert.equal(
    logs.some(line => line.includes('"status":"passed"')),
    false
  );
});

test('projection receives interruption and its partial output is cleaned', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const controller = new AbortController();
  const interruption = new Error('fixture projection interrupted');

  await assert.rejects(
    runExactPublicRecertification({
      sourceRepo: fixture.parent,
      signal: controller.signal,
      run: async (command, args, options) => {
        assert.equal(command, process.execPath);
        assert.match(args[0], /exact-public-projection-worker\.mjs$/u);
        assert.equal(options.signal, controller.signal);
        const destination = args[3];
        await mkdir(destination, { recursive: true });
        await write(destination, 'partial', 'must be removed\n');
        controller.abort(interruption);
        throw options.signal.reason;
      },
      createTemporaryRoot: fixture.createTemporaryRoot,
      gates: [],
      log: () => {},
    }),
    /fixture projection interrupted/u
  );
  assert.equal(existsSync(fixture.temporaryRoot), false);
});

test('passed evidence is emitted only after temporary cleanup', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const runner = makeRunner();
  let removed = false;

  const evidence = await runExactPublicRecertification({
    sourceRepo: fixture.parent,
    project: fixture.makeProject(),
    clone: fixture.clone,
    createTemporaryRoot: fixture.createTemporaryRoot,
    removeTemporaryRoot: async root => {
      await rm(root, { recursive: true, force: true });
      removed = true;
    },
    run: runner.run,
    gates: [],
    log: line => {
      if (line.includes('"status":"passed"')) assert.equal(removed, true);
    },
  });

  assert.equal(evidence.status, 'passed');
  assert.equal(removed, true);
});

test('cleanup failure emits one failed record and never a passed record', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const runner = makeRunner();
  const logs = [];

  await assert.rejects(
    runExactPublicRecertification({
      sourceRepo: fixture.parent,
      project: fixture.makeProject(),
      clone: fixture.clone,
      createTemporaryRoot: fixture.createTemporaryRoot,
      removeTemporaryRoot: async () => {
        throw new Error('fixture cleanup refused');
      },
      run: runner.run,
      gates: [],
      log: line => logs.push(line),
    }),
    /temporary cleanup failed: fixture cleanup refused/u
  );
  assert.equal(logs.filter(line => line.includes('evidence')).length, 1);
  assert.equal(
    logs.some(line => line.includes('"status":"passed"')),
    false
  );
  assert.ok(
    logs.some(
      line =>
        line.includes('"status":"failed"') &&
        line.includes('temporary cleanup failed')
    )
  );
});

test('gate and cleanup failures are both preserved in one failed record', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const runner = makeRunner({ failGate: 'broken-gate' });
  const logs = [];

  await assert.rejects(
    runExactPublicRecertification({
      sourceRepo: fixture.parent,
      project: fixture.makeProject(),
      clone: fixture.clone,
      createTemporaryRoot: fixture.createTemporaryRoot,
      removeTemporaryRoot: async () => {
        throw new Error('fixture cleanup refused');
      },
      run: runner.run,
      gates: [fixtureGate('broken-gate')],
      log: line => logs.push(line),
    }),
    error => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /fixture failure at broken-gate/u);
      assert.match(error.message, /fixture cleanup refused/u);
      assert.match(error.cause.message, /fixture failure at broken-gate/u);
      return true;
    }
  );
  const evidenceLogs = logs.filter(line => line.includes('evidence'));
  assert.equal(evidenceLogs.length, 1);
  assert.ok(evidenceLogs[0].includes('"status":"failed"'));
  assert.match(evidenceLogs[0], /fixture failure at broken-gate/u);
  assert.match(evidenceLogs[0], /fixture cleanup refused/u);
});

test('a projector failure records failure and cleans its partially written tree', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const logs = [];

  await assert.rejects(
    runExactPublicRecertification({
      sourceRepo: fixture.parent,
      sourceSha: 'bad-source',
      project: async ({ destination }) => {
        await mkdir(destination, { recursive: true });
        await write(destination, 'partial', 'never survives\n');
        throw new Error('projection refused fixture');
      },
      createTemporaryRoot: fixture.createTemporaryRoot,
      gates: [],
      log: line => logs.push(line),
    }),
    /projection refused fixture/u
  );

  assert.ok(
    logs.some(
      line =>
        line.includes('"sourceSha":"bad-source"') &&
        line.includes('"publicSha":null') &&
        line.includes('"status":"failed"')
    )
  );
  assert.equal(existsSync(fixture.temporaryRoot), false);
});

test('aborting a gate terminates its descendant process group before returning', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-recertify-abort-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const grandchild = path.join(root, 'grandchild.mjs');
  const parent = path.join(root, 'parent.mjs');
  const observedExit = path.join(root, 'grandchild-terminated');
  await writeFile(
    grandchild,
    [
      "import { writeFileSync } from 'node:fs';",
      "process.on('SIGTERM', () => {",
      "  writeFileSync(process.argv[2], 'terminated\\n');",
      '  process.exit(0);',
      '});',
      "process.stdout.write('READY\\n');",
      'setInterval(() => {}, 1_000);',
      '',
    ].join('\n')
  );
  await writeFile(
    parent,
    [
      "import { spawn } from 'node:child_process';",
      'const child = spawn(process.execPath, [process.argv[2], process.argv[3]], {',
      "  stdio: ['ignore', 'pipe', 'ignore'],",
      '});',
      'let stopping = false;',
      "process.on('SIGTERM', () => { stopping = true; });",
      "child.on('exit', () => { if (stopping) process.exit(0); });",
      "child.stdout.once('data', chunk => process.stdout.write(chunk));",
      'setInterval(() => {}, 1_000);',
      '',
    ].join('\n')
  );

  const controller = new AbortController();
  await assert.rejects(
    runRecertificationProcess(
      process.execPath,
      [parent, grandchild, observedExit],
      {
        cwd: root,
        env: { PATH: process.env.PATH },
        capture: true,
        signal: controller.signal,
        onStdout: chunk => {
          if (chunk.toString('utf8').includes('READY')) {
            controller.abort(new Error('fixture interruption'));
          }
        },
      }
    ),
    /fixture interruption/u
  );
  assert.equal(await readFile(observedExit, 'utf8'), 'terminated\n');
});

test('a successful parent with a SIGTERM-resistant descendant is killed and rejected', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-recertify-leak-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const grandchild = path.join(root, 'grandchild.mjs');
  const parent = path.join(root, 'parent.mjs');
  const processRecord = path.join(root, 'processes.json');
  const observedTerm = path.join(root, 'grandchild-saw-term');
  await writeFile(
    grandchild,
    [
      "import { writeFileSync } from 'node:fs';",
      "process.on('SIGTERM', () => {",
      "  writeFileSync(process.argv[2], 'term-seen\\n');",
      '});',
      'setInterval(() => {}, 1_000);',
      '',
    ].join('\n')
  );
  await writeFile(
    parent,
    [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      'const child = spawn(process.execPath, [process.argv[2], process.argv[4]], {',
      "  stdio: 'ignore',",
      '});',
      "child.once('spawn', () => {",
      '  writeFileSync(',
      '    process.argv[3],',
      '    JSON.stringify({ group: process.pid, grandchild: child.pid })',
      '  );',
      '  process.exit(0);',
      '});',
      '',
    ].join('\n')
  );

  await assert.rejects(
    runRecertificationProcess(
      process.execPath,
      [parent, grandchild, processRecord, observedTerm],
      {
        cwd: root,
        env: { PATH: process.env.PATH },
        terminationGraceMs: 200,
      }
    ),
    /left descendant processes in group/u
  );

  const record = JSON.parse(await readFile(processRecord, 'utf8'));
  assert.equal(await readFile(observedTerm, 'utf8'), 'term-seen\n');
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,pgid=']);
  const survivingGroup = stdout
    .split('\n')
    .map(line => line.trim().split(/\s+/u).map(Number))
    .some(([, pgid]) => pgid === record.group);
  assert.equal(survivingGroup, false);
});
