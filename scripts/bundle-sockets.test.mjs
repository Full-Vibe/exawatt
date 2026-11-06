import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  parseBundleSockets,
  sampleBundleSockets,
} from './lib/bundle-sockets.mjs';

// The community network check finds the app's processes by executable image
// (BUG-337). These run real processes: one inside a bundle that renames
// itself the way Next's server does, and one outside it that names itself
// after the bundle.

const macOnly = process.platform !== 'darwin' && 'lsof sampling is macOS-only';

/**
 * A bundle whose executable is this Node: a clone of the binary, with its
 * `../lib` beside it for a Node that loads `libnode` from there.
 */
function fakeBundle(root) {
  const bundle = join(root, 'Fake.app');
  const macos = join(bundle, 'Contents', 'MacOS');
  mkdirSync(macos, { recursive: true });
  const node = realpathSync(process.execPath);
  copyFileSync(node, join(macos, 'node'), constants.COPYFILE_FICLONE);
  symlinkSync(
    join(dirname(node), '..', 'lib'),
    join(bundle, 'Contents', 'lib')
  );
  return { bundle: realpathSync(bundle), executable: join(macos, 'node') };
}

/** A process that sets `title`, connects to `port`, and holds the socket. */
function connectedProcess(executable, title, port) {
  const child = spawn(
    executable,
    [
      '-e',
      `process.title = ${JSON.stringify(title)};
require('net').connect(${port}, '127.0.0.1', () => console.log('connected'));
setInterval(() => {}, 60000);`,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`exited with ${code}`)));
    child.stdout.on('data', data => {
      if (String(data).includes('connected')) resolve();
    });
  });
  return { child, ready };
}

async function listener() {
  const held = new Set();
  const server = createServer(socket => {
    held.add(socket);
    socket.on('error', () => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    async close() {
      for (const socket of held) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

const listedCommand = pid =>
  execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], {
    encoding: 'utf8',
  }).trim();

test(
  'finds a bundle process that renamed itself, and never a stranger named after the bundle',
  { skip: macOnly },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'bundle-sockets-'));
    const sink = await listener();
    const children = [];
    try {
      const { bundle, executable } = fakeBundle(root);
      const server = connectedProcess(
        executable,
        'next-server (v16.4.2)',
        sink.port
      );
      const stranger = connectedProcess(
        process.execPath,
        `${bundle}/Contents/MacOS/node`,
        sink.port
      );
      children.push(server.child, stranger.child);
      await Promise.all([server.ready, stranger.ready]);
      // The listing the check used to trust says the opposite of the truth.
      assert.equal(listedCommand(server.child.pid), 'next-server (v16.4.2)');
      assert.ok(listedCommand(stranger.child.pid).startsWith(bundle));

      const sample = await sampleBundleSockets(bundle);

      assert.deepEqual(sample.pids, [server.child.pid]);
      assert.deepEqual(sample.peers, [
        {
          pid: server.child.pid,
          command: 'node',
          address: '127.0.0.1',
          port: sink.port,
          raw: `127.0.0.1:${sink.port}`,
        },
      ]);
    } finally {
      for (const child of children) child.kill('SIGKILL');
      await sink.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('reads each process’s image and sockets from its own entry', () => {
  const bundle = '/Applications/Exawatt Community.app';
  const output = [
    'p101',
    'fcwd',
    'tDIR',
    'n/',
    'ftxt',
    'tREG',
    `n${bundle}/Contents/Frameworks/Exawatt Community Helper.app/Contents/MacOS/Exawatt Community Helper`,
    'ftxt',
    'tREG',
    'n/usr/lib/dyld',
    'f20',
    'tIPv4',
    'n127.0.0.1:51000',
    'f21',
    'tIPv4',
    'n127.0.0.1:51000->127.0.0.1:52000',
    'f22',
    'tunix',
    'n->0x1234',
    'f23',
    'tIPv6',
    'n[2001:db8::1]:50000->[2606:4700::1]:443 (ESTABLISHED)',
    'p202',
    'ftxt',
    'tREG',
    `n/opt/homebrew/bin/node`,
    'f9',
    'tIPv4',
    'n10.0.0.2:50001->93.184.216.34:443',
  ].join('\n');

  assert.deepEqual(parseBundleSockets(output, bundle), {
    pids: [101],
    peers: [
      {
        pid: 101,
        command: 'Exawatt Community Helper',
        address: '127.0.0.1',
        port: 52000,
        raw: '127.0.0.1:52000',
      },
      {
        pid: 101,
        command: 'Exawatt Community Helper',
        address: '[2606:4700::1]',
        port: 443,
        raw: '[2606:4700::1]:443',
      },
    ],
  });
});
