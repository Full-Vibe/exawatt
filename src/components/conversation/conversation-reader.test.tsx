import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationReader,
  type ConversationReading,
} from './conversation-reader';

const base: ConversationReading = {
  sessionId: 'session-exact',
  source: 'Source',
  project: 'Project',
  title: 'Review',
  history: 'complete',
  records: [],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConversationReader presentation boundary', () => {
  it('renders untrusted strings as text without activating HTML or resources', () => {
    const payload =
      '<img src="https://example.test/track" onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(
      <ConversationReader
        conversation={{
          ...base,
          records: [
            {
              id: 'unsafe',
              role: 'assistant',
              blocks: [{ id: 'p', kind: 'prose', text: payload }],
            },
          ],
        }}
      />
    );
    expect(screen.getByText(payload)).toBeVisible();
    expect(container.querySelector('img,script,iframe,a')).toBeNull();
  });

  it('copies exact code including whitespace without the language or button label', async () => {
    const text = '  const x = "<value>";\n\n';
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(
      <ConversationReader
        conversation={{
          ...base,
          records: [
            {
              id: 'code',
              role: 'assistant',
              blocks: [{ id: 'c', kind: 'code', language: 'JS', text }],
            },
          ],
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
    await waitFor(() =>
      expect(screen.getByRole('status')).not.toBeEmptyDOMElement()
    );
  });

  it('keeps selectable code and announces clipboard failure', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(
      <ConversationReader
        conversation={{
          ...base,
          records: [
            {
              id: 'code',
              role: 'assistant',
              blocks: [{ id: 'c', kind: 'code', language: 'JS', text: 'code' }],
            },
          ],
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
    expect(screen.getByLabelText('JS code')).toHaveAttribute('tabindex', '0');
  });

  it('bounds tool output while preserving a keyboard-accessible disclosure', () => {
    const output = 'x'.repeat(5000);
    const { container } = render(
      <ConversationReader
        conversation={{
          ...base,
          records: [
            {
              id: 'tool',
              role: 'assistant',
              blocks: [
                {
                  id: 't',
                  kind: 'tool',
                  name: 'Read',
                  summary: 'Result',
                  output,
                },
              ],
            },
          ],
        }}
      />
    );
    expect(
      screen.getByLabelText('Read output').textContent!.length
    ).toBeLessThan(output.length);
    expect(container.querySelector('details summary')).toBeTruthy();
  });

  it('replaces records when switching exact Session identity', () => {
    const record = {
      id: 'same-item-id',
      role: 'assistant' as const,
      blocks: [
        { id: 'p', kind: 'prose' as const, text: 'First source content' },
      ],
    };
    const { rerender } = render(
      <ConversationReader conversation={{ ...base, records: [record] }} />
    );
    rerender(
      <ConversationReader
        conversation={{ ...base, sessionId: 'other-session', records: [] }}
      />
    );
    expect(screen.queryByText(record.blocks[0].text)).toBeNull();
    expect(screen.getByText('other-session')).toBeInTheDocument();
  });
});
