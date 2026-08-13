import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  endedCopy,
  formatHistorySize,
  formatWhen,
  PausedAgentRecord,
  type PausedHistoryBridge,
} from './paused-agent-record';
import type { WorkspaceTab } from './use-workspace-state';

const tab = (over: Partial<WorkspaceTab> = {}): WorkspaceTab =>
  ({
    id: 't1',
    durableSessionId: 'durable-1',
    sessionId: null,
    harness: 'claude',
    title: 'Alpha',
    titleKind: 'operator',
    cwd: '/p',
    harnessSessionId: 'prov-1',
    resumeState: 'ended-resumable',
    lifecycle: 'stopped-clean',
    exitCode: null,
    initialTask: 'Ship the launcher redraw',
    startedAt: 1,
    roadmapItemId: null,
    ...over,
  }) as WorkspaceTab;

/** The injectable bridge, so no test has to fake `window.electron` — a
 *  partial fake there is what made a browser look like Electron. */
const bridge = (over: Partial<PausedHistoryBridge> = {}): PausedHistoryBridge => ({
  retainedHistoryMeta: vi.fn(async () => ({
    bytes: 1_500_000,
    updatedAt: Date.now() - 3 * 60 * 60 * 1000,
    exists: true,
  })),
  retainedTranscript: vi.fn(async () => ({
    lines: ['first line', 'second line'],
    truncated: 0,
    corrupt: false,
  })),
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('paused-Agent record copy', () => {
  it('sizes history the way an operator reads it', () => {
    expect(formatHistorySize(0)).toBe('nothing saved');
    expect(formatHistorySize(900)).toBe('900 B saved');
    expect(formatHistorySize(20_000)).toBe('20 KB saved');
    expect(formatHistorySize(1_500_000)).toBe('1.4 MB saved');
  });

  it('is coarse about time on purpose', () => {
    const now = 1_000_000_000_000;
    expect(formatWhen(0, now)).toBe('unknown');
    expect(formatWhen(now - 30_000, now)).toBe('just now');
    expect(formatWhen(now - 10 * 60_000, now)).toBe('10 min ago');
    expect(formatWhen(now - 5 * 3_600_000, now)).toBe('5 hr ago');
    expect(formatWhen(now - 72 * 3_600_000, now)).toBe('3 days ago');
  });

  it('says how it ended, never just that it stopped', () => {
    expect(endedCopy(tab())).toMatch(/Stopped cleanly/);
    expect(endedCopy(tab({ lifecycle: 'interrupted' }))).toMatch(/Interrupted/);
    expect(endedCopy(tab({ lifecycle: 'failed' }))).toMatch(/resume attempt/);
    expect(endedCopy(tab({ exitCode: 137 }))).toMatch(/code 137/);
    expect(endedCopy(tab({ harness: 'shell' }))).toMatch(/Shell closed/);
  });
});

describe('PausedAgentRecord', () => {
  // The whole point of incident 0008: opening a paused Agent must not read
  // the transcript. This test is the guard on that contract.
  it('never reads the transcript to render the record', async () => {
    const api = bridge();
    render(<PausedAgentRecord tab={tab()} bridge={api} />);

    await waitFor(() =>
      expect(api.retainedHistoryMeta).toHaveBeenCalledTimes(1)
    );
    expect(api.retainedTranscript).not.toHaveBeenCalled();
    expect(screen.getByText('Ship the launcher redraw')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByText(/1\.4 MB saved/)).toBeVisible()
    );
  });

  it('fetches the transcript only when asked, and renders it as lines', async () => {
    const api = bridge();
    render(<PausedAgentRecord tab={tab()} bridge={api} />);

    fireEvent.click(await screen.findByText('Show transcript'));
    await waitFor(() => expect(api.retainedTranscript).toHaveBeenCalledTimes(1));
    const transcript = document.querySelector('[data-paused-transcript]');
    expect(transcript?.textContent).toBe('first line\nsecond line');
  });

  it('says when the earliest lines were dropped rather than pretending', async () => {
    render(
      <PausedAgentRecord
        tab={tab()}
        bridge={bridge({
          retainedTranscript: vi.fn(async () => ({
            lines: ['tail'],
            truncated: 1_200,
            corrupt: false,
          })),
        })}
      />
    );
    fireEvent.click(await screen.findByText('Show transcript'));
    await waitFor(() =>
      expect(screen.getByText(/earliest 1200 lines not shown/)).toBeVisible()
    );
  });

  it('offers nothing to show when nothing was saved', async () => {
    render(
      <PausedAgentRecord
        tab={tab()}
        bridge={bridge({
          retainedHistoryMeta: vi.fn(async () => ({
            bytes: 0,
            updatedAt: 0,
            exists: false,
          })),
        })}
      />
    );
    const button = await screen.findByRole('button', {
      name: 'No saved output',
    });
    expect(button).toBeDisabled();
  });

  it('reports unreadable history instead of rendering an empty pane', async () => {
    render(
      <PausedAgentRecord
        tab={tab()}
        bridge={bridge({
          retainedTranscript: vi.fn(async () => ({
            lines: [],
            truncated: 0,
            corrupt: true,
          })),
        })}
      />
    );
    fireEvent.click(await screen.findByText('Show transcript'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        /could not be read/
      )
    );
  });

  it('falls back honestly when no task was recorded', async () => {
    render(
      <PausedAgentRecord tab={tab({ initialTask: null })} bridge={bridge()} />
    );
    expect(
      await screen.findByText('No task was recorded for this Agent.')
    ).toBeVisible();
  });
});
