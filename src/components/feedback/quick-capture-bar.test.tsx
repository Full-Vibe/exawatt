import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  QuickCaptureBar,
  type QuickCaptureBarProps,
} from './quick-capture-bar';
import type { DiagnosticsReport } from '@exawatt/core/desktop-bridge';

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
    attachScreenshot: true,
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

  it('Cmd+S captures the window consistently whether an image is already attached', () => {
    const props = renderBar({ onCaptureImage: vi.fn(), attachScreenshot: true });
    fireEvent.keyDown(screen.getByLabelText('Feedback'), {
      key: 's',
      metaKey: true,
    });
    expect(props.onCaptureImage).toHaveBeenCalledOnce();
    expect(props.onAttachScreenshotChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
    expect(props.onCaptureImage).toHaveBeenCalledTimes(2);
  });

  it('does not advertise or invoke window capture when unavailable', () => {
    const props = renderBar({ screenshot: null });
    expect(screen.queryByRole('button', { name: 'Screenshot' })).toBeNull();
    fireEvent.keyDown(screen.getByLabelText('Feedback'), {
      key: 's',
      metaKey: true,
    });
    expect(props.onAttachScreenshotChange).not.toHaveBeenCalled();
  });

  it('shields workspace verbs behind a dialog role and announces errors', () => {
    renderBar({ error: 'Send failed — draft kept' });
    expect(screen.getByRole('dialog', { name: 'Quick feedback' })).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Send failed — draft kept'
    );
  });

  it('exposes diagnostics consent as a native checkbox', () => {
    const props = renderBar({ kind: 'bug', diagnostics: REPORT });
    const consent = screen.getByRole('checkbox', {
      name: 'Include app details',
    });
    expect(consent).not.toBeChecked();
    fireEvent.click(consent);
    expect(props.onAttachDiagnosticsChange).toHaveBeenCalledWith(true);
  });

  it('does not offer diagnostics on a non-Bug kind', () => {
    renderBar({ kind: 'general', diagnostics: REPORT });
    expect(
      screen.queryByRole('checkbox', { name: 'Include app details' })
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

  it('reveals the exact collected diagnostics payload on review', () => {
    renderBar({ kind: 'bug', diagnostics: REPORT, attachDiagnostics: true });

    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    // the review shows the payload itself, not a description of it
    const payload = document.querySelector('pre');
    expect(payload).toBeInTheDocument();
    expect(JSON.parse(payload!.textContent!)).toEqual(REPORT);
  });

  it('allows reviewing collected data before consenting to attach it', () => {
    renderBar({ kind: 'bug', diagnostics: REPORT, attachDiagnostics: false });
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    const payload = document.querySelector('pre');
    expect(payload).toBeInTheDocument();
    expect(JSON.parse(payload!.textContent!)).toEqual(REPORT);
    expect(
      screen.getByRole('checkbox', { name: 'Include app details' })
    ).not.toBeChecked();
  });

  it('keeps Enter and Space on focused controls available for native activation', () => {
    const props = renderBar({
      kind: 'bug',
      diagnostics: REPORT,
      attachDiagnostics: true,
    });
    for (const control of [
      ...screen.getAllByRole('button'),
      screen.getByRole('checkbox', { name: 'Include app details' }),
    ]) {
      expect(fireEvent.keyDown(control, { key: 'Enter' })).toBe(true);
      expect(fireEvent.keyDown(control, { key: ' ' })).toBe(true);
    }
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('ignores composing keys and modified Enter without cancelling input', () => {
    const props = renderBar();
    const field = screen.getByLabelText('Feedback');
    for (const modifier of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
      { isComposing: true },
      { keyCode: 229 },
    ]) {
      expect(fireEvent.keyDown(field, { key: 'Enter', ...modifier })).toBe(
        true
      );
    }
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it('offers a native picker without requiring window capture', () => {
    const onImageFiles = vi.fn();
    renderBar({ screenshot: null, onImageFiles });
    const file = new File(['image'], 'report.png', { type: 'image/png' });
    fireEvent.change(
      document.querySelector<HTMLInputElement>('[data-feedback-image-input]')!,
      {
        target: { files: [file] },
      }
    );
    expect(onImageFiles).toHaveBeenCalledWith([file]);
    expect(screen.getByRole('button', { name: 'Attach image' })).toBeEnabled();
  });

  it('keeps ordinary text paste native and routes file-bearing paste only within the composer', () => {
    const onImageFiles = vi.fn();
    renderBar({ onImageFiles });
    const image = new File(['image'], 'capture.png', { type: 'image/png' });
    const textFile = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const field = screen.getByLabelText('Feedback');
    expect(
      fireEvent.paste(field, {
        clipboardData: { files: [], getData: () => 'pasted text' },
      })
    ).toBe(true);
    expect(onImageFiles).not.toHaveBeenCalled();
    expect(
      fireEvent.paste(field, { clipboardData: { files: [image, textFile] } })
    ).toBe(false);
    expect(onImageFiles).toHaveBeenCalledWith([image, textFile]);
    fireEvent.paste(document.body, { clipboardData: { files: [image] } });
    expect(onImageFiles).toHaveBeenCalledTimes(1);
  });

  it('prevents file drops from navigating away and routes unsupported replacements to validation', () => {
    const onImageFiles = vi.fn();
    renderBar({ onImageFiles, attachScreenshot: true });
    const image = new File(['image'], 'capture.webp', { type: 'image/webp' });
    const invalid = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const field = screen.getByLabelText('Feedback');
    expect(
      fireEvent.dragOver(field, { dataTransfer: { types: ['Files'] } })
    ).toBe(false);
    expect(fireEvent.drop(field, { dataTransfer: { files: [invalid] } })).toBe(
      false
    );
    expect(onImageFiles).toHaveBeenCalledWith([invalid]);
    expect(
      screen.getByRole('img', { name: 'Feedback attachment preview' })
    ).toHaveAttribute('src', SHOT);
    expect(
      fireEvent.drop(field, { dataTransfer: { files: [image, invalid] } })
    ).toBe(false);
    expect(onImageFiles).toHaveBeenLastCalledWith([image, invalid]);
    expect(fireEvent.drop(field, { dataTransfer: { files: [] } })).toBe(true);
  });

  it('prevents file navigation while busy without replacing current evidence', () => {
    const onImageFiles = vi.fn();
    renderBar({ busy: true, onImageFiles, attachScreenshot: true });
    const file = new File(['image'], 'capture.png', { type: 'image/png' });
    expect(
      fireEvent.drop(screen.getByLabelText('Feedback'), {
        dataTransfer: { files: [file] },
      })
    ).toBe(false);
    expect(onImageFiles).not.toHaveBeenCalled();
    expect(
      screen.getByRole('img', { name: 'Feedback attachment preview' })
    ).toHaveAttribute('src', SHOT);
  });

  it('lets an attached image be reviewed, replaced and removed independently', () => {
    const onPickImage = vi.fn();
    const onRemoveImage = vi.fn();
    renderBar({
      attachScreenshot: true,
      onPickImage,
      onRemoveImage,
      attachmentName: 'report.png',
    });
    expect(
      screen.getByRole('img', { name: 'Feedback attachment preview' })
    ).toHaveAttribute('src', SHOT);
    fireEvent.click(screen.getByRole('button', { name: 'Attach image' }));
    expect(onPickImage).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove attached image' })
    );
    expect(onRemoveImage).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Feedback')).toHaveFocus();
  });

  it('never presents an excluded image as an attachment', () => {
    renderBar({ screenshot: SHOT, attachScreenshot: false });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove attached image' })
    ).not.toBeInTheDocument();
  });

  it('allows inspecting attached evidence after the report is frozen without submitting again', () => {
    const props = renderBar({ readOnly: true });
    const preview = screen.getByRole('button', {
      name: 'View attached image',
    });
    expect(preview).toBeEnabled();
    fireEvent.click(preview);
    expect(preview).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('img', { name: 'Attached image' })).toHaveAttribute(
      'src',
      SHOT
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('blocks delivery and image replacement during preparation without blocking text editing', () => {
    const onImageFiles = vi.fn();
    const props = renderBar({ busy: true, onImageFiles });
    expect(screen.getByLabelText('Feedback')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Attach image' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Feedback'), { key: 'Enter' });
    fireEvent.paste(screen.getByLabelText('Feedback'), {
      clipboardData: {
        files: [new File(['image'], 'capture.png', { type: 'image/png' })],
      },
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(onImageFiles).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Feedback'), {
      target: { value: 'Typing while evidence prepares' },
    });
    expect(props.onMessageChange).toHaveBeenCalledWith('Typing while evidence prepares');
  });

  it('allows editing a newer draft while an older attempt blocks another send', () => {
    const props = renderBar({ sendDisabled: true });
    const field = screen.getByLabelText('Feedback');
    expect(field).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Send feedback' })
    ).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Newer draft' } });
    expect(props.onMessageChange).toHaveBeenCalledWith('Newer draft');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Idea/ }));
    expect(props.onKindChange).toHaveBeenCalledWith('idea');
  });

  it('defers dialog semantics and initial focus to its host when requested', () => {
    renderBar({ dialogSemantics: false, autoFocus: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Feedback')).not.toHaveFocus();
  });
});
