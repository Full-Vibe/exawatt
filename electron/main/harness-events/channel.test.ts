import { networkInterfaces } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { HarnessEventChannel } from './channel';
import { claudeHookEvent } from './claude-hooks';
import type { HarnessEvent } from './delegation-state';

/**
 * The channel against a REAL loopback listener (ENG-023 D1). The security and
 * fail-open properties here are the ones that decide whether this is safe to
 * put in front of a user's agent, so they are exercised over actual HTTP
 * rather than asserted against a mock.
 */

let channel: HarnessEventChannel | null = null;

afterEach(() => {
  channel?.stop();
  channel = null;
});

async function started(): Promise<HarnessEventChannel> {
  channel = new HarnessEventChannel({ now: () => 1_000 });
  expect(await channel.start()).toBe(true);
  return channel;
}

function collect(target: HarnessEventChannel): Array<[string, HarnessEvent]> {
  const seen: Array<[string, HarnessEvent]> = [];
  target.on('event', (id: string, event: HarnessEvent) =>
    seen.push([id, event])
  );
  return seen;
}

async function post(
  registration: { port: number },
  body: unknown,
  headers: Record<string, string> = {}
): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${registration.port}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  await response.text();
  return response.status;
}

describe('HarnessEventChannel', () => {
  it('routes a token to its Session and normalizes the payload', async () => {
    const target = await started();
    const seen = collect(target);
    const registration = target.register('pty-1', claudeHookEvent)!;
    expect(registration).toBeTruthy();

    expect(
      await post(
        registration,
        {
          hook_event_name: 'SubagentStart',
          agent_id: 'a1',
          agent_type: 'Explore',
        },
        { 'x-exawatt-token': registration.token }
      )
    ).toBe(200);

    expect(seen).toEqual([
      [
        'pty-1',
        { kind: 'child-start', childId: 'a1', agentType: 'Explore', at: 1_000 },
      ],
    ]);
  });

  it('keeps two live Sessions apart', async () => {
    const target = await started();
    const seen = collect(target);
    const one = target.register('pty-1', claudeHookEvent)!;
    const two = target.register('pty-2', claudeHookEvent)!;
    expect(one.token).not.toBe(two.token);

    await post(
      one,
      { hook_event_name: 'Stop' },
      { 'x-exawatt-token': one.token }
    );
    await post(
      two,
      { hook_event_name: 'Stop' },
      { 'x-exawatt-token': two.token }
    );

    expect(seen.map(([id]) => id)).toEqual(['pty-1', 'pty-2']);
  });

  it('refuses an absent, wrong, or released token', async () => {
    const target = await started();
    const seen = collect(target);
    const registration = target.register('pty-1', claudeHookEvent)!;

    expect(await post(registration, { hook_event_name: 'Stop' })).toBe(404);
    expect(
      await post(
        registration,
        { hook_event_name: 'Stop' },
        { 'x-exawatt-token': 'guessed' }
      )
    ).toBe(404);

    target.release('pty-1');
    expect(
      await post(
        registration,
        { hook_event_name: 'Stop' },
        { 'x-exawatt-token': registration.token }
      )
    ).toBe(404);
    expect(seen).toEqual([]);
  });

  it('retires the previous token when a Session relaunches', async () => {
    const target = await started();
    const seen = collect(target);
    const first = target.register('pty-1', claudeHookEvent)!;
    const second = target.register('pty-1', claudeHookEvent)!;

    expect(
      await post(
        first,
        { hook_event_name: 'Stop' },
        { 'x-exawatt-token': first.token }
      )
    ).toBe(404);
    expect(
      await post(
        second,
        { hook_event_name: 'Stop' },
        { 'x-exawatt-token': second.token }
      )
    ).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it('answers a malformed body without emitting or throwing', async () => {
    const target = await started();
    const seen = collect(target);
    const registration = target.register('pty-1', claudeHookEvent)!;
    expect(
      await post(registration, '{not json', {
        'x-exawatt-token': registration.token,
      })
    ).toBe(200);
    expect(seen).toEqual([]);
  });

  it('drops an oversized body instead of buffering it', async () => {
    const target = await started();
    const seen = collect(target);
    const oversized: number[] = [];
    target.on('oversized', () => oversized.push(1));
    const registration = target.register('pty-1', claudeHookEvent)!;
    expect(
      await post(
        registration,
        JSON.stringify({
          hook_event_name: 'Stop',
          filler: 'x'.repeat(5 * 1024 * 1024),
        }),
        { 'x-exawatt-token': registration.token }
      )
    ).toBe(200);
    expect(seen).toEqual([]);
    expect(oversized).toHaveLength(1);
  });

  it('ignores non-POST traffic', async () => {
    const target = await started();
    const registration = target.register('pty-1', claudeHookEvent)!;
    const response = await fetch(`http://127.0.0.1:${registration.port}/hook`, {
      headers: { 'x-exawatt-token': registration.token },
    });
    await response.text();
    expect(response.status).toBe(404);
  });

  it('binds loopback only', async () => {
    // A listener reachable from the LAN would expose an event sink to the
    // network, so the bind address is asserted rather than assumed. Probing
    // 0.0.0.0 would prove nothing — the OS routes it back to this host — so
    // this dials a real external interface. Skipped, visibly, on a host that
    // has none (some CI containers).
    const external = Object.values(networkInterfaces())
      .flat()
      .find(item => item && item.family === 'IPv4' && !item.internal);
    if (!external) {
      expect(external).toBeUndefined();
      return;
    }
    const target = await started();
    const registration = target.register('pty-1', claudeHookEvent)!;
    await expect(
      fetch(`http://${external.address}:${registration.port}/hook`, {
        method: 'POST',
        body: '{}',
        signal: AbortSignal.timeout(1_500),
      })
    ).rejects.toThrow();
  });

  it('survives a client that hangs up mid-request', async () => {
    // `error` and `end` can both fire for one request. A second response would
    // throw ERR_HTTP_HEADERS_SENT inside an event handler, and an uncaught
    // throw here would take down the main process over a hook delivery.
    const target = await started();
    const registration = target.register('pty-1', claudeHookEvent)!;
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      const controller = new AbortController();
      const inflight = fetch(`http://127.0.0.1:${registration.port}/hook`, {
        method: 'POST',
        headers: { 'x-exawatt-token': registration.token },
        body: JSON.stringify({ hook_event_name: 'Stop' }),
        signal: controller.signal,
      }).catch(() => undefined);
      controller.abort();
      await inflight;
      await new Promise(done => setTimeout(done, 150));
    } finally {
      process.off('uncaughtException', onUncaught);
    }
    expect(uncaught).toEqual([]);
    // and the channel still serves the next request
    expect(
      await post(
        registration,
        { hook_event_name: 'Stop' },
        { 'x-exawatt-token': registration.token }
      )
    ).toBe(200);
  });

  it('registers nothing before it is listening, so a launch just goes unwatched', () => {
    const idle = new HarnessEventChannel();
    expect(idle.listening).toBe(false);
    expect(idle.register('pty-1', claudeHookEvent)).toBeNull();
  });

  it('is safe to start twice', async () => {
    const target = await started();
    const port = target.register('pty-1', claudeHookEvent)!.port;
    expect(await target.start()).toBe(true);
    expect(target.register('pty-2', claudeHookEvent)!.port).toBe(port);
  });
});
