import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BusEndpoint } from '@exawatt/core';
import { ChatterComposer } from './chatter-thread';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

const RECIPIENT: BusEndpoint = {
  sessionId: 'session-a',
  name: 'Reviewer',
  harness: 'claude',
};

describe('ChatterComposer paste', () => {
  it('pastes a screenshot as the path of its saved image', async () => {
    const clipboardRead = vi.fn(async () => ({
      kind: 'image' as const,
      text: '/var/folders/T/exawatt-clipboard/1f2e.png',
    }));
    installBridgeDouble({ pty: { clipboardRead } });
    try {
      render(
        <ChatterComposer
          recipients={[RECIPIENT]}
          defaultTo={RECIPIENT.sessionId}
          participants={new Map()}
          onSend={vi.fn()}
          onLeave={vi.fn()}
        />
      );
      const field = screen.getByRole('textbox');
      fireEvent.change(field, { target: { value: 'Look at ' } });
      const pasted = fireEvent.paste(field, {
        clipboardData: { items: [{ kind: 'file', type: 'image/png' }] },
      });
      expect(pasted).toBe(false);
      await waitFor(() =>
        expect(field).toHaveValue(
          'Look at /var/folders/T/exawatt-clipboard/1f2e.png '
        )
      );
    } finally {
      removeBridgeDouble();
    }
  });
});
