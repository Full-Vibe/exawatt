import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  commit,
  createQueueFixture,
  finished,
  write,
} from './lib/delivery-queue-fixture.mjs';
import { SURFACE_GATES, gateNeedsDevServer } from './lib/delivery-policy.mjs';
import { readDeliveryMetrics } from './lib/delivery-state.mjs';
import {
  DEV_IDENTITY,
  readDevServerIdentity,
} from './lib/dev-server-identity.mjs';
import { git, hermeticGitEnv } from './lib/hermetic-git.mjs';
import { serverStaleness } from './lib/landing-dev-server.mjs';

/**
 * BUG-246: the landing owns the dev server its surface gates read. A rebase
 * under a live `pnpm dev` left Turbopack serving the old tree: BUG-244's
 * second landing attempt failed `eval:electron:delegation` and passed after a
 * clean restart. Before a gate that reads the server, the landing restarts a
 * server that started before a rebase, and refuses one it does not own and
 * cannot prove fresh.
 *
 * The stand-in dev server reports the commit it started from, exactly as
 * `/api/dev-identity` does, and the stand-in gate fails unless that commit is
 * HEAD, so a stale server fails the gate here as it did in BUG-244.
 */

const GATE = 'eval:roadmap:rail';
const RAIL_FILE = 'src/components/roadmap/rail.tsx';
const DECLARE = ['--verify', GATE];

// The stand-ins read HEAD through the hermetic helper, as test code must.
const HERMETIC_GIT = new URL('./lib/hermetic-git.mjs', import.meta.url).href;

const DEV_SERVER = `import { appendFileSync } from 'node:fs';
import http from 'node:http';
import { git } from '${HERMETIC_GIT}';

const args = process.argv.slice(2);
let port = 0;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '-p') port = Number(args[index + 1]);
}
const sourceHead = git(process.cwd(), ['rev-parse', 'HEAD']);
appendFileSync(process.env.FIXTURE_DEV_PIDS, process.pid + '\\n');
http
  .createServer((request, response) => {
    if (request.url !== '/api/dev-identity') {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({ repoRoot: process.cwd(), distributionDigest: null, sourceHead })
    );
  })
  .listen(port);
`;

const GATE_PROBE = `import { appendFileSync } from 'node:fs';
import { git } from '${HERMETIC_GIT}';

const head = git(process.cwd(), ['rev-parse', 'HEAD']);
const response = await fetch(process.env.EXA_BASE + '/api/dev-identity');
const { sourceHead } = await response.json();
const verdict = sourceHead === head ? 'HEAD' : 'STALE';
appendFileSync(process.env.FIXTURE_PNPM_LOG, 'gate served ' + verdict + '\\n');
if (verdict !== 'HEAD') {
  console.error('stale dev server: it serves ' + sourceHead + ', HEAD is ' + head);
  process.exit(1);
}
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ port: 0 }, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function lines(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tickets(root) {
  const queue = path.join(root, '.git', 'exawatt-delivery', 'queue');
  if (!existsSync(queue)) return [];
  return readdirSync(queue)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(path.join(queue, file), 'utf8')));
}

async function serverFixture(prefix) {
  const fixture = createQueueFixture(prefix, {
    scripts: { [GATE]: 'node -e "process.exit(0)"' },
    files: { '.gitignore': 'node_modules/\n.next/\ndist-electron/\n' },
  });
  const server = fixture.at('dev-server.mjs');
  const probe = fixture.at('gate-probe.mjs');
  writeFileSync(server, DEV_SERVER);
  writeFileSync(probe, GATE_PROBE);
  const port = await freePort();
  const pids = fixture.at('dev-pids.log');
  const log = fixture.at('pnpm.log');
  const base = `http://127.0.0.1:${port}`;
  const env = {
    EXA_BASE: base,
    FIXTURE_PNPM_LOG: log,
    FIXTURE_DEV_SERVER_SCRIPT: server,
    FIXTURE_GATE_PROBE: probe,
    FIXTURE_DEV_PIDS: pids,
    EXAWATT_AGENT_LAND_PROBE_SECONDS: '0',
  };
  return {
    fixture,
    port,
    base,
    log,
    env,
    /** The server an author left running, started from `cwd`'s HEAD. */
    async startAuthorServer(cwd) {
      const child = spawn(process.execPath, [server, '-p', String(port)], {
        cwd,
        detached: true,
        stdio: 'ignore',
        env: hermeticGitEnv({ FIXTURE_DEV_PIDS: pids }),
      });
      let exited = false;
      child.once('exit', () => {
        exited = true;
      });
      child.unref();
      // Wait for the effect: the server answering, or its exit.
      while (
        (await readDevServerIdentity(base)).kind !== DEV_IDENTITY.IDENTIFIED
      ) {
        if (exited) throw new Error('the stand-in dev server exited');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return child.pid;
    },
    cleanup() {
      for (const pid of lines(pids).map(Number)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
        }
      }
      fixture.cleanup();
    },
  };
}

