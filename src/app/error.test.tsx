import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RouteError from './error';

afterEach(() => {
  delete window.electron;
  vi.restoreAllMocks();
});

function crashError(): Error & { digest?: string } {
  const error = new Error('Maximum update depth exceeded') as Error & {
    digest?: string;
  };
  error.stack = 'Error: Maximum update depth exceeded\n    at Tile (a.tsx:1:1)';
  return error;
}

describe('RouteError', () => {
  it('renders without an Electron bridge (web)', () => {
    render(<RouteError error={crashError()} reset={() => {}} />);

    expect(
      screen.getByText('This surface hit an error while rendering.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Maximum update depth exceeded/)
    ).toBeInTheDocument();
  });

  it('reports the caught error to the Electron bridge when present', () => {
    const reportRenderError = vi.fn(async () => undefined);
    window.electron = {
      isElectron: true,
      app: { reportRenderError },
    } as unknown as typeof window.electron;

    const error = crashError();
    error.digest = 'abc123';
    render(<RouteError error={error} reset={() => {}} />);

    expect(reportRenderError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Maximum update depth exceeded',
        digest: 'abc123',
        pathname: expect.any(String),
      })
    );
  });

  it('never throws when the bridge call itself rejects', () => {
    window.electron = {
      isElectron: true,
      app: {
        reportRenderError: vi.fn(async () => {
          throw new Error('ipc unavailable');
        }),
      },
    } as unknown as typeof window.electron;

    expect(() =>
      render(<RouteError error={crashError()} reset={() => {}} />)
    ).not.toThrow();
  });
});
