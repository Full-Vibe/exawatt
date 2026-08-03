import { describe, expect, it, vi } from 'vitest';
import { broadcastToWindows } from './window-broadcast';

describe('broadcastToWindows', () => {
  it('publishes settings changes to every live renderer only', () => {
    const first = vi.fn();
    const second = vi.fn();
    const destroyed = vi.fn();
    broadcastToWindows(
      [
        { isDestroyed: () => false, webContents: { send: first } },
        { isDestroyed: () => false, webContents: { send: second } },
        { isDestroyed: () => true, webContents: { send: destroyed } },
      ],
      'settings:changed',
      { appearance: { schemaVersion: 1 } }
    );
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(destroyed).not.toHaveBeenCalled();
  });
});
