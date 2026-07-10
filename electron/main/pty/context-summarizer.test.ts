import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextSummarizer } from './context-summarizer';
import type { PtySessionManager } from './session-manager';

class FakeManager extends EventEmitter {
  private text = new Map<string, string>();

  list() {
    return [{ id: 'a', exited: false, harness: 'claude' }];
  }

  buffer(id: string) {
    return this.text.get(id) ?? '';
  }

  bufferCursor(id: string) {
    return this.buffer(id).length;
  }

  bufferSince(id: string, cursor: number) {
    return { text: this.buffer(id).slice(cursor), truncated: false };
  }

  data(id: string, value: string) {
    this.text.set(id, this.buffer(id) + value);
    this.emit('data', id, value);
  }
}

describe('ContextSummarizer re-entry recaps', () => {
  let now: number;
  let manager: FakeManager;
  let summarize: ReturnType<typeof vi.fn>;
  let service: ContextSummarizer;

  beforeEach(() => {
    now = 100_000;
    manager = new FakeManager();
    summarize = vi.fn(async () => 'Tests passed; migration order needs approval.');
    service = new ContextSummarizer({
      recapAwayMs: 10_000,
      recapMinChars: 20,
      now: () => now,
      summarize,
    });
    service.attach(manager as unknown as PtySessionManager);
    service.setWindowFocused(true);
    service.setFocus('a');
  });

  it('summarizes only output produced while away', async () => {
    manager.data('a', 'old output that was already seen\n');
    service.setWindowFocused(false);
    now += 12_000;
    manager.data('a', '\x1b[32mnew tests passed and now a decision is waiting\x1b[0m');

    const recap = new Promise((resolve) => service.once('recap', resolve));
    service.setWindowFocused(true);
    await expect(recap).resolves.toMatchObject({
      id: 'a',
      text: 'Tests passed; migration order needs approval.',
      awayMs: 12_000,
    });
    expect(summarize).toHaveBeenCalledOnce();
    const prompt = summarize.mock.calls[0][0] as string;
    expect(prompt).toContain('new tests passed');
    expect(prompt).not.toContain('old output');
  });

  it('stays silent for short absences or insignificant output', async () => {
    const events: unknown[] = [];
    service.on('recap', (event) => events.push(event));
    service.setWindowFocused(false);
    now += 5_000;
    manager.data('a', 'substantial output that arrived too soon');
    service.setWindowFocused(true);
    await Promise.resolve();

    service.setWindowFocused(false);
    now += 20_000;
    manager.data('a', 'tiny');
    service.setWindowFocused(true);
    await Promise.resolve();

    expect(events).toEqual([]);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('drops a generated recap when the operator engages first', async () => {
    let resolveSummary: (value: string) => void = () => {};
    summarize.mockImplementation(
      () => new Promise<string>((resolve) => (resolveSummary = resolve))
    );
    const events: unknown[] = [];
    service.on('recap', (event) => events.push(event));
    service.setWindowFocused(false);
    now += 20_000;
    manager.data('a', 'enough meaningful output arrived while away');
    service.setWindowFocused(true);
    service.noteInput('a');
    resolveSummary('This result is already stale.');
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([]);
  });
});
