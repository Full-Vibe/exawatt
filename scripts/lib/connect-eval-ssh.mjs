#!/usr/bin/env node
/**
 * A stand-in `ssh` for the Connect eval (ENG-033 H2.4 P5).
 *
 * The eval puts this first on the app's PATH, so the real Connect flow, the
 * real tunnel owner, and the real remote exec all spawn it exactly as they
 * spawn `ssh`, and nothing reaches a network. It answers the two forms
 * Exawatt uses and nothing else:
 *
 * - the tunnel, `ssh -N … -L 127.0.0.1:<local>:<host>:<port> -- <alias>`,
 *   forwarded to a `ConnectedGatewayFixture` on loopback;
 * - one bounded command, `ssh -T … -- <alias> <argv…>`, for the four reads
 *   and one write Exawatt runs on a source: its config, its version, and its
 *   own `openclaw devices list --json` and `openclaw devices approve <id>`,
 *   which go to the eval's control port so the fixture keeps the pairing
 *   state.
 *
 * Every login is appended to the eval's log, which is how the eval counts
 * what a flow costs on the operator's servers.
 */
import net from 'node:net';
import { appendFileSync, readFileSync } from 'node:fs';

const config = JSON.parse(
  readFileSync(process.env.CONNECT_EVAL_SSH_CONFIG, 'utf8')
);
const args = process.argv.slice(2);
const dash = args.indexOf('--');
const alias = dash >= 0 ? args[dash + 1] : args.at(-1);
const argv = dash >= 0 ? args.slice(dash + 2) : [];
const tunnel = args.includes('-N');
const host = config.hosts[alias];

appendFileSync(config.logPath, `${JSON.stringify({ alias, tunnel, argv })}\n`);

if (!host || host.unreachable) {
  process.stderr.write(
    `ssh: connect to host ${alias} port 22: Connection refused\n`
  );
  process.exit(255);
}

if (tunnel) {
  const [, localPort] = args[args.indexOf('-L') + 1].split(':');
  const server = net.createServer(client => {
    const upstream = net.connect(host.port, '127.0.0.1');
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.pipe(upstream).pipe(client);
    client.on('error', close);
    upstream.on('error', close);
  });
  server.listen(Number(localPort), '127.0.0.1');
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else {
  const command = argv.join(' ');
  const control = path =>
    `${config.controlUrl}${path}${path.includes('?') ? '&' : '?'}alias=${encodeURIComponent(alias)}`;
  if (command === 'cat .openclaw/openclaw.json') {
    process.stdout.write(
      JSON.stringify({
        gateway: {
          port: host.port,
          bind: 'loopback',
          auth: { mode: 'token', token: host.token },
        },
      })
    );
    process.exit(0);
  }
  if (command === 'openclaw --version') {
    process.stdout.write('OpenClaw 2026.7.1-2 (eval)\n');
    process.exit(0);
  }
  if (command === 'openclaw devices list --json') {
    const answer = await fetch(control('/list'));
    process.stdout.write(await answer.text());
    process.exit(answer.ok ? 0 : 1);
  }
  if (argv.length === 4 && command.startsWith('openclaw devices approve ')) {
    const answer = await fetch(
      control(`/approve?id=${encodeURIComponent(argv[3])}`),
      { method: 'POST' }
    );
    if (answer.ok) process.stdout.write('{}\n');
    else process.stderr.write('unknown requestId\n');
    process.exit(answer.ok ? 0 : 1);
  }
  process.stderr.write(`connect eval ssh: unsupported command: ${command}\n`);
  process.exit(127);
}