test('a queue rebase that moves files under a gate restarts its dev server exactly once, before the gate, and says so', async () => {
  const setup = await serverFixture('exawatt-fresh-server-rebase-');
  const { fixture, log, port } = setup;
  try {
    const worktree = fixture.agentWorktree('agent/fresh-server', {
      [RAIL_FILE]: 'export const rail = 1;\n',
    });
    // What Turbopack and `electron:compile` had built from the old tree.
    write(worktree, '.next/dev/stale-chunk.js', '// old tree\n');
    write(worktree, 'dist-electron/main/main.js', '// old main\n');
    const author = await setup.startAuthorServer(worktree);
    // Another landing moves the gate's surface and the Electron main.
    fixture.advanceMaster({
      'src/components/roadmap/other.tsx': 'export const other = 1;\n',
      'electron/main/other.ts': 'export const other = 1;\n',
    });

    const landed = await finished(fixture.land(worktree, DECLARE, setup.env));
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);

    const calls = lines(log);
    const starts = calls.filter(line => line.startsWith('dev '));
    assert.deepEqual(starts, [`dev -p ${port}`], calls.join('\n'));
    const gates = calls.flatMap((line, index) =>
      line === `run ${GATE}` ? [index] : []
    );
    assert.equal(gates.length, 2, 'candidate and rebase');
    const restart = calls.indexOf(`dev -p ${port}`);
    const compile = calls.indexOf('electron:compile');
    assert.ok(gates[0] < compile && compile < restart && restart < gates[1]);
    assert.deepEqual(
      calls.filter(line => line.startsWith('gate served')),
      ['gate served HEAD', 'gate served HEAD'],
      'each run of the gate read a server serving the tree it checked'
    );
    assert.equal(alive(author), false, "the author's stale server was stopped");
    assert.equal(
      existsSync(path.join(worktree, '.next', 'dev')),
      false,
      '.next/dev was cleared'
    );
    assert.match(landed.output, /STATUS .* server_refreshed=rebase(?:\s|$)/u);

    const refreshed = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'server_refreshed'
    );
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0].phase, 'rebase');
    assert.equal(refreshed[0].reason, 'rebased');
    assert.equal(refreshed[0].gate, GATE);
    assert.equal(refreshed[0].electronRecompiled, true);
    assert.equal(refreshed[0].toHead, fixture.originMaster());
    assert.ok(refreshed[0].ticketId);
  } finally {
    setup.cleanup();
  }
});

test('a queue rebase that leaves the gate standing leaves its dev server alone', async () => {
  const setup = await serverFixture('exawatt-fresh-server-none-');
  const { fixture, log } = setup;
  try {
    const worktree = fixture.agentWorktree('agent/server-stands', {
      [RAIL_FILE]: 'export const rail = 1;\n',
    });
    const author = await setup.startAuthorServer(worktree);
    fixture.advanceMaster({ 'docs/unrelated.md': '# Unrelated\n' });

    const landed = await finished(fixture.land(worktree, DECLARE, setup.env));
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);
    const calls = lines(log);
    assert.deepEqual(
      calls.filter(line => line.startsWith('dev ')),
      [],
      calls.join('\n')
    );
    assert.deepEqual(
      calls.filter(line => line.startsWith('gate served')),
      ['gate served HEAD']
    );
    assert.equal(alive(author), true);
    assert.doesNotMatch(landed.output, /server_refreshed/u);
    const refreshed = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'server_refreshed'
    );
    assert.deepEqual(refreshed, []);
  } finally {
    setup.cleanup();
  }
});

