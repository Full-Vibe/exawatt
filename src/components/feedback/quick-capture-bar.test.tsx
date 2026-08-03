import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickCaptureBar, type QuickCaptureBarProps } from './quick-capture-bar';

const SHOT = 'data:image/png;base64,iVBORw0KGgo=';

function renderBar(overrides: Partial<QuickCaptureBarProps> = {}) {
  const props: QuickCaptureBarProps = {
    kind: 'general',
    onKindChange: vi.fn(),
    message: 'The tab strip flickers on restore',
    onMessageChange: vi.fn(),
    screenshot: SHOT,
    attachScreenshot: false,
    onAttachScreenshotChange: vi.fn(),
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
    expect(
      screen.getByRole('dialog', { name: 'Quick feedback' })
    ).toBeTruthy();
    expect(
      screen.getByText('Send failed — draft kept')
    ).toBeTruthy();
    expect(screen.queryByText('↩ send')).toBeNull();
  });
});
