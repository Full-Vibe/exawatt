import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PauseProjectConfirm } from './close-confirm';
import { useProjectPauseInteraction } from './use-project-pause-interaction';
import type { Project } from './use-workspace-state';
const projects = [
  { dir: '/work', name: 'Work', color: '#123456', tabs: [], activeTabId: null },
] as Project[];

describe('Project pause interaction', () => {
  it('defaults to cancel; only explicit Pause now interrupts work', () => {
    const cancel = vi.fn();
    const pause = vi.fn();
    render(
      <PauseProjectConfirm
        title="Work"
        color="#123456"
        activeCount={2}
        onCancel={cancel}
        onPause={pause}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('button', { name: /Cancel/ })).toHaveFocus();
    const cancelButton = screen.getByRole('button', { name: /Cancel/ });
    // jsdom does not synthesize native button clicks from keyboard events.
    // Prove Enter is uncancelled, then supply its native click; Electron eval
    // exercises the actual keyboard activation end to end.
    expect(fireEvent.keyDown(cancelButton, { key: 'Enter' })).toBe(true);
    fireEvent.click(cancelButton);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Pause now' })).toHaveFocus();
    const pauseButton = screen.getByRole('button', { name: 'Pause now' });
    expect(fireEvent.keyDown(pauseButton, { key: 'Enter' })).toBe(true);
    fireEvent.click(pauseButton);
    expect(pause).toHaveBeenCalledOnce();
  });
  it('pauses quiet Agents without a dialog', async () => {
    const pause = vi.fn().mockResolvedValue({
      kind: 'completed',
      sessionIds: ['a'],
      results: [{ status: 'paused' }],
    });
    const { result } = renderHook(() =>
      useProjectPauseInteraction(projects, pause, vi.fn())
    );
    await act(() => result.current.requestPause('/work'));
    expect(result.current.confirmation).toBeNull();
    expect(pause).toHaveBeenCalledWith('/work', undefined);
  });
  it('retries the exact confirmed snapshot and prevents duplicate operations', async () => {
    const pause = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'needs-confirmation',
        sessionIds: ['a', 'b'],
        activeSessionIds: ['a'],
      })
      .mockResolvedValue({
        kind: 'completed',
        sessionIds: ['a', 'b'],
        results: [],
      });
    const { result } = renderHook(() =>
      useProjectPauseInteraction(projects, pause, vi.fn())
    );
    await act(() => result.current.requestPause('/work'));
    expect(result.current.confirmation?.activeCount).toBe(1);
    await act(async () => {
      result.current.confirmPause();
      result.current.confirmPause();
    });
    expect(pause).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenLastCalledWith('/work', ['a', 'b']);
  });
  it('reports failed operations without claiming completion', async () => {
    const announce = vi.fn();
    const reportFailure = vi.fn();
    const pause = vi
      .fn()
      .mockRejectedValue(new Error('Process could not stop'));
    const { result } = renderHook(() =>
      useProjectPauseInteraction(projects, pause, announce, reportFailure)
    );
    await act(() => result.current.requestPause('/work'));
    expect(reportFailure).toHaveBeenCalledWith('Process could not stop');
    expect(announce).not.toHaveBeenCalled();
    expect(result.current.confirmation).toBeNull();
  });
});
