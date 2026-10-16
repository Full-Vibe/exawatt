import { describe, expect, it } from 'vitest';
import { createAgent } from '@exawatt/core';
import {
  directReached,
  directRecipients,
  directResultOf,
  recipientNote,
  type DirectRecipient,
} from './direct-model';

const ready = { kind: 'ready' } as const;

function recipient(readiness: DirectRecipient['readiness']): DirectRecipient {
  return {
    agentId: 'a1',
    name: 'Alpha',
    harness: 'claude',
    projectId: '/code/alpha',
    readiness,
  };
}

describe('directRecipients', () => {
  it("scopes each send to the Agent's bus Project, not its git Project", () => {
    const [recipient] = directRecipients([
      createAgent({
        id: 'wt',
        name: 'claude-1',
        projectId: '/code/alpha',
        busProjectId: '/code/alpha-wt/feature',
      }),
    ]);
    expect(recipient.projectId).toBe('/code/alpha-wt/feature');
  });

  it('reads busy from a running turn and stopped from an ended Session', () => {
    const recipients = directRecipients([
      createAgent({ id: 'idle', name: 'Idle', status: 'idle' }),
      createAgent({ id: 'busy', name: 'Busy', status: 'working' }),
      createAgent({ id: 'review', name: 'Review', status: 'reviewing' }),
      createAgent({
        id: 'stopped',
        name: 'Stopped',
        status: 'idle',
        sessionState: 'stopped',
      }),
    ]);
    expect(recipients.map(entry => entry.readiness)).toEqual([
      'ready',
      'busy',
      'busy',
      'stopped',
    ]);
  });
});

describe('recipientNote', () => {
  it('says before Send that a busy recipient waits for its turn', () => {
    expect(recipientNote(recipient('busy'), ready, undefined)?.tone).toBe(
      'quiet'
    );
    expect(recipientNote(recipient('ready'), ready, undefined)).toBeNull();
  });

  it('says before Send why a recipient has no address', () => {
    const note = recipientNote(
      recipient('busy'),
      ready,
      undefined,
      'A shell does not take messages'
    );
    expect(note?.tone).toBe('fault');
    expect(note?.text).toContain('A shell does not take messages');
  });

  it('lists a stopped Session as undeliverable before anything is sent', () => {
    expect(recipientNote(recipient('stopped'), ready, undefined)?.tone).toBe(
      'fault'
    );
  });

  it('shows each delivery result once it arrives, faults emphasized', () => {
    const queued = recipientNote(recipient('busy'), ready, {
      state: 'queued',
    });
    const refused = recipientNote(recipient('ready'), ready, {
      state: 'undeliverable',
      reason: 'Session ended',
    });
    expect(queued?.tone).toBe('quiet');
    expect(refused?.tone).toBe('fault');
    expect(refused?.title).toBe('Session ended');
    expect(
      recipientNote(recipient('ready'), ready, { state: 'sending' })?.tone
    ).toBe('pending');
  });

  it('carries the reason a board cannot send to every row', () => {
    const note = recipientNote(
      recipient('ready'),
      { kind: 'unavailable', reason: 'Demo cannot send' },
      undefined
    );
    expect(note?.text).toBe('Demo cannot send');
  });
});

describe('directResultOf', () => {
  it('reads a refusal as undeliverable with its reason', () => {
    expect(
      directResultOf({
        delivery: {
          state: 'undeliverable',
          reason: 'Demo cannot send',
          adapter: 'demo',
        },
        record: null,
      })
    ).toEqual({ state: 'undeliverable', reason: 'Demo cannot send' });
  });

  it('reads a logged delivery as its state', () => {
    expect(
      directResultOf({
        delivery: { state: 'queued', adapter: 'codex-queue' },
        record: null,
      })
    ).toEqual({ state: 'queued' });
  });
});

describe('directReached', () => {
  it('counts a message handed over or waiting at the door, never a refusal or an unconfirmed send', () => {
    expect(directReached({ state: 'delivered' })).toBe(true);
    expect(directReached({ state: 'queued' })).toBe(true);
    expect(directReached({ state: 'terminal' })).toBe(true);
    expect(directReached({ state: 'undeliverable', reason: 'x' })).toBe(false);
    expect(directReached({ state: 'unknown' })).toBe(false);
    expect(directReached({ state: 'sending' })).toBe(false);
  });
});
