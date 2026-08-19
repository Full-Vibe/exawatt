// ENG-022 H13 regression pins. One reader answers "what does this port serve?",
// and the rule that matters is that only a POSITIVE identification counts as
// this checkout — an unreachable, unhealthy, or unnameable server is never
// adopted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import {
  DEV_IDENTITY,
  findServerForCheckout,
  firstFreePort,
  isPortFree,
  readDevServerIdentity,
  servesCheckout,
} from './lib/dev-server-identity.mjs';

function listen(handler) {
  return new Promise(resolve => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })
    );
  });
}

test('a server that names its checkout is IDENTIFIED', async () => {
  const { server, origin } = await listen((_q, s) => {
    s.setHeader('content-type', 'application/json');
    s.end(JSON.stringify({ repoRoot: '/tmp/tree-a', distributionDigest: 'abc' }));
  });
  try {
    const identity = await readDevServerIdentity(origin);
    assert.equal(identity.kind, DEV_IDENTITY.IDENTIFIED);
    assert.equal(identity.repoRoot, '/tmp/tree-a');
    assert.equal(identity.distributionDigest, 'abc');
  } finally {
    server.close();
  }
});

test('404 is UNVERIFIABLE, not unhealthy and not a mismatch', async () => {
  const { server, origin } = await listen((_q, s) => {
    s.statusCode = 404;
    s.end();
  });
  try {
    assert.equal(
      (await readDevServerIdentity(origin)).kind,
      DEV_IDENTITY.UNVERIFIABLE
    );
  } finally {
    server.close();
  }
});

test('a 500 is UNHEALTHY and carries its status', async () => {
  const { server, origin } = await listen((_q, s) => {
    s.statusCode = 500;
    s.end();
  });
  try {
    const identity = await readDevServerIdentity(origin);
    assert.equal(identity.kind, DEV_IDENTITY.UNHEALTHY);
    assert.equal(identity.status, 500);
  } finally {
    server.close();
  }
});

test('nothing listening is UNREACHABLE, distinct from every served answer', async () => {
  const { server, origin } = await listen(() => {});
  server.close();
  assert.equal(
    (await readDevServerIdentity(origin, { timeoutMs: 1_000 })).kind,
    DEV_IDENTITY.UNREACHABLE
  );
});

test('only a positive identification serves this checkout', () => {
  const realpath = value => value;
  assert.equal(
    servesCheckout(
      { kind: DEV_IDENTITY.IDENTIFIED, repoRoot: '/tree-a' },
      '/tree-a',
      { realpath }
    ),
    true
  );
  assert.equal(
    servesCheckout(
      { kind: DEV_IDENTITY.IDENTIFIED, repoRoot: '/tree-b' },
      '/tree-a',
      { realpath }
    ),
    false
  );
  // The defect H13 fixes: an unverifiable server must NOT read as ours.
  assert.equal(
    servesCheckout({ kind: DEV_IDENTITY.UNVERIFIABLE }, '/tree-a', { realpath }),
    false
  );
  assert.equal(
    servesCheckout({ kind: DEV_IDENTITY.UNREACHABLE }, '/tree-a', { realpath }),
    false
  );
  assert.equal(
    servesCheckout(
      { kind: DEV_IDENTITY.IDENTIFIED, repoRoot: null },
      '/tree-a',
      { realpath }
    ),
    false
  );
});

test('discovery steps over a foreign server and reports why', async () => {
  const answers = {
    'http://localhost:7000': { kind: DEV_IDENTITY.IDENTIFIED, repoRoot: '/other' },
    'http://localhost:7090': { kind: DEV_IDENTITY.UNREACHABLE },
    'http://localhost:3000': { kind: DEV_IDENTITY.IDENTIFIED, repoRoot: '/mine' },
  };
  const found = await findServerForCheckout([7000, 7090, 3000], '/mine', {
    read: async origin => answers[origin],
    realpath: value => value,
  });
  assert.equal(found.port, 3000);
  assert.deepEqual(found.rejected, [
    { port: 7000, kind: DEV_IDENTITY.IDENTIFIED, repoRoot: '/other' },
  ]);
});

test('discovery finds nothing when every candidate is foreign', async () => {
  const found = await findServerForCheckout([7000, 7090], '/mine', {
    read: async () => ({ kind: DEV_IDENTITY.IDENTIFIED, repoRoot: '/other' }),
    realpath: value => value,
  });
  assert.equal(found.port, null);
  assert.equal(found.rejected.length, 2);
});

test('a free port is chosen over an occupied one', async () => {
  const { server, origin } = await listen(() => {});
  const taken = Number(new URL(origin).port);
  try {
    assert.equal(await isPortFree(taken), false);
    const chosen = await firstFreePort([taken, 0], {
      free: async port => port !== taken,
    });
    assert.equal(chosen, 0);
  } finally {
    server.close();
  }
});

test('a port held on the IPv6 wildcard reads as OCCUPIED, not free', async () => {
  // The dual-stack trap: `next dev` listens on *:<port>, and a probe bound to
  // 127.0.0.1 succeeds beside it on macOS — the launcher then picks a port it
  // collides with. Caught live against a foreign dev server on 7000.
  const wildcard = createServer(() => {});
  await new Promise(resolve => wildcard.listen(0, resolve));
  const port = wildcard.address().port;
  try {
    assert.equal(await isPortFree(port), false);
  } finally {
    wildcard.close();
  }
});

test('no free candidate reports null rather than a wrong port', async () => {
  assert.equal(await firstFreePort([1, 2], { free: async () => false }), null);
});