test('a dev server that does not come back stops the landing with a named cause', async () => {
  const setup = await serverFixture('exawatt-fresh-server-dead-');
  const { fixture, log } = setup;
  try {
    const worktree = fixture.agentWorktree('agent/server-dead', {
      [RAIL_FILE]: 'export const rail = 1;\n',
    });
    await setup.startAuthorServer(worktree);
    fixture.advanceMaster({
      'src/components/roadmap/other.tsx': 'export const other = 1;\n',
    });

    const landed = await finished(
      fixture.land(worktree, DECLARE, {
        ...setup.env,
        FIXTURE_DEV_FAILS: '1',
      })
    );
    assert.notEqual(landed.code, 0);
    assert.match(
      landed.output,
      new RegExp(
        `the dev server at ${setup.base.replaceAll('.', '\\.')} did not come back after the rebase refresh: \`pnpm dev\` exited 1 before it served`,
        'u'
      )
    );
    assert.match(landed.output, new RegExp(`${GATE} did not run`, 'u'));
    assert.equal(
      lines(log).filter(line => line === `run ${GATE}`).length,
      1,
      'the gate never ran against a server that was not there'
    );
    const failed = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'server_refresh_failed'
    );
    assert.equal(failed.length, 1);
    assert.equal(failed[0].phase, 'rebase');
    assert.deepEqual(
      tickets(fixture.main).map(ticket => ticket.status),
      ['failed']
    );
  } finally {
    setup.cleanup();
  }
});

test('an author who rebased under a running server gets it restarted before the first gate', async () => {
  const setup = await serverFixture('exawatt-fresh-server-admission-');
  const { fixture, log, port } = setup;
  try {
    const worktree = fixture.agentWorktree('agent/server-admission', {
      [RAIL_FILE]: 'export const rail = 1;\n',
    });
    const author = await setup.startAuthorServer(worktree);
    fixture.advanceMaster({
      'src/components/roadmap/other.tsx': 'export const other = 1;\n',
    });
    git(worktree, ['fetch', '--quiet', 'origin', 'master']);
    git(worktree, ['rebase', '--quiet', 'origin/master']);

    const landed = await finished(fixture.land(worktree, DECLARE, setup.env));
    assert.equal(landed.code, 0, landed.output);
    assert.doesNotMatch(landed.output, /rebase onto/u);
    const calls = lines(log);
    assert.deepEqual(
      calls.filter(line => line.startsWith('dev ')),
      [`dev -p ${port}`]
    );
    assert.ok(calls.indexOf(`dev -p ${port}`) < calls.indexOf(`run ${GATE}`));
    assert.deepEqual(
      calls.filter(line => line.startsWith('gate served')),
      ['gate served HEAD']
    );
    assert.equal(alive(author), false);
    assert.match(
      landed.output,
      /STATUS .* server_refreshed=candidate(?:\s|$)/u
    );
  } finally {
    setup.cleanup();
  }
});

test('a server another checkout owns is refused, never restarted, before anything is queued', async () => {
  const setup = await serverFixture('exawatt-fresh-server-foreign-');
  const { fixture, log } = setup;
  try {
    const worktree = fixture.agentWorktree('agent/server-foreign', {
      [RAIL_FILE]: 'export const rail = 1;\n',
    });
    const foreign = await setup.startAuthorServer(fixture.main);

    const landed = await finished(fixture.land(worktree, DECLARE, setup.env));
    assert.notEqual(landed.code, 0);
    assert.match(
      landed.output,
      new RegExp(
        `refusing to run ${GATE} against \\S+: it serves \\S+main, not`,
        'u'
      )
    );
    assert.equal(
      alive(foreign),
      true,
      'a server this worktree does not own is never stopped'
    );
    assert.deepEqual(
      lines(log).filter(line => line.startsWith('dev ')),
      []
    );
    assert.deepEqual(
      lines(log).filter(line => line === `run ${GATE}`),
      []
    );
    assert.deepEqual(tickets(fixture.main), [], 'nothing was queued');
    const refused = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'server_refused'
    );
    assert.equal(refused.length, 1);
    assert.equal(refused[0].phase, 'candidate');
  } finally {
    setup.cleanup();
  }
});

