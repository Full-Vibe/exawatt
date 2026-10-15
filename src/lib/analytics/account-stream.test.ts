import { describe, expect, it, vi } from 'vitest';
import { startAccountStream, type AccountSubscription } from './account-stream';
import { ACCOUNT_STREAM_EVENTS } from './events';
import { EVERY_ANALYTICS_EVENT } from './examples.test-support';
import { ingestBatchUrl, sendToIngest, type IngestRecord } from './ingest';

const TARGET = { apiHost: 'https://ingest.example.test/ingest', key: 'phc_test' };
const ACCOUNT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const INSTALLATION = '0b8e4f5e-3c1d-4a2b-9f6e-7d8c9b0a1e2f';

function harness() {
  let answer: ((id: string | null) => void) | null = null;
  const subscribe: AccountSubscription = onAccount => {
    answer = onAccount;
    return () => {
      answer = null;
    };
  };
  const sent: IngestRecord[][] = [];
  const send = vi.fn(async (_target, records: readonly IngestRecord[]) => {
    sent.push([...records]);
    return true;
  });
  const stream = startAccountStream(TARGET, { subscribe, send });
  return {
    stream,
    sent,
    signIn: (id: string | null) => answer?.(id),
  };
}

const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('the signed-in account stream (decision 0053, F5)', () => {
  it('carries the activity events under the account id, and nothing else', async () => {
    const { stream, sent, signIn } = harness();
    signIn(ACCOUNT);
    for (const event of EVERY_ANALYTICS_EVENT) stream.capture(event);
    await flush();
    const records = sent.flat();
    expect(records.map(record => record.event).sort()).toEqual(
      [...ACCOUNT_STREAM_EVENTS].sort()
    );
    for (const record of records) {
      expect(record.distinctId).toBe(ACCOUNT);
      expect(
        Object.keys(record.properties).filter(key => key.startsWith('$'))
      ).toEqual(['$lib']);
    }
  });

  it('never carries the installation id, the SDK device id or a session id', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 200 })
    );
    let answer: (id: string | null) => void = () => undefined;
    const stream = startAccountStream(TARGET, {
      subscribe: onAccount => {
        answer = onAccount;
        return () => undefined;
      },
      send: (target, records) => sendToIngest(target, records, fetchImpl),
    });
    answer(ACCOUNT);
    // A caller that smuggles the installation identity alongside a valid
    // event, the way a careless spread would.
    for (const event of EVERY_ANALYTICS_EVENT) {
      stream.capture({
        ...event,
        distinct_id: INSTALLATION,
        $device_id: INSTALLATION,
        $session_id: INSTALLATION,
        installationId: INSTALLATION,
      } as unknown as typeof event);
    }
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(ingestBatchUrl(TARGET));
    const body = String(init?.body);
    expect(body).toContain(ACCOUNT);
    expect(body).not.toContain(INSTALLATION);
    expect(body).not.toContain('$device_id');
    expect(body).not.toContain('$session_id');
  });

  it('sends nothing signed out, and stops at sign-out', async () => {
    const { stream, sent, signIn } = harness();
    signIn(null);
    for (const event of EVERY_ANALYTICS_EVENT) stream.capture(event);
    await flush();
    expect(sent).toEqual([]);

    signIn(ACCOUNT);
    signIn(null);
    for (const event of EVERY_ANALYTICS_EVENT) stream.capture(event);
    await flush();
    expect(sent).toEqual([]);
  });

  it('holds what was captured before the session answered, then decides', async () => {
    const signedIn = harness();
    const launch = EVERY_ANALYTICS_EVENT.find(e => e.name === 'app_launched')!;
    signedIn.stream.capture(launch);
    signedIn.signIn(ACCOUNT);
    await flush();
    expect(signedIn.sent.flat().map(record => record.event)).toEqual([
      'app_launched',
    ]);

    const signedOut = harness();
    signedOut.stream.capture(launch);
    signedOut.signIn(null);
    await flush();
    expect(signedOut.sent).toEqual([]);
  });

  it('refuses an account id that is not a UUID', async () => {
    const { stream, sent, signIn } = harness();
    signIn('someone@example.com');
    for (const event of EVERY_ANALYTICS_EVENT) stream.capture(event);
    await flush();
    expect(sent).toEqual([]);
  });
});
