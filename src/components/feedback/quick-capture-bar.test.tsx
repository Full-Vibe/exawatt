import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  QuickCaptureBar,
  type QuickCaptureBarProps,
} from './quick-capture-bar';
import type { DiagnosticsReport } from '@/types/electron';

const SHOT = 'data:image/png;base64,iVBORw0KGgo=';

export const REPORT: DiagnosticsReport = {
  reportVersion: 1,
  generatedAt: '2026-08-14T12:00:00.000Z',
  app: {
    version: '0.1.9',
    sha: 'abc123',
    branch: 'master',
    delivery: 'signed',
    packaged: true,
    installPath: '/Applications/Exawatt.app',
  },
  system: {
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '15.0',
    electron: '43.1.0',
    node: '24.18.0',
    locale: 'en-US',
  },
  update: { phase: 'error', error: 'ENOSPC' },
  session: { signedIn: true, liveSessions: 2 },
  logs: [{ name: 'updater.jsonl', present: true, lines: [{ event: 'x' }] }],
};

function renderBar(overrides: Partial<QuickCaptureBarProps> = {}) {
  const props: QuickCaptureBarProps = {
    kind: 'general',
    onKindChange: vi.fn(),
    message: 'The tab strip flickers on restore',
    onMessageChange: vi.fn(),
    screenshot: SHOT,
    attachScreenshot: false,
    onAttachScreenshotChange: vi.fn(),
    diagnostics: null,
    attachDiagnostics: false,
    onAttachDiagnosticsChange: vi.fn(),
    error: null,
    onSubmit: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<QuickCaptureBar {...props} />);
  return props;
}

describe('QuickCaptureBar', () => {
  it('sends on Enter and inserts a newline on Shift+Enter', () => {
    const props = renderBar();
    const field = screen.getByLabelText('Feedback');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('never sends an empty draft', () => {
    const props = renderBar({ message: '   ' });
    fireEvent.keyDown(screen.getByLabelText('Feedback'), { key: 'Enter' });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('dismisses on Escape', () => {
    const props = renderBar();
    fireEvent.keyDown(screen.getByLabelText('Feedback'), { key: 'Escape' });
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('switches kind from the keyboard with ⌘2 and by clicking a chip', () => {
    const props = renderBar();
    fireEvent.keyDown(screen.getByLabelText('Feedback'), {
      key: '2',
      metaKey: true,
    });
    expect(props.onKindChange).toHaveBeenCalledWith('bug');
    fireEvent.click(screen.getByRole('button', { name: /Idea/ }));
    expect(props.onKindChange).toHaveBeenCalledWith('idea');
  });

  it('toggles the pre-captured screenshot with ⌘S', () => {
    const props = renderBar();
    expect(screen.getByText('Screenshot')).toBeVisible();
    fireEvent.keyDown(screen.getByLabelText('Feedback'), {
      key: 's',
      metaKey: true,
    });
    expect(props.onAttachScreenshotChange).toHaveBeenCalledWith(true);
  });

  it('hides the screenshot toggle when capture was unavailable', () => {
    const props = renderBar({ screenshot: null });
    expect(
      screen.queryByRole('button', { name: 'Attach screenshot' })
    ).toBeNull();
    fireEvent.keyDown(screen.getByLabelText('Feedback'), {
      key: 's',
      metaKey: true,
    });
    expect(props.onAttachScreenshotChange).not.toHaveBeenCalled();
  });

  it('shields workspace verbs behind a dialog role and keeps the error in the hint slot', () => {
    renderBar({ error: 'Send failed — draft kept' });
    expect(screen.getByRole('dialog', { name: 'Quick feedback' })).toBeTruthy();
    expect(screen.getByText('Send failed — draft kept')).toBeTruthy();
    expect(screen.queryByText('↩ send')).toBeNull();
  });

  it('names the toggle anonymized on a Bug', () => {
    renderBar({ kind: 'bug', diagnostics: REPORT });
    expect(
      screen.getByLabelText('Attach anonymized diagnostics')
    ).toBeInTheDocument();
    expect(screen.getByText('Anonymized diagnostics')).toBeInTheDocument();
  });

  it('does not offer diagnostics on a non-Bug kind', () => {
    renderBar({ kind: 'general', diagnostics: REPORT });
    expect(
      screen.queryByLabelText('Attach anonymized diagnostics')
    ).not.toBeInTheDocument();
  });

  it('toggles diagnostics with Cmd+D only when they are offered', () => {
    const withReport = renderBar({ kind: 'bug', diagnostics: REPORT });
    fireEvent.keyDown(screen.getByLabelText('Feedback'), {
      key: 'd',
      metaKey: true,
    });
    expect(withReport.onAttachDiagnosticsChange).toHaveBeenCalledWith(true);
  });

  it('ignores Cmd+D when no report was collected', () => {
    const without = renderBar({ kind: 'bug', diagnostics: null });
    fireEvent.keyDown(screen.getByLabelText('Feedback'), {
      key: 'd',
      metaKey: true,
    });
    expect(without.onAttachDiagnosticsChange).not.toHaveBeenCalled();
  });

  it('summarizes a failed update and reveals the exact payload on review', () => {
    renderBar({ kind: 'bug', diagnostics: REPORT, attachDiagnostics: true });
    expect(
      screen.getByText('Exawatt 0.1.9 · update failed · signed in')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    // the review shows the payload itself, not a description of it
    expect(screen.getByText(/"reportVersion": 1/)).toBeInTheDocument();
    expect(
      screen.getByText(/"installPath": "\/Applications/)
    ).toBeInTheDocument();
  });

  it('hides the summary until diagnostics are actually attached', () => {
    renderBar({ kind: 'bug', diagnostics: REPORT, attachDiagnostics: false });
    expect(
      screen.queryByRole('button', { name: 'Review' })
    ).not.toBeInTheDocument();
  });
});