test('a free local port gets a server started there before the first gate', async () => {
  const setup = await serverFixture('exawatt-fresh-server-start-');
  const { fixture, log, port } = setup;
  try {
    const worktree = fixture.agentWorktree('agent/server-start', {
      [RAIL_FILE]: 'export const rail = 1;\n',
    });
    const landed = await finished(fixture.land(worktree, DECLARE, setup.env));
    assert.equal(landed.code, 0, landed.output);
    assert.deepEqual(
      lines(log).filter(line => line.startsWith('dev ')),
      [`dev -p ${port}`]
    );
    assert.match(landed.output, /is not running; restarting it/u);
    const [refreshed] = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'server_refreshed'
    );
    assert.equal(refreshed.reason, 'not-running');
    assert.equal(refreshed.phase, 'candidate');
  } finally {
    setup.cleanup();
  }
});

function staleTree() {
  const root = mkdtempSync(path.join(tmpdir(), 'exa-fresh-server-unit-'));
  git(root, ['init', '--quiet', '--initial-branch=master']);
  git(root, ['config', 'user.name', 'Fixture Author']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  write(root, 'src/own.ts', 'export const own = 0;\n');
  write(root, 'src/upstream.ts', 'export const upstream = 0;\n');
  const start = commit(root, 'start');
  return { root, start };
}

test('a server is trusted only from an ancestor of HEAD with every later path the change’s own', async () => {
  const { root, start } = staleTree();
  const own = ['src/own.ts'];
  assert.deepEqual(
    await serverStaleness(root, { sourceHead: start, ownPaths: own }),
    { stale: false },
    'started on this exact tree'
  );
  write(root, 'src/own.ts', 'export const own = 1;\n');
  const edited = commit(root, 'own edit');
  assert.deepEqual(
    await serverStaleness(root, { sourceHead: start, ownPaths: own }),
    { stale: false },
    'the change’s own edits since the server started'
  );
  write(root, 'src/upstream.ts', 'export const upstream = 1;\n');
  commit(root, 'merged upstream');
  assert.deepEqual(
    await serverStaleness(root, { sourceHead: edited, ownPaths: own }),
    { stale: true, reason: 'merged', movedPaths: ['src/upstream.ts'] }
  );
  git(root, ['reset', '--quiet', '--hard', start]);
  write(root, 'src/own.ts', 'export const own = 2;\n');
  commit(root, 'rewritten');
  assert.equal(
    (await serverStaleness(root, { sourceHead: edited, ownPaths: own })).reason,
    'rebased'
  );
  assert.equal(
    (await serverStaleness(root, { sourceHead: null, ownPaths: own })).reason,
    'unstamped'
  );
  assert.equal(
    (await serverStaleness(root, { sourceHead: 'f'.repeat(40), ownPaths: own }))
      .reason,
    'unknown-commit'
  );
});

test('every gate but a packaged one waits for the server, and a packaged one never reads EXA_BASE', () => {
  const scripts = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ).scripts;
  for (const entry of SURFACE_GATES) {
    assert.equal(
      gateNeedsDevServer(entry.gate),
      entry.server !== 'packaged',
      entry.gate
    );
    if (entry.server !== 'packaged') continue;
    // Refusing or restarting a dev server for a gate that never reads one
    // would block a landing for nothing.
    const [, file] = scripts[entry.gate].match(/node (?:--\S+ )*(\S+\.mjs)/u);
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /EXA_BASE|EXAWATT_DEV_URL/u, entry.gate);
  }
  assert.equal(
    gateNeedsDevServer('lint'),
    false,
    'a floor check is not a gate'
  );
});
